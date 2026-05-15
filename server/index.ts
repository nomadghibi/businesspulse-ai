import "dotenv/config";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { answerQuestion } from "./ai.js";
import { ingestCsv, previewCsv } from "./csv.js";
import { validateRuntimeEnv } from "./env.js";
import { calculateMetrics, generateAlerts, generateRecommendations, generateReport } from "./metrics.js";
import { verifyStripeWebhookSignature } from "./stripeWebhook.js";
import { type AuthRole, getStorage } from "./storage.js";
import { defaultPeriod } from "./utils.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 5055);
const storage = getStorage();
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();
const publicRateLimits = new Map<string, { count: number; resetAt: number }>();
const processingWebhookEvents = new Set<string>();
const billableWriteEndpoints = new Set(["/upload", "/reports", "/integrations/stripe/sync"]);
const alertState = new Map<string, number>();
const opsCounters = {
  startedAt: Date.now(),
  totalRequests: 0,
  totalErrors: 0,
  byStatusClass: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 } as Record<"2xx" | "3xx" | "4xx" | "5xx", number>,
  byPath: new Map<string, number>()
};
const MAX_USERS_BY_PLAN: Record<string, number> = { starter: 3, growth: 15, pro: 1000 };

let initialized = false;
let initializePromise: Promise<void> | null = null;

async function initializeServer() {
  if (initialized) return;
  if (initializePromise) {
    await initializePromise;
    return;
  }
  initializePromise = (async () => {
    validateRuntimeEnv();
    await storage.initialize();
    initialized = true;
  })();
  await initializePromise;
}

app.use((req, res, next) => {
  const incoming = req.header("x-request-id");
  const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : crypto.randomUUID();
  Reflect.set(req, "requestId", requestId);
  res.setHeader("x-request-id", requestId);
  const startedAt = Date.now();
  res.on("finish", () => {
    if (req.path === "/api/health") return;
    opsCounters.totalRequests += 1;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx` as "2xx" | "3xx" | "4xx" | "5xx";
    if (statusClass in opsCounters.byStatusClass) opsCounters.byStatusClass[statusClass] += 1;
    if (res.statusCode >= 500) opsCounters.totalErrors += 1;
    opsCounters.byPath.set(req.path, (opsCounters.byPath.get(req.path) ?? 0) + 1);
    void maybeSendOpsAlert();
    console.info(JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      event: "http_request",
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    }));
  });
  next();
});

app.use(cors(buildCorsOptions()));
app.post("/api/integrations/stripe/webhook", express.raw({ type: "application/json" }), async (req, res, next) => {
  try {
    const signature = String(req.header("stripe-signature") ?? "");
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return res.status(400).json({ error: "Missing STRIPE_WEBHOOK_SECRET" });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifyStripeWebhookSignature({ rawBody: raw, signatureHeader: signature, secret })) {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }
    const event = JSON.parse(raw.toString("utf8")) as { id?: string; type: string; data?: { object?: any } };
    if (!event.id) return res.status(400).json({ error: "Missing webhook event id" });
    if (processingWebhookEvents.has(event.id)) return res.status(200).json({ received: true, duplicate: true });
    if (await storage.hasWebhookEventProcessed(event.id, "stripe")) return res.status(200).json({ received: true, duplicate: true });
    processingWebhookEvents.add(event.id);
    const object = event.data?.object;
    try {
      const organizationId = await resolveOrganizationIdFromStripeEvent(object);
      if (!organizationId) return res.status(200).json({ received: true, ignored: "organization could not be resolved" });
      const data = await storage.getOrgData(organizationId);
      const createdAt = new Date().toISOString();
      if (event.type === "payment_intent.succeeded" || event.type === "charge.succeeded") {
        const externalId = object.latest_charge || object.id;
        if (!data.revenue.some((row) => row.externalId === externalId)) {
          data.revenue.push({
            id: `rev_${crypto.randomUUID()}`,
            organizationId,
            externalId,
            amount: Number(object.amount_received ?? object.amount ?? 0) / 100,
            paymentMethod: object.payment_method_types?.[0] ?? "stripe",
            paidAt: new Date((object.created ?? Date.now() / 1000) * 1000).toISOString(),
            createdAt,
            updatedAt: createdAt
          });
        }
      }
      if (event.type === "charge.refunded") {
        const refundExternalId = `refund_${object.id}`;
        if (!data.revenue.some((row) => row.externalId === refundExternalId)) {
          data.revenue.push({
            id: `rev_${crypto.randomUUID()}`,
            organizationId,
            externalId: refundExternalId,
            amount: -Math.abs(Number(object.amount_refunded ?? object.amount ?? 0) / 100),
            paymentMethod: "stripe_refund",
            paidAt: new Date((object.created ?? Date.now() / 1000) * 1000).toISOString(),
            createdAt,
            updatedAt: createdAt
          });
        }
      }
      if (event.type === "checkout.session.completed") {
        const plan = String(object.metadata?.plan ?? "starter");
        const status = String(object.payment_status === "paid" ? "active" : "trialing");
        await storage.upsertOrganizationPlan(organizationId, plan, status, {
          stripeCustomerId: object.customer ? String(object.customer) : undefined,
          stripeSubscriptionId: object.subscription ? String(object.subscription) : undefined,
          stripeCheckoutSessionId: object.id ? String(object.id) : undefined
        });
        await storage.trackEvent({
          organizationId,
          eventName: "billing_checkout_completed",
          payload: { sessionId: object.id, plan, status }
        });
      }
      if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
        const plan = String(object.metadata?.plan ?? "starter");
        const stripeStatus = String(object.status ?? "");
        const normalizedStatus =
          stripeStatus === "active" ? "active" :
          stripeStatus === "trialing" ? "trialing" :
          stripeStatus === "past_due" ? "past_due" :
          stripeStatus === "canceled" || stripeStatus === "unpaid" ? "canceled" : "trialing";
        await storage.upsertOrganizationPlan(organizationId, plan, normalizedStatus, {
          stripeCustomerId: object.customer ? String(object.customer) : undefined,
          stripeSubscriptionId: object.id ? String(object.id) : undefined
        });
        await storage.trackEvent({
          organizationId,
          eventName: "billing_subscription_updated",
          payload: { subscriptionId: object.id, plan, status: normalizedStatus }
        });
      }
      await storage.saveOrgData(organizationId, data);
      await storage.markWebhookEventProcessed({
        eventId: event.id,
        provider: "stripe",
        organizationId,
        eventType: event.type
      });
      res.json({ received: true });
    } finally {
      processingWebhookEvents.delete(event.id);
    }
  } catch (error) {
    next(error);
  }
});
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "businesspulse-ai-api" });
});

app.use("/api/public", (req, res, next) => {
  const ip = req.ip || "unknown";
  const nowTs = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxRequests = 40;
  const state = publicRateLimits.get(ip);
  if (!state || state.resetAt <= nowTs) {
    publicRateLimits.set(ip, { count: 1, resetAt: nowTs + windowMs });
    return next();
  }
  if (state.count >= maxRequests) {
    return res.status(429).json({ error: "Too many public requests. Try again shortly." });
  }
  state.count += 1;
  publicRateLimits.set(ip, state);
  next();
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(6) }).parse(req.body);
    const isDemoLogin = body.email.toLowerCase() === "owner@businesspulse.local";
    const demoEnabled =
      process.env.ENABLE_DEMO_CREDENTIALS === "true" ||
      (process.env.NODE_ENV !== "production" && process.env.ENABLE_DEMO_CREDENTIALS !== "false");
    if (isDemoLogin && !demoEnabled) {
      return res.status(403).json({ error: "Demo login is disabled." });
    }
    const key = `${req.ip}:${body.email.toLowerCase()}`;
    const nowTs = Date.now();
    const state = loginAttempts.get(key);
    if (state && state.blockedUntil > nowTs) {
      return res.status(429).json({ error: "Too many login attempts. Try again shortly." });
    }
    const authUser = await storage.login(body.email, body.password);
    if (!authUser) {
      const nextCount = (state?.count ?? 0) + 1;
      const blockedUntil = nextCount >= 5 ? nowTs + 10 * 60 * 1000 : 0;
      loginAttempts.set(key, { count: blockedUntil ? 0 : nextCount, blockedUntil });
      await storage.trackEvent({ eventName: "login_failure", payload: { email: body.email } });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    loginAttempts.delete(key);
    await storage.trackEvent({
      organizationId: authUser.organizationId,
      eventName: "login_success",
      payload: { email: authUser.email, role: authUser.role }
    });
    res.json({
      token: authUser.token,
      organizationId: authUser.organizationId,
      role: authUser.role,
      email: authUser.email,
      mustChangePassword: authUser.mustChangePassword
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/change-password", async (req, res, next) => {
  try {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "Missing bearer token" });
    const authUser = await storage.getAuthUser(token);
    if (!authUser) return res.status(401).json({ error: "Invalid or expired session" });
    const body = z.object({ currentPassword: z.string().min(6), nextPassword: z.string().min(8) }).parse(req.body ?? {});
    await storage.changePassword(authUser.organizationId, authUser.userId, body.currentPassword, body.nextPassword);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/trial-start", async (req, res, next) => {
  try {
    const body = z.object({
      email: z.string().email(),
      company: z.string().optional(),
      phone: z.string().optional(),
      source: z.string().default("landing")
    }).parse(req.body ?? {});
    await storage.createPublicLead(body);
    const workspace = await storage.createTrialWorkspace({ email: body.email, company: body.company, source: body.source });
    await storage.trackEvent({ organizationId: workspace.organizationId, eventName: "trial_start", payload: body });
    res.json({ ok: true, ...workspace });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/demo-request", async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      company: z.string().optional(),
      message: z.string().optional()
    }).parse(req.body ?? {});
    await storage.createDemoRequest(body);
    await storage.trackEvent({ eventName: "demo_request", payload: body });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/password-reset", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body ?? {});
    await storage.createDemoRequest({
      name: "Password Reset Request",
      email: body.email,
      message: "password_reset_request"
    });
    await storage.trackEvent({
      eventName: "password_reset_requested",
      payload: { email: body.email }
    });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/public/bootstrap-status", async (_req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    const hasUsers = await storage.hasAnyUser();
    res.json({ needsBootstrap: !hasUsers });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/bootstrap-owner", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }
    const secret = (process.env.BOOTSTRAP_SECRET ?? "").trim();
    if (!secret) return res.status(503).json({ error: "Bootstrap is not configured." });
    const provided = String(req.header("x-bootstrap-secret") ?? "").trim();
    if (!provided || provided !== secret) return res.status(401).json({ error: "Invalid bootstrap secret" });
    const body = z.object({
      email: z.string().email(),
      password: z.string().min(10),
      organizationName: z.string().min(2).max(120).optional(),
      timezone: z.string().min(2).max(80).optional()
    }).parse(req.body ?? {});
    const created = await storage.bootstrapOwner(body);
    await storage.trackEvent({
      organizationId: created.organizationId,
      eventName: "bootstrap_owner_created",
      payload: { email: created.email }
    });
    res.json({ ok: true, ...created });
  } catch (error) {
    next(error);
  }
});

app.post("/api/public/track", async (req, res, next) => {
  try {
    const body = z.object({
      eventName: z.string().min(2),
      payload: z.record(z.string(), z.any()).default({})
    }).parse(req.body ?? {});
    await storage.trackEvent({ eventName: body.eventName, payload: body.payload });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use("/api", async (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login" || req.path === "/integrations/stripe/webhook" || req.path.startsWith("/public/")) return next();
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  const authUser = await storage.getAuthUser(token);
  if (!authUser) return res.status(401).json({ error: "Invalid or expired session" });
  const mustChangeAllowed = new Set(["/auth/change-password", "/auth/logout"]);
  if (authUser.mustChangePassword && !mustChangeAllowed.has(req.path)) {
    return res.status(403).json({ error: "Password reset required before continuing." });
  }
  const plan = await storage.getOrganizationPlan(authUser.organizationId);
  if (billableWriteEndpoints.has(req.path) && plan.status !== "active" && plan.status !== "trialing") {
    return res.status(402).json({ error: "Subscription inactive. Complete billing to continue." });
  }
  Reflect.set(req, "organizationId", authUser.organizationId);
  Reflect.set(req, "role", authUser.role);
  Reflect.set(req, "userId", authUser.userId);
  Reflect.set(req, "plan", plan.plan);
  Reflect.set(req, "planStatus", plan.status);
  next();
});

app.post("/api/auth/logout", async (req, res, next) => {
  try {
    const token = req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
    if (token) await storage.revokeSession(token);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/analytics/track", async (req, res, next) => {
  try {
    const body = z.object({
      eventName: z.string().min(2),
      payload: z.record(z.string(), z.any()).default({})
    }).parse(req.body ?? {});
    await storage.trackEvent({ organizationId: org(req), eventName: body.eventName, payload: body.payload });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/organization", async (req, res, next) => {
  try {
    const organizations = await storage.getOrganizations();
    const organizationId = org(req);
    const organization = organizations.find((item) => item.id === organizationId);
    if (!organization) return res.status(404).json({ error: "Organization not found" });
    const plan = await storage.getOrganizationPlan(organizationId);
    res.json({ ...organization, subscriptionPlan: plan.plan, subscriptionStatus: plan.status });
  } catch (error) {
    next(error);
  }
});

app.get("/api/ops/metrics", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    res.json({
      startedAt: new Date(opsCounters.startedAt).toISOString(),
      uptimeSeconds: Math.max(0, Math.floor((Date.now() - opsCounters.startedAt) / 1000)),
      requests: {
        total: opsCounters.totalRequests,
        errors5xx: opsCounters.totalErrors,
        byStatusClass: opsCounters.byStatusClass
      },
      activeGuards: {
        loginAttemptBuckets: loginAttempts.size,
        publicRateLimitBuckets: publicRateLimits.size,
        inFlightWebhookEvents: processingWebhookEvents.size
      },
      hottestPaths: Array.from(opsCounters.byPath.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([path, count]) => ({ path, count }))
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/checkout", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const body = z.object({ plan: z.enum(["starter", "growth", "pro"]) }).parse(req.body ?? {});
    const organizationId = org(req);
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const appUrl = process.env.APP_BASE_URL || "http://localhost:5173";
    if (!stripeKey) throw Object.assign(new Error("Missing STRIPE_SECRET_KEY"), { status: 400 });
    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("success_url", `${appUrl}?checkout=success`);
    params.set("cancel_url", `${appUrl}?checkout=cancel`);
    params.set("metadata[organization_id]", organizationId);
    params.set("metadata[plan]", body.plan);
    params.set("subscription_data[metadata][organization_id]", organizationId);
    params.set("subscription_data[metadata][plan]", body.plan);
    const priceKey = `STRIPE_PRICE_${body.plan.toUpperCase()}`;
    const priceId = process.env[priceKey];
    if (priceId) {
      params.set("line_items[0][price]", priceId);
      params.set("line_items[0][quantity]", "1");
    } else {
      params.set("line_items[0][price_data][currency]", "usd");
      params.set("line_items[0][price_data][recurring][interval]", "month");
      params.set("line_items[0][price_data][product_data][name]", `BusinessPulse ${body.plan}`);
      params.set("line_items[0][price_data][unit_amount]", body.plan === "starter" ? "29900" : body.plan === "growth" ? "79900" : "149900");
      params.set("line_items[0][quantity]", "1");
    }
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });
    if (!response.ok) throw Object.assign(new Error(`Stripe checkout error: ${response.status}`), { status: 502 });
    const session = (await response.json()) as { id: string; url: string | null };
    await storage.trackEvent({ organizationId, eventName: "billing_checkout_created", payload: { plan: body.plan, sessionId: session.id } });
    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    next(error);
  }
});

app.post("/api/billing/activate", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const manualActivationEnabled = process.env.ENABLE_MANUAL_BILLING_ACTIVATION === "true";
    if (!manualActivationEnabled) {
      return res.status(403).json({ error: "Manual billing activation is disabled. Use Stripe checkout/webhooks." });
    }
    const body = z.object({ plan: z.enum(["starter", "growth", "pro"]), status: z.enum(["active", "trialing", "past_due", "canceled"]) }).parse(req.body ?? {});
    await storage.upsertOrganizationPlan(org(req), body.plan, body.status);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const users = await storage.listUsers(org(req));
    res.json(users);
  } catch (error) {
    next(error);
  }
});

app.post("/api/users/invite", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner"]);
    const body = z.object({
      email: z.string().email(),
      role: z.enum(["owner", "admin", "viewer"]),
      password: z.string().min(8).optional()
    }).parse(req.body);
    const organizationId = org(req);
    const plan = await storage.getOrganizationPlan(organizationId);
    const users = await storage.listUsers(organizationId);
    const maxUsers = MAX_USERS_BY_PLAN[plan.plan] ?? MAX_USERS_BY_PLAN.starter;
    if (users.length >= maxUsers) {
      return res.status(402).json({ error: `Plan user limit reached (${maxUsers}). Upgrade plan to add more users.` });
    }
    const user = await storage.inviteUser(organizationId, body.email, body.role, body.password ?? "changeme123");
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:userId/role", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner"]);
    const body = z.object({ role: z.enum(["owner", "admin", "viewer"]) }).parse(req.body);
    await storage.setUserRole(org(req), req.params.userId, body.role);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/users/:userId/status", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner"]);
    const body = z.object({ disabled: z.boolean() }).parse(req.body);
    await storage.setUserDisabled(org(req), req.params.userId, body.disabled);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/uploads", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.uploads);
  } catch (error) {
    next(error);
  }
});

app.get("/api/onboarding-status", async (req, res, next) => {
  try {
    const progress = await storage.getOnboardingProgress(org(req));
    const timeToFirstInsightSeconds =
      progress.firstUploadAt && progress.coreDatasetsCompletedAt
        ? Math.max(0, Math.round((Date.parse(progress.coreDatasetsCompletedAt) - Date.parse(progress.firstUploadAt)) / 1000))
        : null;
    res.json({
      ...progress,
      timeToFirstInsightSeconds
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const body = z.object({
      datasetType: z.enum(["customers", "leads", "jobs", "revenue", "marketing_spend"]),
      mode: z.enum(["preview", "commit"]).default("commit"),
      mappings: z.string().optional()
    }).parse(req.body);
    if (!req.file) throw Object.assign(new Error("CSV file is required"), { status: 400 });
    if (body.mode === "preview") {
      const preview = previewCsv({
        organizationId: org(req),
        datasetType: body.datasetType,
        filename: req.file.originalname,
        buffer: req.file.buffer
      });
      return res.json(preview);
    }
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const mappings = body.mappings
      ? z.array(z.object({
          sourceColumn: z.string().min(1),
          targetField: z.string().min(1),
          confidence: z.number().min(0).max(1).optional().default(1)
        })).parse(JSON.parse(body.mappings))
      : undefined;
    const result = ingestCsv({
      organizationId,
      datasetType: body.datasetType,
      filename: req.file.originalname,
      buffer: req.file.buffer,
      mappings,
      data
    });
    await storage.saveOrgData(organizationId, data);
    const progress = await storage.getOnboardingProgress(organizationId);
    const requiredDatasets = new Set(["jobs", "leads", "revenue", "marketing_spend"]);
    const latestByDataset = new Map<string, { status: string }>();
    for (const row of data.uploads) {
      if (!latestByDataset.has(row.datasetType)) latestByDataset.set(row.datasetType, { status: row.status });
    }
    const coreReady = [...requiredDatasets].every((dataset) => latestByDataset.get(dataset)?.status === "processed");
    const onboardingUpdate: { firstUploadAt?: string; coreDatasetsCompletedAt?: string } = {};
    if (!progress.firstUploadAt) onboardingUpdate.firstUploadAt = new Date().toISOString();
    if (coreReady && !progress.coreDatasetsCompletedAt) onboardingUpdate.coreDatasetsCompletedAt = new Date().toISOString();
    if (Object.keys(onboardingUpdate).length) {
      await storage.upsertOnboardingProgress(organizationId, onboardingUpdate);
    }
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/metrics", async (req, res, next) => {
  try {
    const period = periodFromQuery(req);
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const metrics = calculateMetrics(organizationId, data, period);
    generateAlerts(organizationId, data, metrics);
    generateRecommendations(organizationId, data, metrics);
    await storage.saveOrgData(organizationId, data);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

app.post("/api/ask", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin", "viewer"]);
    const body = z.object({ question: z.string().min(3), start: z.string().optional(), end: z.string().optional() }).parse(req.body);
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const period = body.start && body.end ? { start: body.start, end: body.end } : defaultPeriod();
    const metrics = calculateMetrics(organizationId, data, period);
    const answer = await answerQuestion({ organizationId, question: body.question, metrics, data });
    await storage.saveOrgData(organizationId, data);
    res.json(answer);
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const metrics = calculateMetrics(organizationId, data, periodFromQuery(req));
    generateRecommendations(organizationId, data, metrics);
    const report = generateReport(organizationId, data, metrics);
    await storage.saveOrgData(organizationId, data);
    res.json(report);
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.reports);
  } catch (error) {
    next(error);
  }
});

app.get("/api/alerts", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.alerts);
  } catch (error) {
    next(error);
  }
});

app.get("/api/recommendations", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.recommendations);
  } catch (error) {
    next(error);
  }
});

app.patch("/api/recommendations/:recommendationId/status", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin", "viewer"]);
    const body = z.object({ status: z.enum(["new", "accepted", "rejected", "completed", "dismissed"]) }).parse(req.body ?? {});
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const recommendation = data.recommendations.find((item) => item.id === req.params.recommendationId);
    if (!recommendation) return res.status(404).json({ error: "Recommendation not found" });
    recommendation.status = body.status;
    recommendation.updatedAt = new Date().toISOString();
    await storage.saveOrgData(organizationId, data);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/recommendations/from-answer", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin", "viewer"]);
    const body = z.object({
      title: z.string().min(3),
      description: z.string().min(3),
      priority: z.enum(["low", "medium", "high"]).default("medium"),
      expectedImpact: z.string().min(2).default("Operational clarity"),
      confidence: z.enum(["low", "medium", "high"]).default("medium"),
      reason: z.string().min(2).default("Saved from Ask AI")
    }).parse(req.body ?? {});
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const createdAt = new Date().toISOString();
    const recommendation = {
      id: `rec_${crypto.randomUUID()}`,
      organizationId,
      title: body.title,
      description: body.description,
      reason: body.reason,
      priority: body.priority,
      expectedImpact: body.expectedImpact,
      confidence: body.confidence,
      status: "new" as const,
      requiresApproval: true,
      createdAt,
      updatedAt: createdAt
    };
    data.recommendations.unshift(recommendation);
    await storage.saveOrgData(organizationId, data);
    res.json(recommendation);
  } catch (error) {
    next(error);
  }
});

app.get("/api/agent-runs", async (req, res, next) => {
  try {
    const data = await storage.getOrgData(org(req));
    res.json(data.agentRuns);
  } catch (error) {
    next(error);
  }
});

app.post("/api/integrations/stripe/sync", async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const body = z.object({ limit: z.number().int().min(1).max(100).default(25) }).parse(req.body ?? {});
    const organizationId = org(req);
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) throw Object.assign(new Error("Missing Stripe secret key"), { status: 400 });

    const response = await fetch(`https://api.stripe.com/v1/charges?limit=${body.limit}`, {
      headers: { Authorization: `Bearer ${secretKey}` }
    });
    if (!response.ok) throw Object.assign(new Error(`Stripe API error: ${response.status}`), { status: 502 });
    const payload = (await response.json()) as { data?: Array<{ id: string; amount: number; created: number; payment_method_details?: { type?: string } }> };
    const data = await storage.getOrgData(organizationId);
    const createdAt = new Date().toISOString();
    let inserted = 0;
    for (const charge of payload.data ?? []) {
      if (data.revenue.some((row) => row.externalId === charge.id)) continue;
      data.revenue.push({
        id: `rev_${crypto.randomUUID()}`,
        organizationId,
        externalId: charge.id,
        amount: charge.amount / 100,
        paymentMethod: charge.payment_method_details?.type ?? "stripe",
        paidAt: new Date(charge.created * 1000).toISOString(),
        createdAt,
        updatedAt: createdAt
      });
      inserted += 1;
    }
    await storage.saveOrgData(organizationId, data);
    res.json({ syncedCharges: inserted, scannedCharges: (payload.data ?? []).length });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; status?: number };
  const statusCode = err.status ?? 500;
  const safeMessage = sanitizeErrorMessage(err.message ?? "Unexpected server error");
  const requestId = String(Reflect.get(req, "requestId") ?? "");
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    event: "request_failure",
    requestId,
    method: req.method,
    path: req.path,
    statusCode,
    message: safeMessage
  }));
  const clientMessage = statusCode >= 500 ? "Unexpected server error" : safeMessage;
  res.status(statusCode).json({ error: clientMessage, requestId });
});

export { app };
export async function ensureInitialized() {
  await initializeServer();
}

if (!process.env.VERCEL) {
  void (async () => {
    await ensureInitialized();
    app.listen(port, () => {
      const mode = process.env.DATABASE_URL ? "postgres" : "memory";
      console.log(`BusinessPulse AI API listening on http://localhost:${port} (${mode} mode)`);
    });
  })();
}

function org(req: express.Request) {
  return String(Reflect.get(req, "organizationId"));
}

function requireRole(req: express.Request, res: express.Response, allowed: AuthRole[]) {
  const role = String(Reflect.get(req, "role")) as AuthRole;
  if (!allowed.includes(role)) {
    res.status(403).json({ error: "Insufficient role permissions" });
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
}

function periodFromQuery(req: express.Request) {
  const parsed = z.object({ start: z.string().optional(), end: z.string().optional() }).parse(req.query);
  return parsed.start && parsed.end ? { start: parsed.start, end: parsed.end } : defaultPeriod();
}

function buildCorsOptions(): cors.CorsOptions {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return {};
  const configured = (process.env.APP_CORS_ORIGINS ?? process.env.APP_BASE_URL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set(configured);
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error("CORS origin not allowed"));
    }
  };
}

function sanitizeErrorMessage(message: string) {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/"password"\s*:\s*"[^"]*"/gi, "\"password\":\"[redacted]\"")
    .replace(/"currentPassword"\s*:\s*"[^"]*"/gi, "\"currentPassword\":\"[redacted]\"")
    .replace(/"nextPassword"\s*:\s*"[^"]*"/gi, "\"nextPassword\":\"[redacted]\"");
}

async function maybeSendOpsAlert() {
  const webhook = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!webhook) return;
  const total = opsCounters.totalRequests;
  if (total < 50) return;
  const ratio = opsCounters.totalErrors / Math.max(1, total);
  const backlog = processingWebhookEvents.size;
  let key = "";
  let text = "";
  if (ratio >= 0.03) {
    key = "critical_5xx_ratio";
    text = `Critical 5xx ratio ${(ratio * 100).toFixed(2)}% (errors=${opsCounters.totalErrors}, total=${total})`;
  } else if (ratio >= 0.01) {
    key = "warn_5xx_ratio";
    text = `Warning 5xx ratio ${(ratio * 100).toFixed(2)}% (errors=${opsCounters.totalErrors}, total=${total})`;
  } else if (backlog > 20) {
    key = "warn_webhook_backlog";
    text = `Warning webhook backlog in-flight=${backlog}`;
  } else {
    return;
  }
  const now = Date.now();
  const cooldownMs = 5 * 60 * 1000;
  const last = alertState.get(key) ?? 0;
  if (now - last < cooldownMs) return;
  alertState.set(key, now);
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "businesspulse-ai-api",
        event: key,
        text,
        ts: new Date().toISOString()
      })
    });
  } catch {
    // No throw: alert delivery must not impact API request path.
  }
}

async function resolveOrganizationIdFromStripeEvent(object: any): Promise<string | null> {
  const metadataOrgId = object?.metadata?.organization_id;
  if (metadataOrgId) return String(metadataOrgId);
  return storage.findOrganizationIdByStripeRefs({
    stripeSubscriptionId: object?.subscription ? String(object.subscription) : object?.id ? String(object.id) : undefined,
    stripeCustomerId: object?.customer ? String(object.customer) : undefined,
    stripeCheckoutSessionId: object?.object === "checkout.session" && object?.id ? String(object.id) : undefined
  });
}

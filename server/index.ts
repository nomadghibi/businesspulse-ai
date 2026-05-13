import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { z } from "zod";
import { answerQuestion } from "./ai";
import { ingestCsv } from "./csv";
import { calculateMetrics, generateAlerts, generateRecommendations, generateReport } from "./metrics";
import { type AuthRole, getStorage } from "./storage";
import { defaultPeriod } from "./utils";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const port = Number(process.env.PORT ?? 5055);
const storage = getStorage();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "businesspulse-ai-api" });
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), password: z.string().min(6) }).parse(req.body);
    const authUser = await storage.login(body.email, body.password);
    if (!authUser) return res.status(401).json({ error: "Invalid credentials" });
    res.json({
      token: authUser.token,
      organizationId: authUser.organizationId,
      role: authUser.role,
      email: authUser.email
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", async (req, res, next) => {
  if (req.path === "/health" || req.path === "/auth/login") return next();
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  const authUser = await storage.getAuthUser(token);
  if (!authUser) return res.status(401).json({ error: "Invalid or expired session" });
  Reflect.set(req, "organizationId", authUser.organizationId);
  Reflect.set(req, "role", authUser.role);
  Reflect.set(req, "userId", authUser.userId);
  next();
});

app.get("/api/organization", async (_req, res, next) => {
  try {
    const organizations = await storage.getOrganizations();
    res.json(organizations[0]);
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

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  try {
    requireRole(req, res, ["owner", "admin"]);
    const body = z.object({ datasetType: z.enum(["customers", "leads", "jobs", "revenue", "marketing_spend"]) }).parse(req.body);
    if (!req.file) throw Object.assign(new Error("CSV file is required"), { status: 400 });
    const organizationId = org(req);
    const data = await storage.getOrgData(organizationId);
    const result = ingestCsv({
      organizationId,
      datasetType: body.datasetType,
      filename: req.file.originalname,
      buffer: req.file.buffer,
      data
    });
    await storage.saveOrgData(organizationId, data);
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
    const body = z.object({ secretKey: z.string().optional(), limit: z.number().int().min(1).max(100).default(25) }).parse(req.body ?? {});
    const organizationId = org(req);
    const secretKey = body.secretKey || process.env.STRIPE_SECRET_KEY;
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

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const err = error as { message?: string; status?: number };
  res.status(err.status ?? 500).json({ error: err.message ?? "Unexpected server error" });
});

void (async () => {
  await storage.initialize();
  app.listen(port, () => {
    const mode = process.env.DATABASE_URL ? "postgres" : "memory";
    console.log(`BusinessPulse AI API listening on http://localhost:${port} (${mode} mode)`);
  });
})();

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

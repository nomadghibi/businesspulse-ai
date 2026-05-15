import { Pool } from "pg";
import type { AgentRun, Organization } from "../shared/types";
import { DEMO_ORG_ID, now } from "./utils.js";
import { getOrgData as getMemoryOrgData, organizations, seedOrg, type OrgData } from "./store.js";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compareSync, hashSync } from "bcryptjs";

export type AuthRole = "owner" | "admin" | "viewer";
export interface AuthUser {
  userId: string;
  organizationId: string;
  email: string;
  role: AuthRole;
  token: string;
  mustChangePassword: boolean;
}

export interface Storage {
  initialize(): Promise<void>;
  getOrganizations(): Promise<Organization[]>;
  getOrgData(organizationId: string): Promise<OrgData>;
  saveOrgData(organizationId: string, data: OrgData): Promise<void>;
  createAgentRun(organizationId: string, input: unknown, triggerType: AgentRun["triggerType"], agentName?: string): Promise<AgentRun>;
  login(email: string, password: string): Promise<AuthUser | null>;
  getAuthUser(token: string): Promise<AuthUser | null>;
  revokeSession(token: string): Promise<void>;
  listUsers(organizationId: string): Promise<Array<{ userId: string; email: string; role: AuthRole; disabled: boolean }>>;
  inviteUser(organizationId: string, email: string, role: AuthRole, password: string): Promise<{ userId: string; email: string; role: AuthRole }>;
  setUserRole(organizationId: string, userId: string, role: AuthRole): Promise<void>;
  setUserDisabled(organizationId: string, userId: string, disabled: boolean): Promise<void>;
  createPublicLead(input: { email: string; company?: string; phone?: string; source: string }): Promise<void>;
  createTrialWorkspace(input: { email: string; company?: string; source: string }): Promise<{
    organizationId: string;
    organizationName: string;
    ownerEmail: string;
    temporaryPassword: string;
  }>;
  createDemoRequest(input: { name: string; email: string; company?: string; message?: string }): Promise<void>;
  changePassword(organizationId: string, userId: string, currentPassword: string, nextPassword: string): Promise<void>;
  trackEvent(input: { organizationId?: string; eventName: string; payload: Record<string, unknown> }): Promise<void>;
  getOrganizationPlan(organizationId: string): Promise<{ plan: string; status: string }>;
  upsertOrganizationPlan(
    organizationId: string,
    plan: string,
    status: string,
    refs?: { stripeCustomerId?: string; stripeSubscriptionId?: string; stripeCheckoutSessionId?: string }
  ): Promise<void>;
  findOrganizationIdByStripeRefs(refs: { stripeCustomerId?: string; stripeSubscriptionId?: string; stripeCheckoutSessionId?: string }): Promise<string | null>;
  hasWebhookEventProcessed(eventId: string, provider: string): Promise<boolean>;
  markWebhookEventProcessed(input: { eventId: string; provider: string; organizationId?: string; eventType: string }): Promise<boolean>;
  getOnboardingProgress(organizationId: string): Promise<{ firstUploadAt: string | null; coreDatasetsCompletedAt: string | null }>;
  upsertOnboardingProgress(
    organizationId: string,
    progress: { firstUploadAt?: string; coreDatasetsCompletedAt?: string }
  ): Promise<void>;
}

class MemoryStorage implements Storage {
  private sessions = new Map<string, AuthUser>();
  private users = new Map<string, { userId: string; organizationId: string; email: string; role: AuthRole; disabled: boolean; passwordHash: string; mustChangePassword: boolean }>([
    ["user_demo_owner", { userId: "user_demo_owner", organizationId: DEMO_ORG_ID, email: "owner@businesspulse.local", role: "owner", disabled: false, passwordHash: hashPassword("demo1234"), mustChangePassword: false }]
  ]);
  private publicLeads: Array<{ id: string; email: string; company?: string; phone?: string; source: string }> = [];
  private demoRequests: Array<{ id: string; name: string; email: string; company?: string; message?: string }> = [];
  private events: Array<{ id: string; organizationId?: string; eventName: string; payload: Record<string, unknown> }> = [];
  private plans = new Map<string, { plan: string; status: string }>([[DEMO_ORG_ID, { plan: "starter", status: "trialing" }]]);
  private processedWebhookEvents = new Set<string>();
  private onboarding = new Map<string, { firstUploadAt: string | null; coreDatasetsCompletedAt: string | null }>();
  async initialize() {}
  async getOrganizations() {
    return organizations;
  }
  async getOrgData(organizationId: string) {
    return getMemoryOrgData(organizationId);
  }
  async saveOrgData() {}
  async createAgentRun(organizationId: string, input: unknown, triggerType: AgentRun["triggerType"], agentName = "Business Analyst Agent") {
    const data = getMemoryOrgData(organizationId);
    const run: AgentRun = {
      id: `run_${crypto.randomUUID()}`,
      organizationId,
      agentName,
      triggerType,
      input,
      status: "running",
      createdAt: now(),
      updatedAt: now()
    };
    data.agentRuns.unshift(run);
    return run;
  }
  async login(email: string, password: string) {
    const found = [...this.users.values()].find((item) => item.email === email);
    if (!found || !verifyPassword(password, found.passwordHash) || found.disabled) return null;
    const token = randomBytes(24).toString("hex");
    const authUser: AuthUser = {
      userId: found.userId,
      organizationId: found.organizationId,
      email,
      role: found.role,
      token,
      mustChangePassword: found.mustChangePassword
    };
    this.sessions.set(token, authUser);
    return authUser;
  }
  async getAuthUser(token: string) {
    return this.sessions.get(token) ?? null;
  }
  async revokeSession(token: string) {
    this.sessions.delete(token);
  }
  async listUsers(organizationId: string) {
    return [...this.users.values()]
      .filter((item) => item.organizationId === organizationId)
      .map(({ userId, email, role, disabled }) => ({ userId, email, role, disabled }));
  }
  async inviteUser(organizationId: string, email: string, role: AuthRole, password: string) {
    const userId = `user_${crypto.randomUUID()}`;
    this.users.set(userId, { userId, organizationId, email, role, disabled: false, passwordHash: hashPassword(password), mustChangePassword: false });
    return { userId, email, role };
  }
  async setUserRole(organizationId: string, userId: string, role: AuthRole) {
    const user = this.users.get(userId);
    if (!user || user.organizationId !== organizationId) throw Object.assign(new Error("User not found"), { status: 404 });
    user.role = role;
    this.users.set(userId, user);
  }
  async setUserDisabled(organizationId: string, userId: string, disabled: boolean) {
    const user = this.users.get(userId);
    if (!user || user.organizationId !== organizationId) throw Object.assign(new Error("User not found"), { status: 404 });
    user.disabled = disabled;
    this.users.set(userId, user);
  }
  async createPublicLead(input: { email: string; company?: string; phone?: string; source: string }) {
    this.publicLeads.push({ id: `lead_${crypto.randomUUID()}`, ...input });
  }
  async createTrialWorkspace(input: { email: string; company?: string; source: string }) {
    const existing = [...this.users.values()].find((user) => user.email.toLowerCase() === input.email.toLowerCase());
    if (existing) throw Object.assign(new Error("Email already registered"), { status: 409 });
    const organizationId = `org_${crypto.randomUUID()}`;
    const organizationName = input.company?.trim() || `${input.email.split("@")[0]} Home Services`;
    organizations.push({
      id: organizationId,
      name: organizationName,
      businessType: "Home services",
      timezone: "America/New_York"
    });
    const temporaryPassword = generateTemporaryPassword();
    const userId = `user_${crypto.randomUUID()}`;
    this.users.set(userId, {
      userId,
      organizationId,
      email: input.email.toLowerCase(),
      role: "owner",
      disabled: false,
      passwordHash: hashPassword(temporaryPassword),
      mustChangePassword: true
    });
    this.plans.set(organizationId, { plan: "starter", status: "trialing" });
    return { organizationId, organizationName, ownerEmail: input.email.toLowerCase(), temporaryPassword };
  }
  async createDemoRequest(input: { name: string; email: string; company?: string; message?: string }) {
    this.demoRequests.push({ id: `demo_${crypto.randomUUID()}`, ...input });
  }
  async changePassword(organizationId: string, userId: string, currentPassword: string, nextPassword: string) {
    const user = this.users.get(userId);
    if (!user || user.organizationId !== organizationId) throw Object.assign(new Error("User not found"), { status: 404 });
    if (!verifyPassword(currentPassword, user.passwordHash)) throw Object.assign(new Error("Current password is incorrect"), { status: 401 });
    user.passwordHash = hashPassword(nextPassword);
    user.mustChangePassword = false;
    this.users.set(userId, user);
  }
  async trackEvent(input: { organizationId?: string; eventName: string; payload: Record<string, unknown> }) {
    this.events.push({ id: `evt_${crypto.randomUUID()}`, ...input });
  }
  async getOrganizationPlan(organizationId: string) {
    return this.plans.get(organizationId) ?? { plan: "starter", status: "trialing" };
  }
  async upsertOrganizationPlan(organizationId: string, plan: string, status: string) {
    this.plans.set(organizationId, { plan, status });
  }
  async findOrganizationIdByStripeRefs() {
    return null;
  }
  async hasWebhookEventProcessed(eventId: string, provider: string) {
    return this.processedWebhookEvents.has(`${provider}:${eventId}`);
  }
  async markWebhookEventProcessed(input: { eventId: string; provider: string; organizationId?: string; eventType: string }) {
    const key = `${input.provider}:${input.eventId}`;
    if (this.processedWebhookEvents.has(key)) return false;
    this.processedWebhookEvents.add(key);
    return true;
  }
  async getOnboardingProgress(organizationId: string) {
    return this.onboarding.get(organizationId) ?? { firstUploadAt: null, coreDatasetsCompletedAt: null };
  }
  async upsertOnboardingProgress(organizationId: string, progress: { firstUploadAt?: string; coreDatasetsCompletedAt?: string }) {
    const existing = this.onboarding.get(organizationId) ?? { firstUploadAt: null, coreDatasetsCompletedAt: null };
    this.onboarding.set(organizationId, {
      firstUploadAt: progress.firstUploadAt ?? existing.firstUploadAt,
      coreDatasetsCompletedAt: progress.coreDatasetsCompletedAt ?? existing.coreDatasetsCompletedAt
    });
  }
}

class PostgresStorage implements Storage {
  private pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    await this.applyMigration("001_normalized_schema", resolve(process.cwd(), "server/migrations/001_normalized_schema.sql"));
    await this.applyMigration("002_users_relational_and_indexes", resolve(process.cwd(), "server/migrations/002_users_relational_and_indexes.sql"));
    await this.applyMigration("003_conversion_analytics_billing", resolve(process.cwd(), "server/migrations/003_conversion_analytics_billing.sql"));
    await this.applyMigration("004_webhook_idempotency", resolve(process.cwd(), "server/migrations/004_webhook_idempotency.sql"));
    await this.applyMigration("005_user_password_reset_flag", resolve(process.cwd(), "server/migrations/005_user_password_reset_flag.sql"));
    await this.applyMigration("006_onboarding_progress", resolve(process.cwd(), "server/migrations/006_onboarding_progress.sql"));

    const org = organizations[0];
    const existing = await this.pool.query("select id from organizations where id = $1", [DEMO_ORG_ID]);
    if (!existing.rowCount) {
      const data = seedOrg(org.id);
      await this.pool.query(
        `insert into organizations (id, name, business_type, timezone, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [org.id, org.name, org.businessType, org.timezone]
      );
      await this.saveOrgData(org.id, data);
    }
    const allowDemoCredentials =
      process.env.ENABLE_DEMO_CREDENTIALS === "true" ||
      (process.env.NODE_ENV !== "production" && process.env.ENABLE_DEMO_CREDENTIALS !== "false");
    if (allowDemoCredentials) {
      await this.pool.query(
        `insert into users (id, email, password_hash, disabled) values ($1, $2, $3, false)
         on conflict (id) do update set email = excluded.email, password_hash = excluded.password_hash`,
        ["user_demo_owner", "owner@businesspulse.local", hashPassword("demo1234")]
      );
      await this.pool.query(
        `insert into organization_members (id, organization_id, user_id, role)
         values ($1, $2, $3, 'owner')
         on conflict (id) do update set role = excluded.role`,
        ["member_demo_owner", org.id, "user_demo_owner"]
      );
    }
  }

  async getOrganizations() {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      business_type: string;
      timezone: string;
    }>("select id, name, business_type, timezone from organizations order by created_at asc");
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      businessType: row.business_type,
      timezone: row.timezone
    }));
  }

  async getOrgData(organizationId: string) {
    const [customers, leads, jobs, revenue, marketingSpend, dataSources, uploads, reports, alerts, recommendations, agentRuns] = await Promise.all([
      this.selectCoreCustomers(organizationId),
      this.selectCoreLeads(organizationId),
      this.selectCoreJobs(organizationId),
      this.selectCoreRevenue(organizationId),
      this.selectCoreMarketing(organizationId),
      this.selectPayloads("data_sources", organizationId),
      this.selectPayloads("file_uploads", organizationId),
      this.selectPayloads("reports", organizationId),
      this.selectPayloads("alerts", organizationId),
      this.selectPayloads("recommendations", organizationId),
      this.selectPayloads("agent_runs", organizationId)
    ]);
    return { customers, leads, jobs, revenue, marketingSpend, dataSources, uploads, reports, alerts, recommendations, agentRuns };
  }

  async saveOrgData(organizationId: string, data: OrgData) {
    await this.pool.query("begin");
    try {
      await this.insertPayloads("customers", organizationId, data.customers);
      await this.insertPayloads("leads", organizationId, data.leads);
      await this.insertPayloads("jobs", organizationId, data.jobs);
      await this.insertPayloads("revenue_transactions", organizationId, data.revenue);
      await this.insertPayloads("marketing_spend", organizationId, data.marketingSpend);
      await this.insertPayloads("data_sources", organizationId, data.dataSources);
      await this.insertPayloads("file_uploads", organizationId, data.uploads);
      await this.insertPayloads("reports", organizationId, data.reports);
      await this.insertPayloads("alerts", organizationId, data.alerts);
      await this.insertPayloads("recommendations", organizationId, data.recommendations);
      await this.insertPayloads("agent_runs", organizationId, data.agentRuns);
      await this.insertCoreCustomers(organizationId, data.customers);
      await this.insertCoreLeads(organizationId, data.leads);
      await this.insertCoreJobs(organizationId, data.jobs);
      await this.insertCoreRevenue(organizationId, data.revenue);
      await this.insertCoreMarketing(organizationId, data.marketingSpend);
      await this.pool.query("commit");
    } catch (error) {
      await this.pool.query("rollback");
      throw error;
    }
  }

  async createAgentRun(organizationId: string, input: unknown, triggerType: AgentRun["triggerType"], agentName = "Business Analyst Agent") {
    const data = await this.getOrgData(organizationId);
    const run: AgentRun = {
      id: `run_${crypto.randomUUID()}`,
      organizationId,
      agentName,
      triggerType,
      input,
      status: "running",
      createdAt: now(),
      updatedAt: now()
    };
    data.agentRuns.unshift(run);
    await this.saveOrgData(organizationId, data);
    return run;
  }
  async login(email: string, password: string) {
    const { rows } = await this.pool.query<{ id: string; password_hash: string; disabled: boolean; must_change_password: boolean }>("select id, password_hash, disabled, must_change_password from users where email = $1", [email]);
    const user = rows[0];
    if (!user || user.disabled) return null;
    const valid = verifyPassword(password, user.password_hash);
    if (!valid) return null;
    if (!isBcryptHash(user.password_hash)) {
      await this.pool.query("update users set password_hash = $2 where id = $1", [user.id, hashPassword(password)]);
    }
    const membership = await this.pool.query<{ organization_id: string; role: AuthRole }>(
      "select organization_id, role from organization_members where user_id = $1 order by created_at asc limit 1",
      [user.id]
    );
    const member = membership.rows[0];
    if (!member) return null;
    const token = randomBytes(32).toString("hex");
    await this.pool.query(
      `insert into sessions (token_hash, user_id, organization_id, expires_at)
       values ($1, $2, $3, now() + interval '7 days')`,
      [hashToken(token), user.id, member.organization_id]
    );
    return { userId: user.id, organizationId: member.organization_id, email, role: member.role, token, mustChangePassword: user.must_change_password };
  }
  async getAuthUser(token: string) {
    const { rows } = await this.pool.query<{ user_id: string; organization_id: string; email: string; role: AuthRole; disabled: boolean; must_change_password: boolean }>(
      `select s.user_id, s.organization_id, u.email, m.role, u.disabled, u.must_change_password
       from sessions s
       join users u on u.id = s.user_id
       join organization_members m on m.user_id = s.user_id and m.organization_id = s.organization_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.disabled) return null;
    return { userId: row.user_id, organizationId: row.organization_id, email: row.email, role: row.role, token, mustChangePassword: row.must_change_password };
  }
  async revokeSession(token: string) {
    await this.pool.query("delete from sessions where token_hash = $1", [hashToken(token)]);
  }
  async listUsers(organizationId: string) {
    const { rows } = await this.pool.query<{ user_id: string; email: string; role: AuthRole; disabled: boolean }>(
      `select m.user_id, u.email, m.role, u.disabled
       from organization_members m
       join users u on u.id = m.user_id
       where m.organization_id = $1
       order by m.created_at asc`,
      [organizationId]
    );
    return rows.map((row) => ({ userId: row.user_id, email: row.email, role: row.role, disabled: row.disabled }));
  }
  async inviteUser(organizationId: string, email: string, role: AuthRole, password: string) {
    const userId = `user_${crypto.randomUUID()}`;
    await this.pool.query("begin");
    try {
      await this.pool.query(`insert into users (id, email, password_hash, disabled, must_change_password) values ($1, $2, $3, false, false)`, [userId, email, hashPassword(password)]);
      await this.pool.query(`insert into organization_members (id, organization_id, user_id, role) values ($1, $2, $3, $4)`, [`member_${crypto.randomUUID()}`, organizationId, userId, role]);
      await this.pool.query("commit");
      return { userId, email, role };
    } catch (error) {
      await this.pool.query("rollback");
      throw error;
    }
  }
  async setUserRole(organizationId: string, userId: string, role: AuthRole) {
    const result = await this.pool.query(`update organization_members set role = $3 where organization_id = $1 and user_id = $2`, [organizationId, userId, role]);
    if (!result.rowCount) throw Object.assign(new Error("User not found"), { status: 404 });
  }
  async setUserDisabled(organizationId: string, userId: string, disabled: boolean) {
    const result = await this.pool.query(
      `update users u
       set disabled = $3
       from organization_members m
       where m.organization_id = $1 and m.user_id = $2 and u.id = m.user_id`,
      [organizationId, userId, disabled]
    );
    if (!result.rowCount) throw Object.assign(new Error("User not found"), { status: 404 });
  }
  async createPublicLead(input: { email: string; company?: string; phone?: string; source: string }) {
    await this.pool.query(
      `insert into public_leads (id, email, company, phone, source) values ($1,$2,$3,$4,$5)`,
      [`lead_${crypto.randomUUID()}`, input.email, input.company ?? null, input.phone ?? null, input.source]
    );
  }
  async createTrialWorkspace(input: { email: string; company?: string; source: string }) {
    const email = input.email.toLowerCase();
    const existing = await this.pool.query("select 1 from users where email = $1 limit 1", [email]);
    if ((existing.rowCount ?? 0) > 0) throw Object.assign(new Error("Email already registered"), { status: 409 });
    const organizationId = `org_${crypto.randomUUID()}`;
    const organizationName = input.company?.trim() || `${email.split("@")[0]} Home Services`;
    const userId = `user_${crypto.randomUUID()}`;
    const memberId = `member_${crypto.randomUUID()}`;
    const temporaryPassword = generateTemporaryPassword();
    await this.pool.query("begin");
    try {
      await this.pool.query(
        `insert into organizations (id, name, business_type, timezone, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [organizationId, organizationName, "Home services", "America/New_York"]
      );
      await this.pool.query(
        `insert into users (id, email, password_hash, disabled, must_change_password) values ($1, $2, $3, false, true)`,
        [userId, email, hashPassword(temporaryPassword)]
      );
      await this.pool.query(
        `insert into organization_members (id, organization_id, user_id, role) values ($1, $2, $3, 'owner')`,
        [memberId, organizationId, userId]
      );
      await this.pool.query("commit");
    } catch (error) {
      await this.pool.query("rollback");
      throw error;
    }
    await this.upsertOrganizationPlan(organizationId, "starter", "trialing");
    return { organizationId, organizationName, ownerEmail: email, temporaryPassword };
  }
  async createDemoRequest(input: { name: string; email: string; company?: string; message?: string }) {
    await this.pool.query(
      `insert into demo_requests (id, name, email, company, message) values ($1,$2,$3,$4,$5)`,
      [`demo_${crypto.randomUUID()}`, input.name, input.email, input.company ?? null, input.message ?? null]
    );
  }
  async changePassword(organizationId: string, userId: string, currentPassword: string, nextPassword: string) {
    const existing = await this.pool.query<{ password_hash: string }>(
      `select u.password_hash
       from users u
       join organization_members m on m.user_id = u.id
       where u.id = $1 and m.organization_id = $2
       limit 1`,
      [userId, organizationId]
    );
    const row = existing.rows[0];
    if (!row) throw Object.assign(new Error("User not found"), { status: 404 });
    if (!verifyPassword(currentPassword, row.password_hash)) throw Object.assign(new Error("Current password is incorrect"), { status: 401 });
    await this.pool.query(
      `update users
       set password_hash = $2, must_change_password = false
       where id = $1`,
      [userId, hashPassword(nextPassword)]
    );
  }
  async trackEvent(input: { organizationId?: string; eventName: string; payload: Record<string, unknown> }) {
    await this.pool.query(
      `insert into analytics_events (id, organization_id, event_name, payload) values ($1,$2,$3,$4::jsonb)`,
      [`evt_${crypto.randomUUID()}`, input.organizationId ?? null, input.eventName, JSON.stringify(input.payload)]
    );
  }
  async getOrganizationPlan(organizationId: string) {
    const { rows } = await this.pool.query<{ subscription_plan: string; subscription_status: string }>(
      "select subscription_plan, subscription_status from organizations where id = $1",
      [organizationId]
    );
    const row = rows[0];
    if (!row) throw Object.assign(new Error("Organization not found"), { status: 404 });
    return { plan: row.subscription_plan, status: row.subscription_status };
  }
  async upsertOrganizationPlan(
    organizationId: string,
    plan: string,
    status: string,
    refs?: { stripeCustomerId?: string; stripeSubscriptionId?: string; stripeCheckoutSessionId?: string }
  ) {
    await this.pool.query(
      "update organizations set subscription_plan = $2, subscription_status = $3, updated_at = now() where id = $1",
      [organizationId, plan, status]
    );
    await this.pool.query(
      `insert into billing_subscriptions (id, organization_id, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id, plan, status, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,now())
       on conflict (id) do update set
         stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_subscriptions.stripe_customer_id),
         stripe_subscription_id = coalesce(excluded.stripe_subscription_id, billing_subscriptions.stripe_subscription_id),
         stripe_checkout_session_id = coalesce(excluded.stripe_checkout_session_id, billing_subscriptions.stripe_checkout_session_id),
         plan = excluded.plan,
         status = excluded.status,
         updated_at = now()`,
      [
        `sub_${organizationId}`,
        organizationId,
        refs?.stripeCustomerId ?? null,
        refs?.stripeSubscriptionId ?? null,
        refs?.stripeCheckoutSessionId ?? null,
        plan,
        status
      ]
    );
  }
  async findOrganizationIdByStripeRefs(refs: { stripeCustomerId?: string; stripeSubscriptionId?: string; stripeCheckoutSessionId?: string }) {
    const where: string[] = [];
    const values: string[] = [];
    if (refs.stripeSubscriptionId) {
      values.push(refs.stripeSubscriptionId);
      where.push(`stripe_subscription_id = $${values.length}`);
    }
    if (refs.stripeCustomerId) {
      values.push(refs.stripeCustomerId);
      where.push(`stripe_customer_id = $${values.length}`);
    }
    if (refs.stripeCheckoutSessionId) {
      values.push(refs.stripeCheckoutSessionId);
      where.push(`stripe_checkout_session_id = $${values.length}`);
    }
    if (!where.length) return null;
    const result = await this.pool.query<{ organization_id: string }>(
      `select organization_id
       from billing_subscriptions
       where ${where.join(" or ")}
       order by updated_at desc
       limit 1`,
      values
    );
    return result.rows[0]?.organization_id ?? null;
  }
  async hasWebhookEventProcessed(eventId: string, _provider: string) {
    const result = await this.pool.query("select 1 from processed_webhook_events where id = $1 limit 1", [eventId]);
    return (result.rowCount ?? 0) > 0;
  }
  async markWebhookEventProcessed(input: { eventId: string; provider: string; organizationId?: string; eventType: string }) {
    const result = await this.pool.query(
      `insert into processed_webhook_events (id, provider, organization_id, event_type)
       values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [input.eventId, input.provider, input.organizationId ?? null, input.eventType]
    );
    return result.rowCount === 1;
  }
  async getOnboardingProgress(organizationId: string) {
    const { rows } = await this.pool.query<{ first_upload_at: Date | null; core_datasets_completed_at: Date | null }>(
      `select first_upload_at, core_datasets_completed_at
       from onboarding_progress
       where organization_id = $1`,
      [organizationId]
    );
    const row = rows[0];
    if (!row) return { firstUploadAt: null, coreDatasetsCompletedAt: null };
    return {
      firstUploadAt: row.first_upload_at ? row.first_upload_at.toISOString() : null,
      coreDatasetsCompletedAt: row.core_datasets_completed_at ? row.core_datasets_completed_at.toISOString() : null
    };
  }
  async upsertOnboardingProgress(organizationId: string, progress: { firstUploadAt?: string; coreDatasetsCompletedAt?: string }) {
    await this.pool.query(
      `insert into onboarding_progress (organization_id, first_upload_at, core_datasets_completed_at, updated_at)
       values ($1, $2, $3, now())
       on conflict (organization_id) do update set
         first_upload_at = coalesce(onboarding_progress.first_upload_at, excluded.first_upload_at),
         core_datasets_completed_at = coalesce(onboarding_progress.core_datasets_completed_at, excluded.core_datasets_completed_at),
         updated_at = now()`,
      [organizationId, progress.firstUploadAt ?? null, progress.coreDatasetsCompletedAt ?? null]
    );
  }

  private async selectPayloads(table: string, organizationId: string) {
    const { rows } = await this.pool.query<{ payload: unknown }>(
      `select payload from ${table} where organization_id = $1`,
      [organizationId]
    );
    return rows.map((row) => row.payload) as any[];
  }
  private async insertPayloads(table: string, organizationId: string, rows: Array<{ id: string }>) {
    for (const row of rows) {
      await this.pool.query(`insert into ${table} (id, organization_id, payload) values ($1, $2, $3::jsonb)
                             on conflict (id) do update set organization_id = excluded.organization_id, payload = excluded.payload`, [
        row.id,
        organizationId,
        JSON.stringify(row)
      ]);
    }
  }
  private async selectCoreCustomers(organizationId: string) {
    const { rows } = await this.pool.query(
      `select id, organization_id, external_id, name, email, phone, city, state, zip, lead_source, first_seen_at, created_at, updated_at
       from bp_customers where organization_id = $1`,
      [organizationId]
    );
    return rows.map((row: any) => ({
      id: row.id, organizationId: row.organization_id, externalId: row.external_id, name: row.name, email: row.email, phone: row.phone,
      city: row.city, state: row.state, zip: row.zip, leadSource: row.lead_source, firstSeenAt: row.first_seen_at?.toISOString(),
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
  }
  private async selectCoreLeads(organizationId: string) {
    const { rows } = await this.pool.query(`select * from bp_leads where organization_id = $1`, [organizationId]);
    return rows.map((row: any) => ({
      id: row.id, organizationId: row.organization_id, externalId: row.external_id, customerExternalId: row.customer_external_id, source: row.source,
      campaign: row.campaign, status: row.status, estimatedValue: row.estimated_value ? Number(row.estimated_value) : undefined,
      createdAtSource: row.created_at_source?.toISOString(), bookedAt: row.booked_at?.toISOString(), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
  }
  private async selectCoreJobs(organizationId: string) {
    const { rows } = await this.pool.query(`select * from bp_jobs where organization_id = $1`, [organizationId]);
    return rows.map((row: any) => ({
      id: row.id, organizationId: row.organization_id, externalId: row.external_id, customerExternalId: row.customer_external_id,
      leadExternalId: row.lead_external_id, jobType: row.job_type, technician: row.technician, status: row.status, scheduledAt: row.scheduled_at?.toISOString(),
      completedAt: row.completed_at?.toISOString(), revenue: row.revenue ? Number(row.revenue) : undefined, cost: row.cost ? Number(row.cost) : undefined,
      leadSource: row.lead_source, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
  }
  private async selectCoreRevenue(organizationId: string) {
    const { rows } = await this.pool.query(`select * from bp_revenue_transactions where organization_id = $1`, [organizationId]);
    return rows.map((row: any) => ({
      id: row.id, organizationId: row.organization_id, externalId: row.external_id, customerExternalId: row.customer_external_id,
      jobExternalId: row.job_external_id, amount: Number(row.amount), paymentMethod: row.payment_method, paidAt: row.paid_at?.toISOString(),
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
  }
  private async selectCoreMarketing(organizationId: string) {
    const { rows } = await this.pool.query(`select * from bp_marketing_spend where organization_id = $1`, [organizationId]);
    return rows.map((row: any) => ({
      id: row.id, organizationId: row.organization_id, date: row.spend_date, platform: row.platform, campaign: row.campaign,
      impressions: row.impressions, clicks: row.clicks, spend: Number(row.spend), leads: row.leads, conversions: row.conversions,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
    }));
  }
  private async insertCoreCustomers(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_customers (id, organization_id, external_id, name, email, phone, city, state, zip, lead_source, first_seen_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (id) do update set
           organization_id = excluded.organization_id,
           external_id = excluded.external_id,
           name = excluded.name,
           email = excluded.email,
           phone = excluded.phone,
           city = excluded.city,
           state = excluded.state,
           zip = excluded.zip,
           lead_source = excluded.lead_source,
           first_seen_at = excluded.first_seen_at,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [row.id, organizationId, row.externalId ?? null, row.name ?? null, row.email ?? null, row.phone ?? null, row.city ?? null, row.state ?? null, row.zip ?? null, row.leadSource ?? null, row.firstSeenAt ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreLeads(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_leads (id, organization_id, external_id, customer_external_id, source, campaign, status, estimated_value, created_at_source, booked_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set
           organization_id = excluded.organization_id,
           external_id = excluded.external_id,
           customer_external_id = excluded.customer_external_id,
           source = excluded.source,
           campaign = excluded.campaign,
           status = excluded.status,
           estimated_value = excluded.estimated_value,
           created_at_source = excluded.created_at_source,
           booked_at = excluded.booked_at,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [row.id, organizationId, row.externalId ?? null, row.customerExternalId ?? null, row.source ?? null, row.campaign ?? null, row.status ?? null, row.estimatedValue ?? null, row.createdAtSource ?? null, row.bookedAt ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreJobs(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_jobs (id, organization_id, external_id, customer_external_id, lead_external_id, job_type, technician, status, scheduled_at, completed_at, revenue, cost, lead_source, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (id) do update set
           organization_id = excluded.organization_id,
           external_id = excluded.external_id,
           customer_external_id = excluded.customer_external_id,
           lead_external_id = excluded.lead_external_id,
           job_type = excluded.job_type,
           technician = excluded.technician,
           status = excluded.status,
           scheduled_at = excluded.scheduled_at,
           completed_at = excluded.completed_at,
           revenue = excluded.revenue,
           cost = excluded.cost,
           lead_source = excluded.lead_source,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [row.id, organizationId, row.externalId ?? null, row.customerExternalId ?? null, row.leadExternalId ?? null, row.jobType ?? null, row.technician ?? null, row.status ?? null, row.scheduledAt ?? null, row.completedAt ?? null, row.revenue ?? null, row.cost ?? null, row.leadSource ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreRevenue(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_revenue_transactions (id, organization_id, external_id, customer_external_id, job_external_id, amount, payment_method, paid_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set
           organization_id = excluded.organization_id,
           external_id = excluded.external_id,
           customer_external_id = excluded.customer_external_id,
           job_external_id = excluded.job_external_id,
           amount = excluded.amount,
           payment_method = excluded.payment_method,
           paid_at = excluded.paid_at,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [row.id, organizationId, row.externalId ?? null, row.customerExternalId ?? null, row.jobExternalId ?? null, row.amount, row.paymentMethod ?? null, row.paidAt ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreMarketing(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_marketing_spend (id, organization_id, spend_date, platform, campaign, impressions, clicks, spend, leads, conversions, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set
           organization_id = excluded.organization_id,
           spend_date = excluded.spend_date,
           platform = excluded.platform,
           campaign = excluded.campaign,
           impressions = excluded.impressions,
           clicks = excluded.clicks,
           spend = excluded.spend,
           leads = excluded.leads,
           conversions = excluded.conversions,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`,
        [row.id, organizationId, row.date, row.platform ?? null, row.campaign ?? null, row.impressions ?? null, row.clicks ?? null, row.spend, row.leads ?? null, row.conversions ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async applyMigration(id: string, path: string) {
    const exists = await this.pool.query("select 1 from schema_migrations where id = $1", [id]);
    if (exists.rowCount) return;
    const sql = await readFile(path, "utf8");
    await this.pool.query("begin");
    try {
      await this.pool.query(sql);
      await this.pool.query("insert into schema_migrations (id) values ($1)", [id]);
      await this.pool.query("commit");
    } catch (error) {
      await this.pool.query("rollback");
      throw error;
    }
  }
}

let storageSingleton: Storage | null = null;

export function getStorage(): Storage {
  if (storageSingleton) return storageSingleton;
  const dbUrl = process.env.DATABASE_URL?.trim();
  storageSingleton = dbUrl ? new PostgresStorage(dbUrl) : new MemoryStorage();
  return storageSingleton;
}

export function createInMemoryStorageForTests(): Storage {
  return new MemoryStorage();
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  return hashSync(password, 10);
}

function verifyPassword(password: string, storedHash: string) {
  if (isBcryptHash(storedHash)) return compareSync(password, storedHash);
  return createHash("sha256").update(password).digest("hex") === storedHash;
}

function isBcryptHash(hash: string) {
  return hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$");
}

function generateTemporaryPassword() {
  return `bp-${randomBytes(6).toString("hex")}`;
}

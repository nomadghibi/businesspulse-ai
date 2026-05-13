import { Pool } from "pg";
import type { AgentRun, Organization } from "../shared/types";
import { DEMO_ORG_ID, now } from "./utils";
import { getOrgData as getMemoryOrgData, organizations, seedOrg, type OrgData } from "./store";
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
}

export interface Storage {
  initialize(): Promise<void>;
  getOrganizations(): Promise<Organization[]>;
  getOrgData(organizationId: string): Promise<OrgData>;
  saveOrgData(organizationId: string, data: OrgData): Promise<void>;
  createAgentRun(organizationId: string, input: unknown, triggerType: AgentRun["triggerType"], agentName?: string): Promise<AgentRun>;
  login(email: string, password: string): Promise<AuthUser | null>;
  getAuthUser(token: string): Promise<AuthUser | null>;
  listUsers(organizationId: string): Promise<Array<{ userId: string; email: string; role: AuthRole; disabled: boolean }>>;
  inviteUser(organizationId: string, email: string, role: AuthRole, password: string): Promise<{ userId: string; email: string; role: AuthRole }>;
  setUserRole(organizationId: string, userId: string, role: AuthRole): Promise<void>;
  setUserDisabled(organizationId: string, userId: string, disabled: boolean): Promise<void>;
}

class MemoryStorage implements Storage {
  private sessions = new Map<string, AuthUser>();
  private users = new Map<string, { userId: string; organizationId: string; email: string; role: AuthRole; disabled: boolean; passwordHash: string }>([
    ["user_demo_owner", { userId: "user_demo_owner", organizationId: DEMO_ORG_ID, email: "owner@businesspulse.local", role: "owner", disabled: false, passwordHash: hashPassword("demo1234") }]
  ]);
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
      token
    };
    this.sessions.set(token, authUser);
    return authUser;
  }
  async getAuthUser(token: string) {
    return this.sessions.get(token) ?? null;
  }
  async listUsers(organizationId: string) {
    return [...this.users.values()]
      .filter((item) => item.organizationId === organizationId)
      .map(({ userId, email, role, disabled }) => ({ userId, email, role, disabled }));
  }
  async inviteUser(organizationId: string, email: string, role: AuthRole, password: string) {
    const userId = `user_${crypto.randomUUID()}`;
    this.users.set(userId, { userId, organizationId, email, role, disabled: false, passwordHash: hashPassword(password) });
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
}

class PostgresStorage implements Storage {
  private pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    await this.applyMigration("001_normalized_schema", resolve(process.cwd(), "server/migrations/001_normalized_schema.sql"));
    await this.applyMigration("002_users_relational_and_indexes", resolve(process.cwd(), "server/migrations/002_users_relational_and_indexes.sql"));

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
      for (const table of ["customers", "leads", "jobs", "revenue_transactions", "marketing_spend", "data_sources", "file_uploads", "reports", "alerts", "recommendations", "agent_runs", "bp_customers", "bp_leads", "bp_jobs", "bp_revenue_transactions", "bp_marketing_spend"]) {
        await this.pool.query(`delete from ${table} where organization_id = $1`, [organizationId]);
      }
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
    const { rows } = await this.pool.query<{ id: string; password_hash: string; disabled: boolean }>("select id, password_hash, disabled from users where email = $1", [email]);
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
    return { userId: user.id, organizationId: member.organization_id, email, role: member.role, token };
  }
  async getAuthUser(token: string) {
    const { rows } = await this.pool.query<{ user_id: string; organization_id: string; email: string; role: AuthRole; disabled: boolean }>(
      `select s.user_id, s.organization_id, u.email, m.role, u.disabled
       from sessions s
       join users u on u.id = s.user_id
       join organization_members m on m.user_id = s.user_id and m.organization_id = s.organization_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.disabled) return null;
    return { userId: row.user_id, organizationId: row.organization_id, email: row.email, role: row.role, token };
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
      await this.pool.query(`insert into users (id, email, password_hash, disabled) values ($1, $2, $3, false)`, [userId, email, hashPassword(password)]);
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

  private async selectPayloads(table: string, organizationId: string) {
    const { rows } = await this.pool.query<{ payload: unknown }>(
      `select payload from ${table} where organization_id = $1`,
      [organizationId]
    );
    return rows.map((row) => row.payload) as any[];
  }
  private async insertPayloads(table: string, organizationId: string, rows: Array<{ id: string }>) {
    for (const row of rows) {
      await this.pool.query(`insert into ${table} (id, organization_id, payload) values ($1, $2, $3::jsonb)`, [
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
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [row.id, organizationId, row.externalId ?? null, row.name ?? null, row.email ?? null, row.phone ?? null, row.city ?? null, row.state ?? null, row.zip ?? null, row.leadSource ?? null, row.firstSeenAt ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreLeads(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_leads (id, organization_id, external_id, customer_external_id, source, campaign, status, estimated_value, created_at_source, booked_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [row.id, organizationId, row.externalId ?? null, row.customerExternalId ?? null, row.source ?? null, row.campaign ?? null, row.status ?? null, row.estimatedValue ?? null, row.createdAtSource ?? null, row.bookedAt ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreJobs(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_jobs (id, organization_id, external_id, customer_external_id, lead_external_id, job_type, technician, status, scheduled_at, completed_at, revenue, cost, lead_source, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [row.id, organizationId, row.externalId ?? null, row.customerExternalId ?? null, row.leadExternalId ?? null, row.jobType ?? null, row.technician ?? null, row.status ?? null, row.scheduledAt ?? null, row.completedAt ?? null, row.revenue ?? null, row.cost ?? null, row.leadSource ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreRevenue(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_revenue_transactions (id, organization_id, external_id, customer_external_id, job_external_id, amount, payment_method, paid_at, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [row.id, organizationId, row.externalId ?? null, row.customerExternalId ?? null, row.jobExternalId ?? null, row.amount, row.paymentMethod ?? null, row.paidAt ?? null, row.createdAt, row.updatedAt]
      );
    }
  }
  private async insertCoreMarketing(organizationId: string, rows: any[]) {
    for (const row of rows) {
      await this.pool.query(
        `insert into bp_marketing_spend (id, organization_id, spend_date, platform, campaign, impressions, clicks, spend, leads, conversions, created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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

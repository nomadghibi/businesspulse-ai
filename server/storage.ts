import { Pool } from "pg";
import type { AgentRun, Organization } from "../shared/types";
import { DEMO_ORG_ID, now } from "./utils";
import { getOrgData as getMemoryOrgData, organizations, seedOrg, type OrgData } from "./store";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
}

class MemoryStorage implements Storage {
  private sessions = new Map<string, AuthUser>();
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
    if (email !== "owner@businesspulse.local" || password !== "demo1234") return null;
    const token = randomBytes(24).toString("hex");
    const user: AuthUser = {
      userId: "user_demo_owner",
      organizationId: DEMO_ORG_ID,
      email,
      role: "owner",
      token
    };
    this.sessions.set(token, user);
    return user;
  }
  async getAuthUser(token: string) {
    return this.sessions.get(token) ?? null;
  }
}

class PostgresStorage implements Storage {
  private pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    await this.applyMigration("001_normalized_schema", resolve(process.cwd(), "server/migrations/001_normalized_schema.sql"));

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
      `insert into users (id, email, password_hash) values ($1, $2, $3)
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
      this.selectPayloads("customers", organizationId),
      this.selectPayloads("leads", organizationId),
      this.selectPayloads("jobs", organizationId),
      this.selectPayloads("revenue_transactions", organizationId),
      this.selectPayloads("marketing_spend", organizationId),
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
      for (const table of ["customers", "leads", "jobs", "revenue_transactions", "marketing_spend", "data_sources", "file_uploads", "reports", "alerts", "recommendations", "agent_runs"]) {
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
    const { rows } = await this.pool.query<{ id: string; password_hash: string }>("select id, password_hash from users where email = $1", [email]);
    const user = rows[0];
    if (!user || user.password_hash !== hashPassword(password)) return null;
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
    const { rows } = await this.pool.query<{ user_id: string; organization_id: string; email: string; role: AuthRole }>(
      `select s.user_id, s.organization_id, u.email, m.role
       from sessions s
       join users u on u.id = s.user_id
       join organization_members m on m.user_id = s.user_id and m.organization_id = s.organization_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [hashToken(token)]
    );
    if (!rows.length) return null;
    const row = rows[0];
    return { userId: row.user_id, organizationId: row.organization_id, email: row.email, role: row.role, token };
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

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  return createHash("sha256").update(password).digest("hex");
}

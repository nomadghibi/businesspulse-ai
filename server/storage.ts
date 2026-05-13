import { Pool } from "pg";
import type { AgentRun, Organization } from "../shared/types";
import { DEMO_ORG_ID, now } from "./utils";
import { getOrgData as getMemoryOrgData, organizations, seedOrg, type OrgData } from "./store";

export interface Storage {
  initialize(): Promise<void>;
  getOrganizations(): Promise<Organization[]>;
  getOrgData(organizationId: string): Promise<OrgData>;
  saveOrgData(organizationId: string, data: OrgData): Promise<void>;
  createAgentRun(organizationId: string, input: unknown, triggerType: AgentRun["triggerType"], agentName?: string): Promise<AgentRun>;
}

class MemoryStorage implements Storage {
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
}

class PostgresStorage implements Storage {
  private pool: Pool;
  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  async initialize() {
    await this.pool.query(`
      create table if not exists organizations (
        id text primary key,
        name text not null,
        business_type text not null,
        timezone text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    await this.pool.query(`
      create table if not exists org_state (
        organization_id text primary key references organizations(id) on delete cascade,
        state jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);

    const existing = await this.pool.query("select id from organizations where id = $1", [DEMO_ORG_ID]);
    if (!existing.rowCount) {
      const org = organizations[0];
      const data = seedOrg(org.id);
      await this.pool.query(
        `insert into organizations (id, name, business_type, timezone, created_at, updated_at)
         values ($1, $2, $3, $4, now(), now())`,
        [org.id, org.name, org.businessType, org.timezone]
      );
      await this.pool.query(
        `insert into org_state (organization_id, state, updated_at)
         values ($1, $2::jsonb, now())`,
        [org.id, JSON.stringify(data)]
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
    const { rows } = await this.pool.query<{ state: OrgData }>("select state from org_state where organization_id = $1", [organizationId]);
    if (!rows.length) throw Object.assign(new Error("Organization not found"), { status: 404 });
    return rows[0].state;
  }

  async saveOrgData(organizationId: string, data: OrgData) {
    await this.pool.query(
      `update org_state
       set state = $2::jsonb, updated_at = now()
       where organization_id = $1`,
      [organizationId, JSON.stringify(data)]
    );
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
}

let storageSingleton: Storage | null = null;

export function getStorage(): Storage {
  if (storageSingleton) return storageSingleton;
  const dbUrl = process.env.DATABASE_URL?.trim();
  storageSingleton = dbUrl ? new PostgresStorage(dbUrl) : new MemoryStorage();
  return storageSingleton;
}

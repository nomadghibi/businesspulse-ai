import type {
  AgentRun,
  Alert,
  Customer,
  DataSource,
  FileUpload,
  Job,
  Lead,
  MarketingSpend,
  Organization,
  Recommendation,
  Report,
  RevenueTransaction
} from "../shared/types";
import { DEMO_ORG_ID, id, now } from "./utils.js";

export interface OrgData {
  customers: Customer[];
  leads: Lead[];
  jobs: Job[];
  revenue: RevenueTransaction[];
  marketingSpend: MarketingSpend[];
  dataSources: DataSource[];
  uploads: FileUpload[];
  reports: Report[];
  alerts: Alert[];
  recommendations: Recommendation[];
  agentRuns: AgentRun[];
}

export const organizations: Organization[] = [
  {
    id: DEMO_ORG_ID,
    name: "Demo Home Services Co.",
    businessType: "HVAC, plumbing, electrical",
    timezone: "America/New_York"
  }
];

const orgData = new Map<string, OrgData>();

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export function seedOrg(organizationId: string): OrgData {
  const createdAt = now();
  const customers = [
    ["C-100", "Avery Johnson", "Google Ads"],
    ["C-101", "Morgan Lee", "Referral"],
    ["C-102", "Riley Patel", "Facebook Ads"],
    ["C-103", "Casey Smith", "Google Ads"],
    ["C-104", "Jordan Kim", "Organic"]
  ].map(([externalId, name, leadSource], index) => ({
    id: id("cus"),
    organizationId,
    externalId,
    name,
    email: `${String(name).toLowerCase().replace(" ", ".")}@example.com`,
    phone: "555-0100",
    city: "Charlotte",
    state: "NC",
    zip: "28202",
    leadSource,
    firstSeenAt: daysAgo(80 - index * 8),
    createdAt,
    updatedAt: createdAt
  }));

  const jobRows = [
    [27, "C-100", "HVAC tune-up", "completed", 460, 120, "Google Ads"],
    [24, "C-101", "Water heater", "completed", 2100, 900, "Referral"],
    [20, "C-102", "Electrical panel", "completed", 1850, 700, "Facebook Ads"],
    [16, "C-103", "HVAC repair", "completed", 690, 230, "Google Ads"],
    [12, "C-104", "Drain cleaning", "completed", 340, 90, "Organic"],
    [8, "C-100", "HVAC replacement", "completed", 7200, 4100, "Google Ads"],
    [5, "C-102", "Outlet repair", "scheduled", 260, 80, "Facebook Ads"],
    [42, "C-101", "Leak repair", "completed", 530, 160, "Referral"],
    [51, "C-103", "HVAC tune-up", "completed", 420, 110, "Google Ads"]
  ];

  const jobs = jobRows.map(([ago, customerExternalId, jobType, status, revenue, cost, leadSource], index) => ({
    id: id("job"),
    organizationId,
    externalId: `J-${1000 + index}`,
    customerExternalId: String(customerExternalId),
    jobType: String(jobType),
    technician: ["Sam", "Taylor", "Jamie"][index % 3],
    status: String(status),
    scheduledAt: daysAgo(Number(ago) + 1),
    completedAt: status === "completed" ? daysAgo(Number(ago)) : undefined,
    revenue: Number(revenue),
    cost: Number(cost),
    leadSource: String(leadSource),
    createdAt,
    updatedAt: createdAt
  }));

  const leads = Array.from({ length: 34 }).map((_, index) => {
    const source = ["Google Ads", "Referral", "Facebook Ads", "Organic"][index % 4];
    const createdAtSource = daysAgo(55 - index);
    return {
      id: id("lead"),
      organizationId,
      externalId: `L-${2000 + index}`,
      customerExternalId: customers[index % customers.length].externalId,
      source,
      campaign: source.includes("Ads") ? "Spring service" : undefined,
      status: index % 3 === 0 ? "booked" : index % 5 === 0 ? "lost" : "contacted",
      estimatedValue: 350 + (index % 8) * 180,
      createdAtSource,
      bookedAt: index % 3 === 0 ? createdAtSource : undefined,
      createdAt,
      updatedAt: createdAt
    };
  });

  const revenue = jobs
    .filter((job) => job.status === "completed")
    .map((job) => ({
      id: id("rev"),
      organizationId,
      externalId: `P-${job.externalId}`,
      customerExternalId: job.customerExternalId,
      jobExternalId: job.externalId,
      amount: job.revenue ?? 0,
      paymentMethod: "card",
      paidAt: job.completedAt,
      createdAt,
      updatedAt: createdAt
    }));

  const marketingSpend = Array.from({ length: 8 }).map((_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - index * 7);
    const platform = index % 2 === 0 ? "Google Ads" : "Facebook Ads";
    return {
      id: id("mkt"),
      organizationId,
      date: date.toISOString().slice(0, 10),
      platform,
      campaign: "Spring service",
      impressions: 5200 + index * 340,
      clicks: 210 + index * 18,
      spend: platform === "Google Ads" ? 950 + index * 45 : 620 + index * 35,
      leads: 10 + (index % 4),
      conversions: 3 + (index % 3),
      createdAt,
      updatedAt: createdAt
    };
  });

  return {
    customers,
    leads,
    jobs,
    revenue,
    marketingSpend,
    dataSources: [],
    uploads: [],
    reports: [],
    alerts: [],
    recommendations: [],
    agentRuns: []
  };
}

export function getOrganizations() {
  return organizations;
}

export function getOrgData(organizationId: string) {
  if (!organizations.some((org) => org.id === organizationId)) {
    throw Object.assign(new Error("Organization not found"), { status: 404 });
  }
  if (!orgData.has(organizationId)) {
    orgData.set(organizationId, seedOrg(organizationId));
  }
  return orgData.get(organizationId)!;
}

export function createAgentRun(organizationId: string, input: unknown, triggerType: AgentRun["triggerType"], agentName = "Business Analyst Agent") {
  const run: AgentRun = {
    id: id("run"),
    organizationId,
    agentName,
    triggerType,
    input,
    status: "running",
    createdAt: now(),
    updatedAt: now()
  };
  getOrgData(organizationId).agentRuns.unshift(run);
  return run;
}

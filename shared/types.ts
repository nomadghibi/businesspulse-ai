export type DatasetType = "customers" | "leads" | "jobs" | "revenue" | "marketing_spend";
export type Role = "owner" | "admin" | "viewer";
export type Severity = "low" | "medium" | "high";
export type RecommendationStatus = "new" | "accepted" | "rejected" | "completed" | "dismissed";

export interface TenantRecord {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  businessType: string;
  timezone: string;
}

export interface DataSource extends TenantRecord {
  sourceType: "csv" | "sample";
  datasetType: DatasetType;
  displayName: string;
  status: "active" | "failed";
  lastSyncedAt?: string;
}

export interface FileUpload extends TenantRecord {
  dataSourceId: string;
  filename: string;
  datasetType: DatasetType;
  status: "uploaded" | "mapped" | "processed" | "failed";
  rowCount: number;
  columns: string[];
  mappings: ColumnMapping[];
  qualityIssues: string[];
  sampleRows: Record<string, string>[];
}

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string;
  confidence: number;
}

export interface Customer extends TenantRecord {
  externalId?: string;
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  zip?: string;
  leadSource?: string;
  firstSeenAt?: string;
}

export interface Lead extends TenantRecord {
  externalId?: string;
  customerExternalId?: string;
  source?: string;
  campaign?: string;
  status?: string;
  estimatedValue?: number;
  createdAtSource?: string;
  bookedAt?: string;
}

export interface Job extends TenantRecord {
  externalId?: string;
  customerExternalId?: string;
  leadExternalId?: string;
  jobType?: string;
  technician?: string;
  status?: string;
  scheduledAt?: string;
  completedAt?: string;
  revenue?: number;
  cost?: number;
  leadSource?: string;
}

export interface RevenueTransaction extends TenantRecord {
  externalId?: string;
  customerExternalId?: string;
  jobExternalId?: string;
  amount: number;
  paymentMethod?: string;
  paidAt?: string;
}

export interface MarketingSpend extends TenantRecord {
  date: string;
  platform?: string;
  campaign?: string;
  impressions?: number;
  clicks?: number;
  spend: number;
  leads?: number;
  conversions?: number;
}

export interface Period {
  start: string;
  end: string;
}

export interface MetricCard {
  name: string;
  value: number;
  formatted: string;
  deltaPct: number | null;
  source: DatasetType[];
}

export interface TrendPoint {
  date: string;
  revenue: number;
  leads: number;
  jobs: number;
  marketingSpend: number;
}

export interface MetricsResponse {
  organizationId: string;
  period: Period;
  comparisonPeriod: Period;
  cards: MetricCard[];
  trends: TrendPoint[];
  revenueByJobType: Array<{ name: string; value: number }>;
  revenueByLeadSource: Array<{ name: string; value: number }>;
  dataSourcesUsed: DatasetType[];
  qualityIssues: string[];
}

export interface Alert extends TenantRecord {
  metricName: string;
  severity: Severity;
  title: string;
  description: string;
  observedChange: string;
  confidence: string;
  status: "new" | "dismissed" | "useful";
}

export interface Recommendation extends TenantRecord {
  title: string;
  description: string;
  reason: string;
  priority: Severity;
  expectedImpact: string;
  confidence: string;
  status: RecommendationStatus;
  requiresApproval: boolean;
}

export interface Report extends TenantRecord {
  reportType: "daily" | "weekly" | "monthly" | "ad_hoc";
  title: string;
  summary: string;
  content: {
    metricChanges: string[];
    likelyDrivers: string[];
    risks: string[];
    recommendedActions: string[];
    dataLimitations: string[];
  };
  periodStart: string;
  periodEnd: string;
}

export interface AgentRun extends TenantRecord {
  agentName: string;
  triggerType: "user_question" | "schedule" | "upload" | "manual";
  input: unknown;
  output?: unknown;
  status: "running" | "success" | "failed";
  modelName?: string;
  errorMessage?: string;
  completedAt?: string;
}

export interface AiAnswer {
  directAnswer: string;
  supportingMetrics: Array<{ label: string; value: string }>;
  dateRange: Period;
  dataSourcesUsed: DatasetType[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
  recommendedNextAction: string;
  reasoning: string[];
  agentRunId: string;
}

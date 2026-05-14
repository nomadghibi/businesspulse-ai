import type { DatasetType } from "../../shared/types";

export const datasetTypes: Array<{ value: DatasetType; label: string }> = [
  { value: "customers", label: "Customers" },
  { value: "leads", label: "Leads" },
  { value: "jobs", label: "Jobs" },
  { value: "revenue", label: "Revenue" },
  { value: "marketing_spend", label: "Marketing Spend" }
];

export const datasetTargetFields: Record<DatasetType, string[]> = {
  customers: ["customer_id", "name", "email", "phone", "city", "state", "zip", "lead_source", "created_at"],
  leads: ["lead_id", "customer_id", "source", "status", "created_at", "booked_at", "estimated_value", "campaign"],
  jobs: ["job_id", "customer_id", "lead_id", "job_type", "technician", "status", "scheduled_at", "completed_at", "revenue", "cost", "lead_source"],
  revenue: ["transaction_id", "customer_id", "job_id", "amount", "payment_method", "paid_at"],
  marketing_spend: ["date", "platform", "campaign", "impressions", "clicks", "spend", "leads", "conversions"]
};

export const allowedTabs = ["dashboard", "sources", "ask", "reports", "recommendations", "settings"] as const;
export type AppTab = typeof allowedTabs[number];

export function normalizeTab(value: string | null | undefined): AppTab {
  if (value && allowedTabs.includes(value as AppTab)) return value as AppTab;
  return "dashboard";
}

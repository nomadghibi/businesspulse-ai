import type { Alert, DatasetType, MetricsResponse, Period, Recommendation, Report } from "../shared/types";
import type { OrgData } from "./store.js";
import { formatCurrency, formatPct, id, inPeriod, now, pctChange, previousPeriod } from "./utils.js";

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function metricSet(data: OrgData, period: Period) {
  const revenueRows = data.revenue.filter((row) => inPeriod(row.paidAt, period));
  const jobRows = data.jobs.filter((row) => inPeriod(row.completedAt ?? row.scheduledAt, period));
  const leadRows = data.leads.filter((row) => inPeriod(row.createdAtSource, period));
  const spendRows = data.marketingSpend.filter((row) => inPeriod(row.date, period));
  const revenue = sum(revenueRows.map((row) => row.amount));
  const completedJobs = jobRows.filter((job) => job.status === "completed").length;
  const leadCount = leadRows.length;
  const bookedLeads = leadRows.filter((lead) => lead.status === "booked" || lead.bookedAt).length;
  const spend = sum(spendRows.map((row) => row.spend));
  const completedRows = jobRows.filter((job) => job.status === "completed");
  const customerJobCounts = new Map<string, number>();
  for (const job of completedRows) {
    const customerId = job.customerExternalId;
    if (!customerId) continue;
    customerJobCounts.set(customerId, (customerJobCounts.get(customerId) ?? 0) + 1);
  }
  const activeCustomers = customerJobCounts.size;
  const repeatCustomers = [...customerJobCounts.values()].filter((count) => count >= 2).length;

  return {
    revenue,
    leadCount,
    completedJobs,
    conversionRate: leadCount ? (bookedLeads / leadCount) * 100 : 0,
    averageJobValue: completedJobs ? revenue / completedJobs : 0,
    repeatCustomerRate: activeCustomers ? (repeatCustomers / activeCustomers) * 100 : 0,
    marketingSpend: spend,
    costPerLead: leadCount ? spend / leadCount : 0
  };
}

export function calculateMetrics(organizationId: string, data: OrgData, period: Period): MetricsResponse {
  const comparisonPeriod = previousPeriod(period);
  const current = metricSet(data, period);
  const previous = metricSet(data, comparisonPeriod);
  const revenueRows = data.revenue.filter((row) => inPeriod(row.paidAt, period));
  const cards = [
    ["Total revenue", current.revenue, previous.revenue, formatCurrency(current.revenue), ["revenue", "jobs"]],
    ["Leads", current.leadCount, previous.leadCount, String(current.leadCount), ["leads"]],
    ["Booked jobs", current.completedJobs, previous.completedJobs, String(current.completedJobs), ["jobs"]],
    ["Conversion rate", current.conversionRate, previous.conversionRate, formatPct(current.conversionRate), ["leads", "jobs"]],
    ["Repeat customer rate", current.repeatCustomerRate, previous.repeatCustomerRate, formatPct(current.repeatCustomerRate), ["jobs"]],
    ["Average job value", current.averageJobValue, previous.averageJobValue, formatCurrency(current.averageJobValue), ["revenue", "jobs"]],
    ["Marketing spend", current.marketingSpend, previous.marketingSpend, formatCurrency(current.marketingSpend), ["marketing_spend"]],
    ["Cost per lead", current.costPerLead, previous.costPerLead, formatCurrency(current.costPerLead), ["marketing_spend", "leads"]]
  ] as const;

  const revenueByJobType = groupRevenueFromTransactions(revenueRows, data.jobs, "jobType");
  const revenueByLeadSource = groupRevenueFromTransactions(revenueRows, data.jobs, "leadSource");
  const trends = trendPoints(data, period);
  const dataSourcesUsed = new Set<DatasetType>();
  for (const card of cards) for (const source of card[4]) dataSourcesUsed.add(source);

  return {
    organizationId,
    period,
    comparisonPeriod,
    cards: cards.map(([name, value, priorValue, formatted, source]) => ({
      name,
      value,
      formatted,
      deltaPct: pctChange(value, priorValue),
      source: [...source]
    })),
    trends,
    revenueByJobType,
    revenueByLeadSource,
    dataSourcesUsed: [...dataSourcesUsed],
    qualityIssues: data.uploads.flatMap((upload) => upload.qualityIssues).slice(0, 8)
  };
}

function groupRevenueFromTransactions<T extends "jobType" | "leadSource">(
  revenueRows: OrgData["revenue"],
  jobs: OrgData["jobs"],
  key: T
) {
  const groups = new Map<string, number>();
  const jobsByExternalId = new Map<string, OrgData["jobs"][number]>();
  for (const job of jobs) {
    if (!job.externalId) continue;
    jobsByExternalId.set(job.externalId, job);
  }
  for (const row of revenueRows) {
    const job = row.jobExternalId ? jobsByExternalId.get(row.jobExternalId) : undefined;
    const name = job?.[key] || "Unattributed";
    groups.set(name, (groups.get(name) ?? 0) + row.amount);
  }
  return [...groups.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

function trendPoints(data: OrgData, period: Period) {
  const points = new Map<string, { date: string; revenue: number; leads: number; jobs: number; marketingSpend: number }>();
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    points.set(date, { date, revenue: 0, leads: 0, jobs: 0, marketingSpend: 0 });
  }
  for (const row of data.revenue) {
    const date = row.paidAt?.slice(0, 10);
    if (date && points.has(date)) points.get(date)!.revenue += row.amount;
  }
  for (const lead of data.leads) {
    const date = lead.createdAtSource?.slice(0, 10);
    if (date && points.has(date)) points.get(date)!.leads += 1;
  }
  for (const job of data.jobs) {
    const date = job.completedAt?.slice(0, 10);
    if (date && points.has(date)) points.get(date)!.jobs += 1;
  }
  for (const spend of data.marketingSpend) {
    if (points.has(spend.date)) points.get(spend.date)!.marketingSpend += spend.spend;
  }
  return [...points.values()];
}

export function generateAlerts(organizationId: string, data: OrgData, metrics: MetricsResponse): Alert[] {
  const existingByKey = new Map<string, Alert>(data.alerts.map((alert) => [`${alert.metricName}:${alert.title}`, alert]));
  const alerts: Alert[] = [];
  for (const card of metrics.cards) {
    if (card.deltaPct === null || Math.abs(card.deltaPct) < 25) continue;
    const negative = card.deltaPct < 0;
    const severity = Math.abs(card.deltaPct) > 50 ? "high" : Math.abs(card.deltaPct) > 35 ? "medium" : "low";
    const title = `${card.name} ${negative ? "dropped" : "changed sharply"}`;
    const key = `${card.name}:${title}`;
    const existing = existingByKey.get(key);
    const timestamp = now();
    alerts.push({
      id: existing?.id ?? id("alt"),
      organizationId,
      metricName: card.name,
      severity,
      title,
      description: `${card.name} moved ${card.deltaPct.toFixed(1)}% versus the comparison period. Review the related sources before changing spend or staffing.`,
      observedChange: `${card.deltaPct.toFixed(1)}%`,
      confidence: card.source.length > 1 ? "medium" : "high",
      status: existing?.status ?? "new",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }
  data.alerts = alerts;
  return alerts;
}

export function generateRecommendations(organizationId: string, data: OrgData, metrics: MetricsResponse): Recommendation[] {
  const existingByTitle = new Map<string, Recommendation>(data.recommendations.map((rec) => [rec.title, rec]));
  const revenue = metrics.cards.find((card) => card.name === "Total revenue");
  const cpl = metrics.cards.find((card) => card.name === "Cost per lead");
  const conversion = metrics.cards.find((card) => card.name === "Conversion rate");
  const recs: Recommendation[] = [];
  const add = (title: string, description: string, reason: string, priority: "low" | "medium" | "high", impact: string, confidence = "medium") => {
    const existing = existingByTitle.get(title);
    const timestamp = now();
    recs.push({
      id: existing?.id ?? id("rec"),
      organizationId,
      title,
      description,
      reason,
      priority,
      expectedImpact: impact,
      confidence,
      status: existing?.status ?? "new",
      requiresApproval: true,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  };
  if (revenue?.deltaPct !== null && revenue && revenue.deltaPct < -20) {
    add("Review job mix and missed bookings", "Compare high-value job types and lead sources against the prior period before cutting marketing.", "Revenue declined materially versus the comparison period.", "high", "Recover booked revenue and prevent budget cuts from hiding the real driver.");
  }
  if (cpl?.deltaPct !== null && cpl && cpl.deltaPct > 20) {
    add("Audit campaigns with rising cost per lead", "Pause only the worst-performing campaign after confirming lead quality and booked-job conversion.", "Cost per lead increased while deterministic metrics show spend pressure.", "medium", "Reduce wasted spend without starving productive channels.");
  }
  if (conversion?.deltaPct !== null && conversion && conversion.deltaPct < -15) {
    add("Tighten lead follow-up", "Call new leads within five minutes and inspect lost-lead reasons by source.", "Lead-to-job conversion fell in the selected period.", "high", "Improve booking rate before increasing ad budget.");
  }
  if (!recs.length) {
    add("Keep monitoring profitable sources", "Maintain current budget, but track weekly conversion and job value by source.", "No severe KPI movement was detected for the selected period.", "low", "Preserve performance while building a better baseline.", "high");
  }
  data.recommendations = recs;
  return recs;
}

export function generateReport(organizationId: string, data: OrgData, metrics: MetricsResponse): Report {
  const changes = metrics.cards.map((card) => `${card.name}: ${card.formatted}${card.deltaPct === null ? "" : ` (${card.deltaPct.toFixed(1)}%)`}`);
  const topRevenueSource = metrics.revenueByLeadSource[0]?.name ?? "Unknown";
  const report: Report = {
    id: id("rpt"),
    organizationId,
    reportType: "weekly",
    title: "Weekly Business Brief",
    summary: `Revenue, leads, jobs, conversion, and marketing spend were reviewed for ${metrics.period.start} through ${metrics.period.end}. The strongest visible revenue source was ${topRevenueSource}.`,
    content: {
      metricChanges: changes,
      likelyDrivers: [
        `Revenue mix is most influenced by ${metrics.revenueByJobType[0]?.name ?? "available completed jobs"}.`,
        `Lead source performance is led by ${topRevenueSource}.`
      ],
      risks: metrics.qualityIssues.length ? metrics.qualityIssues : ["No major data quality limitation detected in uploaded or sample data."],
      recommendedActions: data.recommendations.slice(0, 3).map((rec) => rec.title),
      dataLimitations: metrics.qualityIssues
    },
    periodStart: metrics.period.start,
    periodEnd: metrics.period.end,
    createdAt: now(),
    updatedAt: now()
  };
  data.reports.unshift(report);
  return report;
}

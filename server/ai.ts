import type { AiAnswer, DatasetType, MetricsResponse } from "../shared/types";
import type { AgentRun } from "../shared/types";
import type { OrgData } from "./store";
import { formatCurrency, id, inPeriod, now } from "./utils";

export async function answerQuestion(params: {
  organizationId: string;
  question: string;
  metrics: MetricsResponse;
  data: OrgData;
}): Promise<AiAnswer> {
  const run: AgentRun = {
    id: id("run"),
    organizationId: params.organizationId,
    agentName: "Business Analyst Agent",
    triggerType: "user_question",
    input: { question: params.question, period: params.metrics.period },
    status: "running",
    createdAt: now(),
    updatedAt: now()
  };
  params.data.agentRuns.unshift(run);
  try {
    const evidence = buildEvidence(params.data, params.metrics);
    const answer = await callModel(params.question, params.metrics, evidence);
    const output = answer ?? groundedAnswer(params.question, params.metrics, evidence);
    run.output = output;
    run.status = "success";
    run.modelName = process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL || "openai-compatible" : "deterministic-fallback";
    run.completedAt = now();
    run.updatedAt = now();
    return { ...output, agentRunId: run.id };
  } catch (error) {
    const output = groundedAnswer(params.question, params.metrics, buildEvidence(params.data, params.metrics));
    run.output = output;
    run.status = "success";
    run.modelName = "deterministic-fallback-after-model-error";
    run.errorMessage = error instanceof Error ? error.message : "Unknown model error";
    run.completedAt = now();
    run.updatedAt = now();
    return { ...output, agentRunId: run.id };
  }
}

async function callModel(
  question: string,
  metrics: MetricsResponse,
  evidence: Array<{ id: string; source: DatasetType; summary: string; value?: string }>
): Promise<Omit<AiAnswer, "agentRunId"> | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are BusinessPulse AI. Answer only from supplied metrics and supportingEvidence. Cite evidence IDs inside reasoning lines. Return JSON with directAnswer, supportingMetrics, supportingEvidence, dateRange, dataSourcesUsed, assumptions, confidence, recommendedNextAction, reasoning."
        },
        { role: "user", content: JSON.stringify({ question, metrics, supportingEvidence: evidence }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as Omit<AiAnswer, "agentRunId">;
  if (!Array.isArray(parsed.supportingEvidence) || !parsed.supportingEvidence.length) {
    parsed.supportingEvidence = evidence;
  }
  return parsed;
}

function groundedAnswer(
  question: string,
  metrics: MetricsResponse,
  evidence: Array<{ id: string; source: DatasetType; summary: string; value?: string }>
): Omit<AiAnswer, "agentRunId"> {
  const revenue = metrics.cards.find((card) => card.name === "Total revenue");
  const leads = metrics.cards.find((card) => card.name === "Leads");
  const jobs = metrics.cards.find((card) => card.name === "Booked jobs");
  const conversion = metrics.cards.find((card) => card.name === "Conversion rate");
  const spend = metrics.cards.find((card) => card.name === "Marketing spend");
  const topJobType = metrics.revenueByJobType[0];
  const topSource = metrics.revenueByLeadSource[0];
  const sourceSet = new Set<DatasetType>(metrics.dataSourcesUsed);
  const revenueDelta = revenue?.deltaPct;
  const leadDelta = leads?.deltaPct;
  const jobDelta = jobs?.deltaPct;
  const spendDelta = spend?.deltaPct;

  const direction = revenueDelta === null || revenueDelta === undefined ? "changed" : revenueDelta < 0 ? "dropped" : "increased";
  const directAnswer = question.toLowerCase().includes("why")
    ? `Revenue ${direction} versus the comparison period. The most likely drivers are job volume, job mix, and lead-source performance, with ${topJobType?.name ?? "completed jobs"} contributing the largest visible revenue share.`
    : `For the selected period, revenue was ${revenue?.formatted ?? "$0"} with ${jobs?.formatted ?? "0"} booked jobs and ${leads?.formatted ?? "0"} leads.`;

  return {
    directAnswer,
    supportingMetrics: [
      { label: "Revenue", value: `${revenue?.formatted ?? "$0"}${formatDelta(revenueDelta)}` },
      { label: "Leads", value: `${leads?.formatted ?? "0"}${formatDelta(leadDelta)}` },
      { label: "Booked jobs", value: `${jobs?.formatted ?? "0"}${formatDelta(jobDelta)}` },
      { label: "Conversion", value: conversion?.formatted ?? "0%" },
      { label: "Marketing spend", value: `${spend?.formatted ?? "$0"}${formatDelta(spendDelta)}` },
      { label: "Top revenue source", value: topSource ? `${topSource.name} (${formatCurrency(topSource.value)})` : "Unknown" }
    ],
    supportingEvidence: evidence,
    dateRange: metrics.period,
    dataSourcesUsed: [...sourceSet],
    assumptions: [
      "Uploaded CSV rows are normalized into organization-scoped records before analysis.",
      "Revenue is based on paid revenue transactions when available and completed job revenue for breakdowns.",
      "Comparison uses the immediately preceding period of the same length."
    ],
    confidence: metrics.qualityIssues.length ? "medium" : "high",
    recommendedNextAction:
      revenueDelta !== null && revenueDelta !== undefined && revenueDelta < -15
        ? "Review booked jobs, average job value, and top lead sources before changing ad spend."
        : "Keep monitoring weekly source-level conversion and protect the channels producing booked revenue.",
    reasoning: [
      `The analysis compared ${metrics.period.start} to ${metrics.period.end} against ${metrics.comparisonPeriod.start} to ${metrics.comparisonPeriod.end}.`,
      `The largest job-type revenue contributor was ${topJobType?.name ?? "not available"} (evidence ${evidence[0]?.id ?? "none"}).`,
      `The largest lead-source revenue contributor was ${topSource?.name ?? "not available"} (evidence ${evidence[1]?.id ?? "none"}).`
    ]
  };
}

function buildEvidence(data: OrgData, metrics: MetricsResponse) {
  const period = metrics.period;
  const evidence: Array<{ id: string; source: DatasetType; summary: string; value?: string }> = [];
  const topRevenueRows = data.revenue
    .filter((row) => inPeriod(row.paidAt, period))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  for (const row of topRevenueRows) {
    evidence.push({
      id: `rev:${row.externalId ?? row.id}`,
      source: "revenue",
      summary: `Revenue transaction ${row.externalId ?? row.id}`,
      value: formatCurrency(row.amount)
    });
  }
  const topCompletedJobs = data.jobs
    .filter((job) => job.status === "completed" && inPeriod(job.completedAt ?? job.scheduledAt, period))
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))
    .slice(0, 3);
  for (const job of topCompletedJobs) {
    evidence.push({
      id: `job:${job.externalId ?? job.id}`,
      source: "jobs",
      summary: `Completed ${job.jobType ?? "job"} from ${job.leadSource ?? "unknown source"}`,
      value: formatCurrency(job.revenue ?? 0)
    });
  }
  const bookedLeads = data.leads
    .filter((lead) => inPeriod(lead.createdAtSource, period) && (lead.status === "booked" || Boolean(lead.bookedAt)))
    .slice(0, 3);
  for (const lead of bookedLeads) {
    evidence.push({
      id: `lead:${lead.externalId ?? lead.id}`,
      source: "leads",
      summary: `Booked lead from ${lead.source ?? "unknown source"}`,
      value: lead.estimatedValue ? formatCurrency(lead.estimatedValue) : undefined
    });
  }
  if (metrics.qualityIssues.length) {
    evidence.push({
      id: "quality:issues",
      source: "jobs",
      summary: `Data quality limits: ${metrics.qualityIssues.slice(0, 2).join(" | ")}`
    });
  }
  return evidence;
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return ` (${value.toFixed(1)}%)`;
}

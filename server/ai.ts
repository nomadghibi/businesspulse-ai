import type { AiAnswer, DatasetType, MetricsResponse } from "../shared/types";
import type { AgentRun } from "../shared/types";
import type { OrgData } from "./store";
import { formatCurrency, id, now } from "./utils";

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
    const answer = await callModel(params.question, params.metrics);
    const output = answer ?? groundedAnswer(params.question, params.metrics);
    run.output = output;
    run.status = "success";
    run.modelName = process.env.OPENAI_API_KEY ? process.env.OPENAI_MODEL || "openai-compatible" : "deterministic-fallback";
    run.completedAt = now();
    run.updatedAt = now();
    return { ...output, agentRunId: run.id };
  } catch (error) {
    const output = groundedAnswer(params.question, params.metrics);
    run.output = output;
    run.status = "success";
    run.modelName = "deterministic-fallback-after-model-error";
    run.errorMessage = error instanceof Error ? error.message : "Unknown model error";
    run.completedAt = now();
    run.updatedAt = now();
    return { ...output, agentRunId: run.id };
  }
}

async function callModel(question: string, metrics: MetricsResponse): Promise<Omit<AiAnswer, "agentRunId"> | null> {
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
            "You are BusinessPulse AI. Answer only from supplied metrics. Return JSON with directAnswer, supportingMetrics, dateRange, dataSourcesUsed, assumptions, confidence, recommendedNextAction, reasoning."
        },
        { role: "user", content: JSON.stringify({ question, metrics }) }
      ]
    })
  });
  if (!response.ok) throw new Error(`Model request failed: ${response.status}`);
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return null;
  return JSON.parse(content) as Omit<AiAnswer, "agentRunId">;
}

function groundedAnswer(question: string, metrics: MetricsResponse): Omit<AiAnswer, "agentRunId"> {
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
      `The largest job-type revenue contributor was ${topJobType?.name ?? "not available"}.`,
      `The largest lead-source revenue contributor was ${topSource?.name ?? "not available"}.`
    ]
  };
}

function formatDelta(value: number | null | undefined) {
  if (value === null || value === undefined) return "";
  return ` (${value.toFixed(1)}%)`;
}

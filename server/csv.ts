import Papa from "papaparse";
import { z } from "zod";
import type { ColumnMapping, CsvPreview, DatasetType, FileUpload } from "../shared/types";
import { id, now, toDate, toDateOnly, toNumber } from "./utils.js";
import type { OrgData } from "./store.js";

const datasetSchema = z.enum(["customers", "leads", "jobs", "revenue", "marketing_spend"]);

export const targetFields: Record<DatasetType, string[]> = {
  customers: ["customer_id", "name", "email", "phone", "city", "state", "zip", "lead_source", "created_at"],
  leads: ["lead_id", "customer_id", "source", "status", "created_at", "booked_at", "estimated_value", "campaign"],
  jobs: ["job_id", "customer_id", "lead_id", "job_type", "technician", "status", "scheduled_at", "completed_at", "revenue", "cost", "lead_source"],
  revenue: ["transaction_id", "customer_id", "job_id", "amount", "payment_method", "paid_at"],
  marketing_spend: ["date", "platform", "campaign", "impressions", "clicks", "spend", "leads", "conversions"]
};

const aliases: Record<string, string[]> = {
  customer_id: ["customer id", "customer_id", "client id", "client_id"],
  lead_id: ["lead id", "lead_id"],
  job_id: ["job id", "job_id", "invoice id", "ticket id"],
  transaction_id: ["transaction id", "payment id", "payment_id"],
  name: ["name", "customer", "customer name", "client"],
  source: ["source", "lead source", "channel"],
  lead_source: ["source", "lead source", "channel"],
  job_type: ["job type", "service", "service type", "category"],
  created_at: ["created", "created at", "created_at", "date created"],
  scheduled_at: ["scheduled", "scheduled at", "scheduled_at"],
  completed_at: ["completed", "completed at", "completed_at", "job date"],
  booked_at: ["booked", "booked at", "booked_at"],
  paid_at: ["paid", "paid at", "paid_at", "payment date"],
  amount: ["amount", "payment", "paid", "revenue"],
  spend: ["spend", "cost", "ad spend", "marketing spend"],
  estimated_value: ["estimated value", "estimate", "value"],
  platform: ["platform", "source", "channel"],
  campaign: ["campaign", "campaign name"]
};

const requiredFields: Record<DatasetType, string[]> = {
  customers: ["customer_id"],
  leads: ["lead_id", "created_at"],
  jobs: ["job_id", "completed_at"],
  revenue: ["amount", "paid_at"],
  marketing_spend: ["date", "spend"]
};

export function suggestMappings(columns: string[], datasetType: DatasetType): ColumnMapping[] {
  const lowerColumns = columns.map((column) => ({ column, normalized: column.trim().toLowerCase().replace(/[-_]/g, " ") }));
  return targetFields[datasetType]
    .map((field) => {
      const possible = aliases[field] ?? [field.replace(/_/g, " ")];
      const exact = lowerColumns.find(({ normalized }) => possible.includes(normalized));
      const fuzzy = lowerColumns.find(({ normalized }) => possible.some((alias) => normalized.includes(alias) || alias.includes(normalized)));
      const match = exact ?? fuzzy;
      return match ? { sourceColumn: match.column, targetField: field, confidence: exact ? 0.96 : 0.74 } : null;
    })
    .filter(Boolean) as ColumnMapping[];
}

export function previewCsv(params: {
  organizationId: string;
  datasetType: DatasetType;
  filename: string;
  buffer: Buffer;
}): CsvPreview {
  const datasetType = datasetSchema.parse(params.datasetType);
  const parsed = Papa.parse<Record<string, string>>(params.buffer.toString("utf8"), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });
  if (parsed.errors.length) {
    throw Object.assign(new Error(parsed.errors[0].message), { status: 400 });
  }
  const rows = parsed.data;
  const columns = parsed.meta.fields ?? [];
  const suggestedMappings = suggestMappings(columns, datasetType);
  const qualityIssues = validateRows(datasetType, rows, suggestedMappings);
  return {
    datasetType,
    filename: params.filename,
    rowCount: rows.length,
    columns,
    sampleRows: rows.slice(0, 5),
    suggestedMappings,
    requiredFields: requiredFields[datasetType],
    qualityIssues
  };
}

export function ingestCsv(params: {
  organizationId: string;
  datasetType: DatasetType;
  filename: string;
  buffer: Buffer;
  mappings?: ColumnMapping[];
  data: OrgData;
}) {
  const datasetType = datasetSchema.parse(params.datasetType);
  const parsed = Papa.parse<Record<string, string>>(params.buffer.toString("utf8"), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });
  if (parsed.errors.length) {
    throw Object.assign(new Error(parsed.errors[0].message), { status: 400 });
  }

  const rows = parsed.data;
  const columns = parsed.meta.fields ?? [];
  const mappings = params.mappings?.length ? dedupeMappings(params.mappings) : suggestMappings(columns, datasetType);
  const qualityIssues = validateRows(datasetType, rows, mappings);
  const hasMissingRequiredMappings = requiredFields[datasetType].some(
    (field) => !mappings.some((mapping) => mapping.targetField === field && mapping.sourceColumn)
  );
  const createdAt = now();
  const dataSource = {
    id: id("src"),
    organizationId: params.organizationId,
    sourceType: "csv" as const,
    datasetType,
    displayName: params.filename,
    status: "active" as const,
    lastSyncedAt: createdAt,
    createdAt,
    updatedAt: createdAt
  };
  const upload: FileUpload = {
    id: id("upl"),
    organizationId: params.organizationId,
    dataSourceId: dataSource.id,
    filename: params.filename,
    datasetType,
    status: hasMissingRequiredMappings ? "mapped" : "processed",
    rowCount: rows.length,
    columns,
    mappings,
    qualityIssues,
    sampleRows: rows.slice(0, 5),
    createdAt,
    updatedAt: createdAt
  };

  params.data.dataSources.unshift(dataSource);
  params.data.uploads.unshift(upload);
  if (!hasMissingRequiredMappings) {
    normalizeRows(params.organizationId, datasetType, rows, mappings, params.data);
  }
  return upload;
}

function value(row: Record<string, string>, mappings: ColumnMapping[], field: string) {
  const source = mappings.find((mapping) => mapping.targetField === field)?.sourceColumn;
  return source ? row[source] : undefined;
}

function validateRows(datasetType: DatasetType, rows: Record<string, string>[], mappings: ColumnMapping[]) {
  const issues: string[] = [];
  for (const field of requiredFields[datasetType]) {
    if (!mappings.some((mapping) => mapping.targetField === field)) {
      issues.push(`Missing required mapping for ${field}`);
    }
  }
  if (rows.length === 0) issues.push("CSV contained no data rows");
  return issues;
}

function dedupeMappings(mappings: ColumnMapping[]) {
  const byTarget = new Map<string, ColumnMapping>();
  for (const mapping of mappings) {
    if (!mapping.targetField || !mapping.sourceColumn) continue;
    byTarget.set(mapping.targetField, {
      sourceColumn: mapping.sourceColumn,
      targetField: mapping.targetField,
      confidence: Number.isFinite(mapping.confidence) ? mapping.confidence : 1
    });
  }
  return [...byTarget.values()];
}

function normalizeRows(organizationId: string, datasetType: DatasetType, rows: Record<string, string>[], mappings: ColumnMapping[], data: OrgData) {
  const createdAt = now();
  for (const row of rows) {
    if (datasetType === "customers") {
      data.customers.push({
        id: id("cus"),
        organizationId,
        externalId: value(row, mappings, "customer_id"),
        name: value(row, mappings, "name"),
        email: value(row, mappings, "email"),
        phone: value(row, mappings, "phone"),
        city: value(row, mappings, "city"),
        state: value(row, mappings, "state"),
        zip: value(row, mappings, "zip"),
        leadSource: value(row, mappings, "lead_source"),
        firstSeenAt: toDate(value(row, mappings, "created_at")),
        createdAt,
        updatedAt: createdAt
      });
    }
    if (datasetType === "leads") {
      data.leads.push({
        id: id("lead"),
        organizationId,
        externalId: value(row, mappings, "lead_id"),
        customerExternalId: value(row, mappings, "customer_id"),
        source: value(row, mappings, "source"),
        status: value(row, mappings, "status")?.toLowerCase(),
        createdAtSource: toDate(value(row, mappings, "created_at")),
        bookedAt: toDate(value(row, mappings, "booked_at")),
        estimatedValue: toNumber(value(row, mappings, "estimated_value"), undefined as unknown as number),
        campaign: value(row, mappings, "campaign"),
        createdAt,
        updatedAt: createdAt
      });
    }
    if (datasetType === "jobs") {
      data.jobs.push({
        id: id("job"),
        organizationId,
        externalId: value(row, mappings, "job_id"),
        customerExternalId: value(row, mappings, "customer_id"),
        leadExternalId: value(row, mappings, "lead_id"),
        jobType: value(row, mappings, "job_type"),
        technician: value(row, mappings, "technician"),
        status: value(row, mappings, "status")?.toLowerCase(),
        scheduledAt: toDate(value(row, mappings, "scheduled_at")),
        completedAt: toDate(value(row, mappings, "completed_at")),
        revenue: toNumber(value(row, mappings, "revenue")),
        cost: toNumber(value(row, mappings, "cost")),
        leadSource: value(row, mappings, "lead_source"),
        createdAt,
        updatedAt: createdAt
      });
    }
    if (datasetType === "revenue") {
      data.revenue.push({
        id: id("rev"),
        organizationId,
        externalId: value(row, mappings, "transaction_id"),
        customerExternalId: value(row, mappings, "customer_id"),
        jobExternalId: value(row, mappings, "job_id"),
        amount: toNumber(value(row, mappings, "amount")),
        paymentMethod: value(row, mappings, "payment_method"),
        paidAt: toDate(value(row, mappings, "paid_at")),
        createdAt,
        updatedAt: createdAt
      });
    }
    if (datasetType === "marketing_spend") {
      const date = toDateOnly(value(row, mappings, "date"));
      if (!date) continue;
      data.marketingSpend.push({
        id: id("mkt"),
        organizationId,
        date,
        platform: value(row, mappings, "platform"),
        campaign: value(row, mappings, "campaign"),
        impressions: toNumber(value(row, mappings, "impressions")),
        clicks: toNumber(value(row, mappings, "clicks")),
        spend: toNumber(value(row, mappings, "spend")),
        leads: toNumber(value(row, mappings, "leads")),
        conversions: toNumber(value(row, mappings, "conversions")),
        createdAt,
        updatedAt: createdAt
      });
    }
  }
}

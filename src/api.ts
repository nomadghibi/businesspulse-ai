import type { AiAnswer, Alert, DatasetType, FileUpload, MetricsResponse, Organization, Recommendation, Report } from "../shared/types";

const ORG_HEADER = "org-demo-home-services";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "x-organization-id": ORG_HEADER,
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function getOrganization() {
  return request<Organization>("/organization");
}

export function getMetrics(start: string, end: string) {
  return request<MetricsResponse>(`/metrics?start=${start}&end=${end}`);
}

export function uploadCsv(datasetType: DatasetType, file: File) {
  const form = new FormData();
  form.append("datasetType", datasetType);
  form.append("file", file);
  return request<FileUpload>("/upload", { method: "POST", body: form });
}

export function askAi(question: string, start: string, end: string) {
  return request<AiAnswer>("/ask", { method: "POST", body: JSON.stringify({ question, start, end }) });
}

export function generateReport(start: string, end: string) {
  return request<Report>(`/reports?start=${start}&end=${end}`, { method: "POST" });
}

export function getReports() {
  return request<Report[]>("/reports");
}

export function getUploads() {
  return request<FileUpload[]>("/uploads");
}

export function getAlerts() {
  return request<Alert[]>("/alerts");
}

export function getRecommendations() {
  return request<Recommendation[]>("/recommendations");
}

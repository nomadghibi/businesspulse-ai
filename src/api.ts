import type { AiAnswer, Alert, ColumnMapping, CsvPreview, DatasetType, FileUpload, MetricsResponse, Organization, Recommendation, Report } from "../shared/types";

const TOKEN_KEY = "bp_token";
const REQUEST_TIMEOUT_MS = 15000;
const RETRYABLE_METHODS = new Set(["GET"]);

function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}
export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const retries = RETRYABLE_METHODS.has(method) ? 1 : 0;
  let attempt = 0;
  while (true) {
    try {
      return await requestOnce<T>(path, init);
    } catch (error) {
      if (attempt >= retries || !isRetryableError(error)) throw error;
      attempt += 1;
      await sleep(250 * attempt);
    }
  }
}

async function requestOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const response = await fetch(`/api${path}`, {
    ...init,
    signal: controller.signal,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers
    }
  }).finally(() => {
    window.clearTimeout(timeout);
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function isRetryableError(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return /network|failed to fetch/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function login(email: string, password: string) {
  return request<{ token: string; organizationId: string; role: string; email: string; mustChangePassword: boolean }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function logout() {
  return request<{ ok: true }>("/auth/logout", { method: "POST" });
}

export function changePassword(currentPassword: string, nextPassword: string) {
  return request<{ ok: true }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, nextPassword })
  });
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
  form.append("mode", "commit");
  form.append("file", file);
  return request<FileUpload>("/upload", { method: "POST", body: form });
}

export function previewUploadCsv(datasetType: DatasetType, file: File) {
  const form = new FormData();
  form.append("datasetType", datasetType);
  form.append("mode", "preview");
  form.append("file", file);
  return request<CsvPreview>("/upload", { method: "POST", body: form });
}

export function commitUploadCsv(datasetType: DatasetType, file: File, mappings: ColumnMapping[]) {
  const form = new FormData();
  form.append("datasetType", datasetType);
  form.append("mode", "commit");
  form.append("mappings", JSON.stringify(mappings));
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

export interface OnboardingStatus {
  firstUploadAt: string | null;
  coreDatasetsCompletedAt: string | null;
  timeToFirstInsightSeconds: number | null;
}

export function getOnboardingStatus() {
  return request<OnboardingStatus>("/onboarding-status");
}

export function getAlerts() {
  return request<Alert[]>("/alerts");
}

export function getRecommendations() {
  return request<Recommendation[]>("/recommendations");
}

export function createRecommendationFromAnswer(input: {
  title: string;
  description: string;
  priority?: "low" | "medium" | "high";
  expectedImpact?: string;
  confidence?: "low" | "medium" | "high";
  reason?: string;
}) {
  return request<Recommendation>("/recommendations/from-answer", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function syncStripe(limit = 25) {
  return request<{ syncedCharges: number; scannedCharges: number }>("/integrations/stripe/sync", {
    method: "POST",
    body: JSON.stringify({ limit })
  });
}

export interface AppUser {
  userId: string;
  email: string;
  role: "owner" | "admin" | "viewer";
  disabled: boolean;
}

export function getUsers() {
  return request<AppUser[]>("/users");
}

export function inviteUser(email: string, role: "owner" | "admin" | "viewer", password?: string) {
  return request<{ userId: string; email: string; role: string }>("/users/invite", {
    method: "POST",
    body: JSON.stringify({ email, role, password })
  });
}

export function updateUserRole(userId: string, role: "owner" | "admin" | "viewer") {
  return request<{ ok: true }>(`/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role })
  });
}

export function updateUserStatus(userId: string, disabled: boolean) {
  return request<{ ok: true }>(`/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ disabled })
  });
}

export function trackEvent(eventName: string, payload: Record<string, unknown> = {}) {
  return request<{ ok: true }>("/analytics/track", {
    method: "POST",
    body: JSON.stringify({ eventName, payload })
  });
}

export function trackPublicEvent(eventName: string, payload: Record<string, unknown> = {}) {
  return request<{ ok: true }>("/public/track", {
    method: "POST",
    body: JSON.stringify({ eventName, payload })
  });
}

export function startTrial(email: string, company?: string, phone?: string) {
  return request<{ ok: true; organizationId: string; organizationName: string; ownerEmail: string; temporaryPassword: string }>("/public/trial-start", {
    method: "POST",
    body: JSON.stringify({ email, company, phone, source: "landing" })
  });
}

export function requestDemo(name: string, email: string, company?: string, message?: string) {
  return request<{ ok: true }>("/public/demo-request", {
    method: "POST",
    body: JSON.stringify({ name, email, company, message })
  });
}

export function createCheckout(plan: "starter" | "growth" | "pro") {
  return request<{ url: string | null; sessionId: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan })
  });
}

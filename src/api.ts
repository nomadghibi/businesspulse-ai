import type { AiAnswer, Alert, DatasetType, FileUpload, MetricsResponse, Organization, Recommendation, Report } from "../shared/types";

const TOKEN_KEY = "bp_token";

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
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

export function login(email: string, password: string) {
  return request<{ token: string; organizationId: string; role: string; email: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

export function logout() {
  return request<{ ok: true }>("/auth/logout", { method: "POST" });
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

export function syncStripe(secretKey?: string, limit = 25) {
  return request<{ syncedCharges: number; scannedCharges: number }>("/integrations/stripe/sync", {
    method: "POST",
    body: JSON.stringify({ secretKey, limit })
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

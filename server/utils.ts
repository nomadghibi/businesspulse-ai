import type { DatasetType, Period } from "../shared/types";

export const DEMO_ORG_ID = "org-demo-home-services";

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function now() {
  return new Date().toISOString();
}

export function toNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(/[$,%]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

export function toDate(value: unknown): string | undefined {
  if (!value) return undefined;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function toDateOnly(value: unknown): string | undefined {
  const iso = toDate(value);
  return iso?.slice(0, 10);
}

export function inPeriod(dateLike: unknown, period: Period) {
  const date = toDateOnly(dateLike);
  if (!date) return false;
  return date >= period.start && date <= period.end;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function formatPct(value: number) {
  return `${value.toFixed(1)}%`;
}

export function pctChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function defaultPeriod(): Period {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function previousPeriod(period: Period): Period {
  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - days + 1);
  return { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) };
}

export function sourceLabel(source: DatasetType) {
  return source.replace("_", " ");
}

import type { MetricsResponse } from "../../shared/types";

export function formatTimeToFirstInsight(seconds: number | null, firstUploadAt: string | null) {
  if (typeof seconds === "number") {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  if (firstUploadAt) return "In progress";
  return "Not started";
}

export function formatLastUpdated(iso: string) {
  const updated = new Date(iso);
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - updated.getTime()) / 1000));
  if (deltaSeconds < 5) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  return `${deltaHours}h ago`;
}

export function escapeCsv(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

export function summaryLine(metrics: MetricsResponse) {
  const revenue = metrics.cards.find((card) => card.name === "Total revenue");
  const leads = metrics.cards.find((card) => card.name === "Leads");
  const jobs = metrics.cards.find((card) => card.name === "Booked jobs");
  const change = revenue?.deltaPct === null || revenue?.deltaPct === undefined ? "no prior baseline" : `${revenue.deltaPct.toFixed(1)}% vs prior`;
  return `Revenue is ${revenue?.formatted ?? "$0"} with ${leads?.formatted ?? "0"} leads and ${jobs?.formatted ?? "0"} booked jobs, ${change}.`;
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function StatusItem({ icon, title, meta, body }: { icon?: React.ReactNode; title: string; meta: string; body: string }) {
  return (
    <article className="status-item">
      <div className="status-icon">{icon}</div>
      <div>
        <div className="status-title"><strong>{title}</strong><span>{meta}</span></div>
        <p>{body}</p>
      </div>
    </article>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

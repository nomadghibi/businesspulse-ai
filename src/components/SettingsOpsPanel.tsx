import { Empty, escapeCsv, Panel } from "../app/viewUtils";
import type { OpsMetricsResponse } from "../api";

export function SettingsOpsPanel({
  opsBusy,
  opsError,
  opsMetrics,
  opsHealthSummary,
  onRefresh
}: {
  opsBusy: boolean;
  opsError: string;
  opsMetrics: OpsMetricsResponse | null;
  opsHealthSummary: string;
  onRefresh: () => Promise<void>;
}) {
  function exportOpsMetricsCsv() {
    if (!opsMetrics) return;
    const lines = [
      "section,key,value",
      `overview,started_at,${opsMetrics.startedAt}`,
      `overview,uptime_seconds,${opsMetrics.uptimeSeconds}`,
      `requests,total,${opsMetrics.requests.total}`,
      `requests,errors_5xx,${opsMetrics.requests.errors5xx}`,
      `requests,status_2xx,${opsMetrics.requests.byStatusClass["2xx"]}`,
      `requests,status_3xx,${opsMetrics.requests.byStatusClass["3xx"]}`,
      `requests,status_4xx,${opsMetrics.requests.byStatusClass["4xx"]}`,
      `requests,status_5xx,${opsMetrics.requests.byStatusClass["5xx"]}`,
      `guards,login_attempt_buckets,${opsMetrics.activeGuards.loginAttemptBuckets}`,
      `guards,public_rate_limit_buckets,${opsMetrics.activeGuards.publicRateLimitBuckets}`,
      `guards,in_flight_webhook_events,${opsMetrics.activeGuards.inFlightWebhookEvents}`,
      ...opsMetrics.hottestPaths.map((row) => `hottest_paths,${escapeCsv(row.path)},${row.count}`)
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ops-metrics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel title="Operations">
      <div className="stack">
        <div className="notice">{opsHealthSummary}</div>
        <div className="upload-row">
          <button onClick={() => void onRefresh()} disabled={opsBusy}>
            {opsBusy ? "Refreshing..." : "Refresh Ops Metrics"}
          </button>
          <button onClick={exportOpsMetricsCsv} disabled={!opsMetrics}>Export Ops CSV</button>
          {opsMetrics ? <span>Uptime: {Math.floor(opsMetrics.uptimeSeconds / 60)}m</span> : null}
        </div>
        {opsError ? <div className="notice">{opsError}</div> : null}
        {opsMetrics ? (
          <>
            <div className="upload-row">
              <span>Total requests: {opsMetrics.requests.total}</span>
              <span>5xx errors: {opsMetrics.requests.errors5xx}</span>
              <span>5xx ratio: {((opsMetrics.requests.errors5xx / Math.max(1, opsMetrics.requests.total)) * 100).toFixed(2)}%</span>
              <span>2xx: {opsMetrics.requests.byStatusClass["2xx"]}</span>
              <span>4xx: {opsMetrics.requests.byStatusClass["4xx"]}</span>
              <span>5xx: {opsMetrics.requests.byStatusClass["5xx"]}</span>
            </div>
            <div className="upload-row">
              <span>Login guard buckets: {opsMetrics.activeGuards.loginAttemptBuckets}</span>
              <span>Public limiter buckets: {opsMetrics.activeGuards.publicRateLimitBuckets}</span>
              <span>Webhook in-flight: {opsMetrics.activeGuards.inFlightWebhookEvents}</span>
            </div>
            <div className="table">
              <div className="table-head"><span>Hot Path</span><span>Requests</span></div>
              {opsMetrics.hottestPaths.map((row) => (
                <div className="table-row" key={row.path}>
                  <span>{row.path}</span>
                  <span>{row.count}</span>
                </div>
              ))}
              {!opsMetrics.hottestPaths.length ? <Empty text="No request traffic recorded yet." /> : null}
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

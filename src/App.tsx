import { AlertTriangle, BarChart3, Bot, Database, FileText, Lightbulb, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AiAnswer, DatasetType, FileUpload, MetricsResponse, Organization, Recommendation, Report } from "../shared/types";
import { askAi, generateReport, getAlerts, getMetrics, getOrganization, getRecommendations, getReports, getUploads, uploadCsv } from "./api";

const datasetTypes: Array<{ value: DatasetType; label: string }> = [
  { value: "customers", label: "Customers" },
  { value: "leads", label: "Leads" },
  { value: "jobs", label: "Jobs" },
  { value: "revenue", label: "Revenue" },
  { value: "marketing_spend", label: "Marketing Spend" }
];

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function App() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [alerts, setAlerts] = useState<Array<{ title: string; severity: string; description: string }>>([]);
  const [active, setActive] = useState("dashboard");
  const [start, setStart] = useState(dateDaysAgo(29));
  const [end, setEnd] = useState(dateDaysAgo(0));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, metricsRes, uploadsRes, reportsRes, recsRes, alertsRes] = await Promise.all([
        getOrganization(),
        getMetrics(start, end),
        getUploads(),
        getReports(),
        getRecommendations(),
        getAlerts()
      ]);
      setOrg(orgRes);
      setMetrics(metricsRes);
      setUploads(uploadsRes);
      setReports(reportsRes);
      setRecommendations(recsRes);
      setAlerts(alertsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [start, end]);

  const tabs = [
    ["dashboard", BarChart3, "Dashboard"],
    ["ask", Bot, "Ask AI"],
    ["sources", Database, "Data Sources"],
    ["reports", FileText, "Reports"],
    ["recommendations", Lightbulb, "Recommendations"]
  ] as const;

  return (
    <main>
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">BP</div>
          <div>
            <strong>BusinessPulse AI</strong>
            <span>{org?.businessType ?? "Home services"}</span>
          </div>
        </div>
        <nav>
          {tabs.map(([key, Icon, label]) => (
            <button key={key} className={active === key ? "active" : ""} onClick={() => setActive(key)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{org?.name ?? "Demo Home Services Co."}</h1>
            <p>Revenue, leads, jobs, conversion, and marketing performance.</p>
          </div>
          <div className="date-controls">
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} />
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </div>
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {loading && !metrics ? <Loading /> : null}

        {metrics && active === "dashboard" ? <Dashboard metrics={metrics} alerts={alerts} recommendations={recommendations} /> : null}
        {metrics && active === "ask" ? <AskAI start={start} end={end} /> : null}
        {active === "sources" ? <DataSources uploads={uploads} refresh={refresh} /> : null}
        {active === "reports" ? <Reports reports={reports} start={start} end={end} refresh={refresh} /> : null}
        {active === "recommendations" ? <Recommendations recommendations={recommendations} /> : null}
      </section>
    </main>
  );
}

function Loading() {
  return (
    <div className="loading">
      <Loader2 className="spin" size={24} />
      Loading workspace
    </div>
  );
}

function Dashboard({ metrics, alerts, recommendations }: { metrics: MetricsResponse; alerts: Array<{ title: string; severity: string; description: string }>; recommendations: Recommendation[] }) {
  return (
    <div className="stack">
      <section className="brief">
        <div>
          <span className="eyebrow">Executive brief</span>
          <h2>{summaryLine(metrics)}</h2>
          <p>Comparison period: {metrics.comparisonPeriod.start} to {metrics.comparisonPeriod.end}. Sources: {metrics.dataSourcesUsed.join(", ").replace("_", " ")}.</p>
        </div>
        <div className="brief-actions">
          <strong>{recommendations[0]?.priority ?? "low"} priority</strong>
          <span>{recommendations[0]?.title ?? "Monitor weekly performance"}</span>
        </div>
      </section>

      <section className="kpis">
        {metrics.cards.map((card) => (
          <article className="card" key={card.name}>
            <span>{card.name}</span>
            <strong>{card.formatted}</strong>
            <small className={card.deltaPct === null ? "" : card.deltaPct < 0 ? "negative" : "positive"}>
              {card.deltaPct === null ? "No prior baseline" : `${card.deltaPct.toFixed(1)}% vs prior`}
            </small>
          </article>
        ))}
      </section>

      <section className="grid two">
        <Panel title="Revenue Trend">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={metrics.trends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" hide />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="revenue" stroke="#176b5b" fill="#a8d5c7" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Revenue By Lead Source">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={metrics.revenueByLeadSource}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#2f5d8c" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <section className="grid two">
        <Panel title="Alerts">
          <div className="list">
            {alerts.length ? alerts.map((alert) => <StatusItem key={alert.title} icon={<AlertTriangle size={18} />} title={alert.title} meta={alert.severity} body={alert.description} />) : <Empty text="No severe anomalies detected for this range." />}
          </div>
        </Panel>
        <Panel title="Data Quality">
          <div className="list">
            {metrics.qualityIssues.length ? metrics.qualityIssues.map((issue) => <StatusItem key={issue} title={issue} meta="review" body="This limitation will be cited in AI answers." />) : <Empty text="No upload quality issues are currently blocking analysis." />}
          </div>
        </Panel>
      </section>
    </div>
  );
}

function AskAI({ start, end }: { start: string; end: string }) {
  const [question, setQuestion] = useState("Why did revenue change in this period?");
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    try {
      setAnswer(await askAi(question, start, end));
    } finally {
      setLoading(false);
    }
  }

  const suggestions = ["Why did revenue drop last week?", "Which lead source gives us the best customers?", "Are we spending too much on ads?"];

  return (
    <div className="stack">
      <Panel title="Ask AI">
        <div className="ask-box">
          <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
          <button className="primary" onClick={submit} disabled={loading}>{loading ? "Analyzing" : "Ask"}</button>
        </div>
        <div className="chips">
          {suggestions.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}
        </div>
      </Panel>
      {answer ? (
        <section className="answer">
          <div>
            <span className="eyebrow">Grounded answer</span>
            <h2>{answer.directAnswer}</h2>
            <p>Confidence: {answer.confidence}. Range: {answer.dateRange.start} to {answer.dateRange.end}.</p>
          </div>
          <div className="metrics-list">
            {answer.supportingMetrics.map((metric) => (
              <div key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            ))}
          </div>
          <Panel title="Reasoning And Sources">
            <ul className="bullets">
              {answer.reasoning.map((item) => <li key={item}>{item}</li>)}
              <li>Sources used: {answer.dataSourcesUsed.join(", ")}</li>
              <li>Recommended next action: {answer.recommendedNextAction}</li>
            </ul>
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

function DataSources({ uploads, refresh }: { uploads: FileUpload[]; refresh: () => Promise<void> }) {
  const [datasetType, setDatasetType] = useState<DatasetType>("jobs");
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      await uploadCsv(datasetType, file);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Panel title="Upload CSV">
        <div className="upload-row">
          <select value={datasetType} onChange={(event) => setDatasetType(event.target.value as DatasetType)}>
            {datasetTypes.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
          </select>
          <label className="file-input">
            <Upload size={18} />
            {busy ? "Processing..." : "Choose CSV"}
            <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>
      </Panel>
      <Panel title="Upload History">
        <div className="table">
          <div className="table-head"><span>File</span><span>Dataset</span><span>Rows</span><span>Status</span></div>
          {uploads.map((upload) => (
            <div className="table-row" key={upload.id}>
              <span>{upload.filename}</span>
              <span>{upload.datasetType}</span>
              <span>{upload.rowCount}</span>
              <span>{upload.status}</span>
            </div>
          ))}
          {!uploads.length ? <Empty text="No CSV uploads yet. Sample data is already loaded." /> : null}
        </div>
      </Panel>
    </div>
  );
}

function Reports({ reports, start, end, refresh }: { reports: Report[]; start: string; end: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      await generateReport(start, end);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <button className="primary align-start" onClick={create}>{busy ? "Generating..." : "Generate Weekly Brief"}</button>
      {reports.map((report) => (
        <section className="report" key={report.id}>
          <span className="eyebrow">{report.reportType}</span>
          <h2>{report.title}</h2>
          <p>{report.summary}</p>
          <ul className="bullets">{report.content.metricChanges.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ))}
      {!reports.length ? <Empty text="No generated reports yet." /> : null}
    </div>
  );
}

function Recommendations({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <Panel title="Prioritized Actions">
      <div className="list">
        {recommendations.map((rec) => <StatusItem key={rec.id} title={rec.title} meta={rec.priority} body={`${rec.description} Expected impact: ${rec.expectedImpact}`} />)}
      </div>
    </Panel>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function StatusItem({ icon, title, meta, body }: { icon?: React.ReactNode; title: string; meta: string; body: string }) {
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

function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function summaryLine(metrics: MetricsResponse) {
  const revenue = metrics.cards.find((card) => card.name === "Total revenue");
  const leads = metrics.cards.find((card) => card.name === "Leads");
  const jobs = metrics.cards.find((card) => card.name === "Booked jobs");
  const change = revenue?.deltaPct === null || revenue?.deltaPct === undefined ? "no prior baseline" : `${revenue.deltaPct.toFixed(1)}% vs prior`;
  return `Revenue is ${revenue?.formatted ?? "$0"} with ${leads?.formatted ?? "0"} leads and ${jobs?.formatted ?? "0"} booked jobs, ${change}.`;
}

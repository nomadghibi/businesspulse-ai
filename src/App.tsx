import { AlertTriangle, ArrowRight, BarChart3, Bot, CheckCircle2, Database, FileText, Lightbulb, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AiAnswer, ColumnMapping, CsvPreview, DatasetType, FileUpload, MetricsResponse, Organization, Recommendation, Report } from "../shared/types";
import { askAi, changePassword, clearToken, commitUploadCsv, createCheckout, type AppUser, generateReport, getAlerts, getMetrics, getOnboardingStatus, getOrganization, getRecommendations, getReports, getUploads, getUsers, inviteUser, login, logout, type OnboardingStatus, previewUploadCsv, requestDemo, setToken, startTrial, syncStripe, trackEvent, trackPublicEvent, updateUserRole, updateUserStatus } from "./api";

const datasetTypes: Array<{ value: DatasetType; label: string }> = [
  { value: "customers", label: "Customers" },
  { value: "leads", label: "Leads" },
  { value: "jobs", label: "Jobs" },
  { value: "revenue", label: "Revenue" },
  { value: "marketing_spend", label: "Marketing Spend" }
];

const datasetTargetFields: Record<DatasetType, string[]> = {
  customers: ["customer_id", "name", "email", "phone", "city", "state", "zip", "lead_source", "created_at"],
  leads: ["lead_id", "customer_id", "source", "status", "created_at", "booked_at", "estimated_value", "campaign"],
  jobs: ["job_id", "customer_id", "lead_id", "job_type", "technician", "status", "scheduled_at", "completed_at", "revenue", "cost", "lead_source"],
  revenue: ["transaction_id", "customer_id", "job_id", "amount", "payment_method", "paid_at"],
  marketing_spend: ["date", "platform", "campaign", "impressions", "clicks", "spend", "leads", "conversions"]
};

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
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [alerts, setAlerts] = useState<Array<{ title: string; severity: string; description: string }>>([]);
  const [active, setActive] = useState("dashboard");
  const [start, setStart] = useState(dateDaysAgo(29));
  const [end, setEnd] = useState(dateDaysAgo(0));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("bp_token")));
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [enteredApp, setEnteredApp] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [orgRes, metricsRes, uploadsRes, reportsRes, recsRes, alertsRes, onboardingRes] = await Promise.all([
        getOrganization(),
        getMetrics(start, end),
        getUploads(),
        getReports(),
        getRecommendations(),
        getAlerts(),
        getOnboardingStatus()
      ]);
      const usersRes = await getUsers().catch(() => [] as AppUser[]);
      setOrg(orgRes);
      setMetrics(metricsRes);
      setUploads(uploadsRes);
      setReports(reportsRes);
      setRecommendations(recsRes);
      setAlerts(alertsRes);
      setOnboarding(onboardingRes);
      setUsers(usersRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed && !mustChangePassword) void refresh();
  }, [start, end, authed, mustChangePassword]);

  const tabs = [
    ["dashboard", BarChart3, "Dashboard"],
    ["ask", Bot, "Ask AI"],
    ["sources", Database, "Data Sources"],
    ["reports", FileText, "Reports"],
    ["recommendations", Lightbulb, "Recommendations"],
    ["settings", Database, "Settings"]
  ] as const;

  if (!enteredApp) return <LandingPage onEnterApp={() => setEnteredApp(true)} onTrialAuthed={(mustReset) => { setEnteredApp(true); setAuthed(true); setMustChangePassword(mustReset); }} />;
  if (!authed) return <LoginGate onAuthed={(mustReset) => { setAuthed(true); setMustChangePassword(mustReset); }} />;

  return (
    <main className="app-shell">
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
            <button onClick={async () => {
              try { await logout(); } catch {}
              clearToken();
              setAuthed(false);
              setEnteredApp(false);
            }}>Logout</button>
          </div>
        </header>
        {mustChangePassword ? (
          <section className="panel">
            <h2>Update Password</h2>
            <div className="upload-row">
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" />
              <input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="New password (min 8 chars)" />
              <button className="primary" onClick={async () => {
                await changePassword(currentPassword, nextPassword);
                setMustChangePassword(false);
                setCurrentPassword("");
                setNextPassword("");
                setPasswordMessage("Password updated.");
              }}>Update Password</button>
            </div>
            {passwordMessage ? <p>{passwordMessage}</p> : null}
          </section>
        ) : null}

        {error ? <div className="notice error">{error}</div> : null}
        {loading && !metrics ? <Loading /> : null}

        {metrics && active === "dashboard" ? <Dashboard metrics={metrics} uploads={uploads} alerts={alerts} recommendations={recommendations} onboarding={onboarding} onOpenSources={() => setActive("sources")} /> : null}
        {metrics && active === "ask" ? <AskAI start={start} end={end} /> : null}
        {active === "sources" ? <DataSources uploads={uploads} refresh={refresh} /> : null}
        {active === "reports" ? <Reports reports={reports} start={start} end={end} refresh={refresh} /> : null}
        {active === "recommendations" ? <Recommendations recommendations={recommendations} /> : null}
        {active === "settings" ? <Settings users={users} syncMessage={syncMessage} onSync={async () => {
          const result = await syncStripe(25);
          setSyncMessage(`Synced ${result.syncedCharges} new charges out of ${result.scannedCharges} scanned.`);
          await refresh();
        }} onUsersChanged={refresh} /> : null}
      </section>
    </main>
  );
}

function LoginGate({ onAuthed }: { onAuthed: (mustReset: boolean) => void }) {
  const [email, setEmail] = useState("owner@businesspulse.local");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-shell">
      <section className="workspace">
        <header className="topbar"><h1>BusinessPulse AI Login</h1></header>
        <section className="panel" style={{ maxWidth: 460 }}>
          <div className="stack">
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
            {error ? <div className="notice error">{error}</div> : null}
            <button className="primary" onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const response = await login(email, password);
                setToken(response.token);
                onAuthed(Boolean(response.mustChangePassword));
              } catch (err) {
                setError(err instanceof Error ? err.message : "Login failed");
              } finally {
                setBusy(false);
              }
            }}>{busy ? "Signing in..." : "Sign in"}</button>
          </div>
        </section>
      </section>
    </main>
  );
}

function LandingPage({ onEnterApp, onTrialAuthed }: { onEnterApp: () => void; onTrialAuthed: (mustReset: boolean) => void }) {
  const [trialEmail, setTrialEmail] = useState("");
  const [trialCompany, setTrialCompany] = useState("");
  const [trialMessage, setTrialMessage] = useState("");
  const [demoName, setDemoName] = useState("");
  const [demoEmail, setDemoEmail] = useState("");
  const [demoCompany, setDemoCompany] = useState("");
  const [demoMessage, setDemoMessage] = useState("");
  return (
    <main className="landing-shell">
      <section className="hero">
        <header className="landing-nav">
          <div className="landing-brand">
            <div className="mark">BP</div>
            <strong>BusinessPulse AI</strong>
          </div>
          <button className="primary" onClick={async () => { await trackPublicEvent("landing_enter_app_click"); onEnterApp(); }}>Enter App <ArrowRight size={16} /></button>
        </header>
        <div className="hero-content">
          <p className="badge">AI Business Analyst For Home Services</p>
          <h1>Know what changed in revenue, leads, and jobs before it costs you this week.</h1>
          <p className="hero-copy">BusinessPulse turns your service data into executive clarity with grounded answers, anomaly alerts, and actions your team can ship immediately.</p>
          <div className="hero-actions">
            <button className="primary" onClick={async () => { await trackPublicEvent("landing_start_trial_click"); }}>
              Start Free Trial <ArrowRight size={16} />
            </button>
            <button onClick={async () => { await trackPublicEvent("landing_book_demo_click"); }}>
              Book Demo
            </button>
          </div>
        </div>
      </section>

      <section className="landing-band stats">
        {[
          ["10 min", "to first insight"],
          ["98%", "answer traceability"],
          ["7 KPIs", "monitored continuously"],
          ["1 workspace", "for owners and ops"]
        ].map(([value, label]) => (
          <article key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>

      <section className="landing-band features">
        <h2>Built for operators, not analysts</h2>
        <div className="feature-grid">
          {[
            "Instant KPI visibility across revenue, lead quality, conversion, and spend",
            "Grounded AI answers with assumptions, confidence, and supporting metrics",
            "Daily briefs and anomaly alerts that point to concrete next actions",
            "Role-based access, tenant isolation, and auditable AI runs"
          ].map((item) => (
            <div className="feature-item" key={item}>
              <CheckCircle2 size={18} />
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-band pricing">
        <h2>Simple launch pricing</h2>
        <div className="pricing-row">
          <article>
            <h3>Starter</h3>
            <strong>$299<span>/mo</span></strong>
            <p>Single location, core dashboards, Ask AI, and weekly briefs.</p>
          </article>
          <article>
            <h3>Growth</h3>
            <strong>$799<span>/mo</span></strong>
            <p>Multi-location rollups, advanced recommendations, and team roles.</p>
          </article>
          <article>
            <h3>Pro</h3>
            <strong>Custom</strong>
            <p>Integration setup, custom KPI models, and priority support.</p>
          </article>
        </div>
        <button className="primary" onClick={onEnterApp}>Launch BusinessPulse <ArrowRight size={16} /></button>
      </section>

      <section className="landing-band">
        <h2>Start Your Trial</h2>
        <div className="signup-row">
          <input value={trialEmail} onChange={(event) => setTrialEmail(event.target.value)} placeholder="Work email" />
          <input value={trialCompany} onChange={(event) => setTrialCompany(event.target.value)} placeholder="Company name" />
          <button className="primary" onClick={async () => {
            const trial = await startTrial(trialEmail, trialCompany);
            const auth = await login(trial.ownerEmail, trial.temporaryPassword);
            setToken(auth.token);
            setTrialMessage(`Workspace created: ${trial.organizationName}. Signed in as ${trial.ownerEmail}.`);
            await trackPublicEvent("trial_form_submitted", { email: trialEmail });
            setTrialEmail("");
            onTrialAuthed(Boolean(auth.mustChangePassword));
          }}>Start Trial</button>
        </div>
        {trialMessage ? <p>{trialMessage}</p> : null}
      </section>

      <section className="landing-band">
        <h2>Book A Demo</h2>
        <div className="signup-row">
          <input value={demoName} onChange={(event) => setDemoName(event.target.value)} placeholder="Your name" />
          <input value={demoEmail} onChange={(event) => setDemoEmail(event.target.value)} placeholder="Work email" />
          <input value={demoCompany} onChange={(event) => setDemoCompany(event.target.value)} placeholder="Company" />
          <button onClick={async () => {
            await requestDemo(demoName, demoEmail, demoCompany, "Requested from landing page");
            setDemoMessage("Demo request submitted. We will contact you within one business day.");
            await trackPublicEvent("demo_form_submitted", { email: demoEmail });
            setDemoName("");
            setDemoEmail("");
          }}>Request Demo</button>
        </div>
        {demoMessage ? <p>{demoMessage}</p> : null}
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

function Dashboard({
  metrics,
  uploads,
  alerts,
  recommendations,
  onboarding,
  onOpenSources
}: {
  metrics: MetricsResponse;
  uploads: FileUpload[];
  alerts: Array<{ title: string; severity: string; description: string }>;
  recommendations: Recommendation[];
  onboarding: OnboardingStatus | null;
  onOpenSources: () => void;
}) {
  const requiredDatasets: DatasetType[] = ["jobs", "leads", "revenue", "marketing_spend"];
  const latestByDataset = new Map<DatasetType, FileUpload>();
  for (const upload of uploads) {
    if (!latestByDataset.has(upload.datasetType)) latestByDataset.set(upload.datasetType, upload);
  }
  const completed = requiredDatasets.filter((dataset) => latestByDataset.get(dataset)?.status === "processed").length;
  const completionScore = Math.round((completed / requiredDatasets.length) * 80);
  const qualityIssueCount = requiredDatasets.reduce((total, dataset) => total + (latestByDataset.get(dataset)?.qualityIssues.length ?? 0), 0);
  const qualityScore = Math.max(0, 20 - qualityIssueCount * 2);
  const setupScore = Math.max(0, Math.min(100, completionScore + qualityScore));
  const timeToFirstInsight = formatTimeToFirstInsight(onboarding?.timeToFirstInsightSeconds ?? null, onboarding?.firstUploadAt ?? null);

  return (
    <div className="stack">
      <section className="panel setup-panel">
        <div className="setup-header">
          <div>
            <h2>First Import Checklist</h2>
            <p>Upload the core datasets to increase analysis reliability and recommendation quality.</p>
          </div>
          <div className="setup-score">
            <strong>{setupScore}%</strong>
            <span>Data Readiness</span>
          </div>
        </div>
        <div className="table setup-table">
          <div className="table-head"><span>Dataset</span><span>Status</span></div>
          {requiredDatasets.map((dataset) => {
            const row = latestByDataset.get(dataset);
            const ok = row?.status === "processed";
            return (
              <div className="table-row" key={dataset}>
                <span>{dataset.replace("_", " ")}</span>
                <span>{ok ? "complete" : row ? row.status : "missing"}</span>
              </div>
            );
          })}
        </div>
        <p><strong>Time to first insight:</strong> {timeToFirstInsight}</p>
        <button className="primary align-start" onClick={onOpenSources}>Go To Data Sources</button>
      </section>
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

function formatTimeToFirstInsight(seconds: number | null, firstUploadAt: string | null) {
  if (typeof seconds === "number") {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    return `${(seconds / 3600).toFixed(1)}h`;
  }
  if (firstUploadAt) return "In progress";
  return "Not started";
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
            {answer.supportingEvidence.length ? (
              <div className="table">
                <div className="table-head"><span>Evidence</span><span>Value</span></div>
                {answer.supportingEvidence.map((item) => (
                  <div className="table-row" key={item.id}>
                    <span>{item.id} - {item.summary}</span>
                    <span>{item.value ?? "-"}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>
        </section>
      ) : null}
    </div>
  );
}

function DataSources({ uploads, refresh }: { uploads: FileUpload[]; refresh: () => Promise<void> }) {
  const [datasetType, setDatasetType] = useState<DatasetType>("jobs");
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  async function onFile(file: File | null) {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const nextPreview = await previewUploadCsv(datasetType, file);
      setPendingFile(file);
      setPreview(nextPreview);
      const defaults: Record<string, string> = {};
      for (const field of datasetTargetFields[datasetType]) {
        defaults[field] = nextPreview.suggestedMappings.find((mapping) => mapping.targetField === field)?.sourceColumn ?? "";
      }
      setMappingDraft(defaults);
    } finally {
      setBusy(false);
    }
  }

  async function commitUpload() {
    if (!pendingFile || !preview) return;
    const mappings: ColumnMapping[] = Object.entries(mappingDraft)
      .filter(([, sourceColumn]) => sourceColumn)
      .map(([targetField, sourceColumn]) => ({ targetField, sourceColumn, confidence: 1 }));
    const missing = preview.requiredFields.filter((field) => !mappingDraft[field]);
    if (missing.length) {
      setMessage(`Required mappings missing: ${missing.join(", ")}`);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await commitUploadCsv(datasetType, pendingFile, mappings);
      setPendingFile(null);
      setPreview(null);
      setMappingDraft({});
      setMessage("Upload processed successfully.");
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
            {busy ? "Processing..." : "Choose CSV For Preview"}
            <input type="file" accept=".csv,text/csv" onChange={(event) => void onFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>
        {message ? <div className="notice">{message}</div> : null}
        {preview ? (
          <div className="stack">
            <div className="table">
              <div className="table-head"><span>Field</span><span>Column Mapping</span></div>
              {datasetTargetFields[datasetType].map((field) => (
                <div className="table-row" key={field}>
                  <span>{field}{preview.requiredFields.includes(field) ? " *" : ""}</span>
                  <select
                    value={mappingDraft[field] ?? ""}
                    onChange={(event) => setMappingDraft((prev) => ({ ...prev, [field]: event.target.value }))}
                  >
                    <option value="">Unmapped</option>
                    {preview.columns.map((column) => <option key={`${field}:${column}`} value={column}>{column}</option>)}
                  </select>
                </div>
              ))}
            </div>
            {preview.qualityIssues.length ? <div className="notice">{preview.qualityIssues.join(" | ")}</div> : null}
            <button className="primary align-start" disabled={busy} onClick={commitUpload}>
              {busy ? "Committing..." : "Commit Import"}
            </button>
          </div>
        ) : null}
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

function Settings({ onSync, syncMessage, users, onUsersChanged }: { onSync: () => Promise<void>; syncMessage: string; users: AppUser[]; onUsersChanged: () => Promise<void> }) {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "viewer">("viewer");
  const [invitePassword, setInvitePassword] = useState("changeme123");
  const [busy, setBusy] = useState(false);
  const [billingMsg, setBillingMsg] = useState("");
  return (
    <div className="stack">
      <Panel title="Stripe Integration">
        <div className="stack">
          <button className="primary align-start" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await onSync();
            } finally {
              setBusy(false);
            }
          }}>{busy ? "Syncing..." : "Sync Stripe Charges"}</button>
          <p>Server uses `STRIPE_SECRET_KEY` from environment. Browser does not send Stripe credentials.</p>
          {syncMessage ? <div className="notice">{syncMessage}</div> : null}
        </div>
      </Panel>
      <Panel title="Users And Roles">
        <div className="stack">
          <div className="upload-row">
            <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="new.user@company.com" />
            <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "owner" | "admin" | "viewer")}>
              <option value="owner">Owner</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <input value={invitePassword} onChange={(event) => setInvitePassword(event.target.value)} placeholder="temporary password" />
            <button className="primary" onClick={async () => {
              await inviteUser(inviteEmail, inviteRole, invitePassword);
              setInviteEmail("");
              await onUsersChanged();
            }}>Invite</button>
          </div>
          <div className="table">
            <div className="table-head"><span>Email</span><span>Role</span><span>Status</span><span>Action</span></div>
            {users.map((user) => (
              <div className="table-row" key={user.userId}>
                <span>{user.email}</span>
                <select value={user.role} onChange={async (event) => {
                  await updateUserRole(user.userId, event.target.value as "owner" | "admin" | "viewer");
                  await onUsersChanged();
                }}>
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="viewer">Viewer</option>
                </select>
                <span>{user.disabled ? "disabled" : "active"}</span>
                <button onClick={async () => {
                  await updateUserStatus(user.userId, !user.disabled);
                  await onUsersChanged();
                }}>{user.disabled ? "Enable" : "Disable"}</button>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <Panel title="Billing">
        <div className="upload-row">
          <button className="primary" onClick={async () => {
            const checkout = await createCheckout("starter");
            if (checkout.url) window.location.href = checkout.url;
            setBillingMsg("Starter checkout session created.");
          }}>Checkout Starter</button>
          <button onClick={async () => {
            const checkout = await createCheckout("growth");
            if (checkout.url) window.location.href = checkout.url;
            setBillingMsg("Growth checkout session created.");
          }}>Checkout Growth</button>
          <button onClick={async () => {
            const checkout = await createCheckout("pro");
            if (checkout.url) window.location.href = checkout.url;
            setBillingMsg("Pro checkout session created.");
          }}>Checkout Pro</button>
        </div>
        {billingMsg ? <p>{billingMsg}</p> : null}
      </Panel>
    </div>
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

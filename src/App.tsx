import { AlertTriangle, ArrowRight, BarChart3, Bot, CheckCircle2, Database, FileText, Lightbulb, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AiAnswer, ColumnMapping, CsvPreview, DatasetType, FileUpload, MetricsResponse, Organization, Recommendation, Report } from "../shared/types";
import { askAi, changePassword, clearToken, commitUploadCsv, createCheckout, createRecommendationFromAnswer, type AppUser, generateReport, getAlerts, getMetrics, getOnboardingStatus, getOrganization, getRecommendations, getReports, getUploads, getUsers, inviteUser, login, logout, type OnboardingStatus, previewUploadCsv, requestDemo, setToken, startTrial, syncStripe, trackEvent, trackPublicEvent, updateRecommendationStatus, updateUserRole, updateUserStatus } from "./api";

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

const allowedTabs = ["dashboard", "sources", "ask", "reports", "recommendations", "settings"] as const;
type AppTab = typeof allowedTabs[number];

function normalizeTab(value: string | null | undefined): AppTab {
  if (value && allowedTabs.includes(value as AppTab)) return value as AppTab;
  return "dashboard";
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidDateRange(start: string, end: string) {
  const today = dateDaysAgo(0);
  return isIsoDate(start) && isIsoDate(end) && start <= end && start <= today && end <= today;
}

function clampDateToToday(value: string) {
  if (!isIsoDate(value)) return value;
  const today = dateDaysAgo(0);
  return value > today ? today : value;
}

function readUrlViewState() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  const start = params.get("start");
  const end = params.get("end");
  const live = params.get("live");
  return { tab, start, end, live };
}

function initialDateRange() {
  const { start: startParam, end: endParam } = readUrlViewState();
  if (startParam && endParam && isValidDateRange(startParam, endParam)) {
    return { start: startParam, end: endParam };
  }
  const startSaved = localStorage.getItem("bp_range_start");
  const endSaved = localStorage.getItem("bp_range_end");
  if (startSaved && endSaved) return { start: startSaved, end: endSaved };
  return { start: dateDaysAgo(29), end: dateDaysAgo(0) };
}

function dateRangeDaysAgo(days: number) {
  return { start: dateDaysAgo(days - 1), end: dateDaysAgo(0) };
}

function shiftDateRange(start: string, end: string, direction: "backward" | "forward") {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const spanDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const delta = direction === "backward" ? -spanDays : spanDays;
  startDate.setDate(startDate.getDate() + delta);
  endDate.setDate(endDate.getDate() + delta);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10)
  };
}

function shiftDateRangeWithoutFuture(start: string, end: string, direction: "backward" | "forward") {
  const next = shiftDateRange(start, end, direction);
  if (direction === "backward") return next;
  const today = dateDaysAgo(0);
  if (next.end <= today) return next;
  return alignRangeToToday(start, end);
}

function alignRangeToToday(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const spanDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
  const today = new Date();
  const nextEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const nextStart = new Date(nextEnd);
  nextStart.setUTCDate(nextStart.getUTCDate() - (spanDays - 1));
  return {
    start: nextStart.toISOString().slice(0, 10),
    end: nextEnd.toISOString().slice(0, 10)
  };
}

function dateWindowDays(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

function canShiftForward(end: string) {
  return end < dateDaysAgo(0);
}

export function App() {
  const initialRange = initialDateRange();
  const initialUrlState = readUrlViewState();
  const initialTabFromUrl = initialUrlState.tab;
  const [org, setOrg] = useState<Organization | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [uploads, setUploads] = useState<FileUpload[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [alerts, setAlerts] = useState<Array<{ title: string; severity: string; description: string }>>([]);
  const [active, setActive] = useState<AppTab>(() => normalizeTab(initialTabFromUrl ?? localStorage.getItem("bp_active_tab")));
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const refreshInFlight = useRef(false);
  const activePreset = useMemo<"7d" | "30d" | "90d" | "12m" | null>(() => {
    const today = dateDaysAgo(0);
    if (end !== today) return null;
    if (start === dateDaysAgo(6)) return "7d";
    if (start === dateDaysAgo(29)) return "30d";
    if (start === dateDaysAgo(89)) return "90d";
    if (start === dateDaysAgo(364)) return "12m";
    return null;
  }, [start, end]);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("bp_token")));
  const [syncMessage, setSyncMessage] = useState<string>("");
  const [users, setUsers] = useState<AppUser[]>([]);
  const [enteredApp, setEnteredApp] = useState(Boolean(localStorage.getItem("bp_token")));
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [askSeed, setAskSeed] = useState("");
  const [askAutoRun, setAskAutoRun] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [shortcutsCopied, setShortcutsCopied] = useState(false);
  const [viewLinkMessage, setViewLinkMessage] = useState<string | null>(null);
  const [liveRefreshEnabled, setLiveRefreshEnabled] = useState(() => {
    if (initialUrlState.live === "on") return true;
    if (initialUrlState.live === "off") return false;
    const raw = localStorage.getItem("bp_live_refresh_enabled");
    return raw == null ? true : raw === "true";
  });
  const windowDays = useMemo(() => dateWindowDays(start, end), [start, end]);
  const forwardEnabled = useMemo(() => canShiftForward(end), [end]);
  const hasInvalidRange = start > end;
  const todayAligned = useMemo(() => alignRangeToToday(start, end).end === end, [start, end]);

  function normalizeDateRangeForRefresh() {
    if (!hasInvalidRange) return { start, end };
    return { start: end, end: start };
  }

  function resetViewState() {
    const next = dateRangeDaysAgo(30);
    setActive("dashboard");
    setStart(next.start);
    setEnd(next.end);
    setLiveRefreshEnabled(true);
    setError(null);
  }

  async function copyCurrentViewLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setViewLinkMessage("View link copied.");
    } catch {
      setViewLinkMessage("Unable to copy link in this browser.");
    }
  }

  async function refresh(options?: { silent?: boolean; startOverride?: string; endOverride?: string }) {
    const rangeStart = options?.startOverride ?? start;
    const rangeEnd = options?.endOverride ?? end;
    if (rangeStart > rangeEnd) return;
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    if (!silent) setError(null);
    try {
      const [orgRes, metricsRes, uploadsRes, reportsRes, recsRes, alertsRes, onboardingRes] = await Promise.all([
        getOrganization(),
        getMetrics(rangeStart, rangeEnd),
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
      setLastUpdatedAt(new Date().toISOString());
      setRefreshWarning(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load dashboard";
      if (silent && metrics) {
        setRefreshWarning(`Live refresh failed: ${message}`);
      } else {
        setError(message);
      }
    } finally {
      refreshInFlight.current = false;
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (authed && !mustChangePassword) void refresh();
  }, [start, end, authed, mustChangePassword]);

  useEffect(() => {
    if (!start || !end) return;
    if (start > end) {
      setError("Start date must be on or before end date.");
      return;
    }
    if (error === "Start date must be on or before end date.") setError(null);
  }, [start, end]);

  useEffect(() => {
    localStorage.setItem("bp_active_tab", active);
  }, [active]);

  useEffect(() => {
    localStorage.setItem("bp_live_refresh_enabled", liveRefreshEnabled ? "true" : "false");
  }, [liveRefreshEnabled]);

  useEffect(() => {
    if (!isValidDateRange(start, end)) return;
    localStorage.setItem("bp_range_start", start);
    localStorage.setItem("bp_range_end", end);
  }, [start, end]);

  useEffect(() => {
    if (!viewLinkMessage) return;
    const timeout = window.setTimeout(() => setViewLinkMessage(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [viewLinkMessage]);

  useEffect(() => {
    if (!isValidDateRange(start, end)) return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", active);
    params.set("start", start);
    params.set("end", end);
    params.set("live", liveRefreshEnabled ? "on" : "off");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}?${nextQuery}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, [active, start, end, liveRefreshEnabled]);

  useEffect(() => {
    const onPopState = () => {
      const { tab, start: nextStart, end: nextEnd, live } = readUrlViewState();
      setActive(normalizeTab(tab));
      if (live === "on") setLiveRefreshEnabled(true);
      if (live === "off") setLiveRefreshEnabled(false);
      if (nextStart && nextEnd && isValidDateRange(nextStart, nextEnd)) {
        setStart(nextStart);
        setEnd(nextEnd);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!authed || mustChangePassword || !liveRefreshEnabled) return;
    const interval = window.setInterval(() => {
      void refresh({ silent: true });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [authed, mustChangePassword, start, end, liveRefreshEnabled]);

  useEffect(() => {
    if (!authed) return;
    let awaitingSecondKey = false;
    let timeoutId: number | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      const key = event.key.toLowerCase();
      if (!awaitingSecondKey) {
        if (key !== "g") return;
        awaitingSecondKey = true;
        if (timeoutId) window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          awaitingSecondKey = false;
          timeoutId = null;
        }, 1200);
        return;
      }
      awaitingSecondKey = false;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (key === "d") setActive("dashboard");
      if (key === "a") setActive("ask");
      if (key === "s") setActive("sources");
      if (key === "r") setActive("recommendations");
      if (key === "p") setActive("reports");
      if (key === "t") setActive("settings");
      if (key === "l") void copyCurrentViewLink();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (event.key !== "[" && event.key !== "]") return;
      event.preventDefault();
      if (event.key === "]" && !canShiftForward(end)) return;
      const next = shiftDateRangeWithoutFuture(start, end, event.key === "[" ? "backward" : "forward");
      setStart(next.start);
      setEnd(next.end);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [authed, start, end]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!["1", "2", "3", "4"].includes(event.key)) return;
      event.preventDefault();
      const map: Record<string, number> = { "1": 7, "2": 30, "3": 90, "4": 365 };
      const next = dateRangeDaysAgo(map[event.key]);
      setStart(next.start);
      setEnd(next.end);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "k")) return;
      event.preventDefault();
      setActive("recommendations");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "p")) return;
      event.preventDefault();
      setActive("reports");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "s")) return;
      event.preventDefault();
      setActive("sources");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "a")) return;
      event.preventDefault();
      setActive("ask");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "t")) return;
      event.preventDefault();
      const next = alignRangeToToday(start, end);
      setStart(next.start);
      setEnd(next.end);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed, start, end]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "d")) return;
      event.preventDefault();
      setActive("dashboard");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "c" && (event.metaKey || event.ctrlKey))) return;
      event.preventDefault();
      if (hasInvalidRange) return;
      void copyCurrentViewLink();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed, hasInvalidRange]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "l")) return;
      event.preventDefault();
      setLiveRefreshEnabled((prev) => !prev);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key.toLowerCase() === "r")) return;
      event.preventDefault();
      if (hasInvalidRange) return;
      void refresh({ silent: true });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed, hasInvalidRange, start, end]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (!(event.shiftKey && event.key === "0")) return;
      event.preventDefault();
      resetViewState();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isTyping = tagName === "input" || tagName === "textarea" || tagName === "select" || target?.isContentEditable;
      if (isTyping) return;
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
      if (event.key === "Escape") setShowShortcuts(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [authed]);

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
        <button className="shortcut-btn" onClick={() => setShowShortcuts(true)}>Shortcuts</button>
        <p className="sidebar-hint">Shortcuts: g then d/a/s/r/p/t/l, [ ] shift, 1-4 presets</p>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{org?.name ?? "Demo Home Services Co."}</h1>
            <p>Revenue, leads, jobs, conversion, and marketing performance.</p>
            <p>{lastUpdatedAt ? `Last updated ${formatLastUpdated(lastUpdatedAt)}` : "Last updated pending"}</p>
            <p>Window: {windowDays} day{windowDays === 1 ? "" : "s"}</p>
            {viewLinkMessage ? <p>{viewLinkMessage}</p> : null}
            {hasInvalidRange ? <p>Please fix date range: start must be on or before end.</p> : null}
          </div>
          <div className="date-controls">
            <button onClick={() => { const next = shiftDateRangeWithoutFuture(start, end, "backward"); setStart(next.start); setEnd(next.end); }}>Back 1 Period</button>
            <button
              onClick={() => { const next = shiftDateRangeWithoutFuture(start, end, "forward"); setStart(next.start); setEnd(next.end); }}
              disabled={!forwardEnabled}
            >
              Forward 1 Period
            </button>
            <button className={activePreset === "7d" ? "range-active" : ""} disabled={activePreset === "7d"} onClick={() => { const next = dateRangeDaysAgo(7); setStart(next.start); setEnd(next.end); }}>7d</button>
            <button className={activePreset === "30d" ? "range-active" : ""} disabled={activePreset === "30d"} onClick={() => { const next = dateRangeDaysAgo(30); setStart(next.start); setEnd(next.end); }}>30d</button>
            <button className={activePreset === "90d" ? "range-active" : ""} disabled={activePreset === "90d"} onClick={() => { const next = dateRangeDaysAgo(90); setStart(next.start); setEnd(next.end); }}>90d</button>
            <button className={activePreset === "12m" ? "range-active" : ""} disabled={activePreset === "12m"} onClick={() => { const next = dateRangeDaysAgo(365); setStart(next.start); setEnd(next.end); }}>12m</button>
            <button disabled={todayAligned} onClick={() => { const next = alignRangeToToday(start, end); setStart(next.start); setEnd(next.end); }}>Today</button>
            <button disabled={activePreset === "30d"} onClick={() => { const next = dateRangeDaysAgo(30); setStart(next.start); setEnd(next.end); }}>Reset 30d</button>
            <button onClick={() => void copyCurrentViewLink()} disabled={hasInvalidRange}>Copy View Link</button>
            <input
              aria-label="Start date"
              type="date"
              value={start}
              max={dateDaysAgo(0)}
              onChange={(event) => setStart(clampDateToToday(event.target.value))}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const next = normalizeDateRangeForRefresh();
                setStart(next.start);
                setEnd(next.end);
                void refresh({ silent: true, startOverride: next.start, endOverride: next.end });
              }}
            />
            <input
              aria-label="End date"
              type="date"
              value={end}
              max={dateDaysAgo(0)}
              onChange={(event) => setEnd(clampDateToToday(event.target.value))}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const next = normalizeDateRangeForRefresh();
                setStart(next.start);
                setEnd(next.end);
                void refresh({ silent: true, startOverride: next.start, endOverride: next.end });
              }}
            />
            <button onClick={() => void refresh({ silent: true })} disabled={refreshing || hasInvalidRange}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button onClick={() => setLiveRefreshEnabled((prev) => !prev)}>
              Live Refresh: {liveRefreshEnabled ? "On" : "Off"}
            </button>
            <button onClick={resetViewState}>Reset View</button>
            {hasInvalidRange ? (
              <button
                onClick={() => {
                  const nextStart = end;
                  const nextEnd = start;
                  setStart(nextStart);
                  setEnd(nextEnd);
                }}
              >
                Swap Dates
              </button>
            ) : null}
            <button onClick={async () => {
              try { await logout(); } catch {}
              clearToken();
              localStorage.removeItem("bp_active_tab");
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
        {refreshWarning ? <div className="notice">{refreshWarning}</div> : null}
        {!liveRefreshEnabled ? (
          <div className="notice">
            Live refresh is off.
            <button className="align-start" onClick={() => setLiveRefreshEnabled(true)}>Turn On Live Refresh</button>
          </div>
        ) : null}
        {loading && !metrics ? <Loading /> : null}

        {metrics && active === "dashboard" ? <Dashboard metrics={metrics} uploads={uploads} alerts={alerts} recommendations={recommendations} onboarding={onboarding} onOpenSources={(dataset) => {
          if (dataset) localStorage.setItem("bp_sources_dataset_type", dataset);
          setActive("sources");
        }} onOpenAsk={(question) => { setAskSeed(question); setAskAutoRun(true); setActive("ask"); }} /> : null}
        {metrics && active === "ask" ? <AskAI start={start} end={end} seedQuestion={askSeed} autoRunSeed={askAutoRun} onAutoRunComplete={() => setAskAutoRun(false)} onRecommendationSaved={refresh} /> : null}
        {active === "sources" ? <DataSources uploads={uploads} onboarding={onboarding} refresh={refresh} /> : null}
        {active === "reports" ? <Reports reports={reports} start={start} end={end} refresh={refresh} /> : null}
        {active === "recommendations" ? <Recommendations recommendations={recommendations} onUseInAsk={(question) => { setAskSeed(question); setAskAutoRun(true); setActive("ask"); }} onStatusChanged={refresh} /> : null}
        {active === "settings" ? <Settings users={users} syncMessage={syncMessage} onSync={async () => {
          const result = await syncStripe(25);
          setSyncMessage(`Synced ${result.syncedCharges} new charges out of ${result.scannedCharges} scanned.`);
          await refresh();
        }} onUsersChanged={refresh} /> : null}
      </section>
      {showShortcuts ? (
        <div className="shortcuts-modal" onClick={() => setShowShortcuts(false)}>
          <section className="shortcuts-panel" onClick={(event) => event.stopPropagation()}>
            <h2>Keyboard Shortcuts</h2>
            <ul className="bullets">
              <li><code>g</code> then <code>d</code>: Dashboard</li>
              <li><code>g</code> then <code>a</code>: Ask AI</li>
              <li><code>g</code> then <code>s</code>: Data Sources</li>
              <li><code>g</code> then <code>r</code>: Recommendations</li>
              <li><code>g</code> then <code>p</code>: Reports</li>
              <li><code>g</code> then <code>t</code>: Settings</li>
              <li><code>g</code> then <code>l</code>: Copy current view link</li>
              <li><code>[</code> and <code>]</code>: Shift date window</li>
              <li><code>1</code>/<code>2</code>/<code>3</code>/<code>4</code>: 7d/30d/90d/12m presets</li>
              <li><code>Shift</code>+<code>R</code>: Refresh current view</li>
              <li><code>Shift</code>+<code>L</code>: Toggle live refresh</li>
              <li><code>Shift</code>+<code>T</code>: Align range to today</li>
              <li><code>Shift</code>+<code>D</code>: Open dashboard</li>
              <li><code>Shift</code>+<code>A</code>: Open Ask AI</li>
              <li><code>Shift</code>+<code>S</code>: Open Data Sources</li>
              <li><code>Shift</code>+<code>P</code>: Open Reports</li>
              <li><code>Shift</code>+<code>K</code>: Open Recommendations</li>
              <li><code>Shift</code>+<code>0</code>: Reset view defaults</li>
              <li><code>Ctrl/Cmd</code>+<code>Shift</code>+<code>C</code>: Copy view link</li>
              <li><code>?</code>: Toggle this help</li>
              <li><code>Esc</code>: Close this help</li>
            </ul>
            <button
              className="align-start"
              onClick={async () => {
                const text = [
                  "g then d: Dashboard",
                  "g then a: Ask AI",
                  "g then s: Data Sources",
                  "g then r: Recommendations",
                  "g then p: Reports",
                  "g then t: Settings",
                  "g then l: Copy current view link",
                  "[ and ]: Shift date window",
                  "1/2/3/4: 7d/30d/90d/12m presets",
                  "Shift+R: Refresh current view",
                  "Shift+L: Toggle live refresh",
                  "Shift+T: Align range to today",
                  "Shift+D: Open dashboard",
                  "Shift+A: Open Ask AI",
                  "Shift+S: Open Data Sources",
                  "Shift+P: Open Reports",
                  "Shift+K: Open Recommendations",
                  "Shift+0: Reset view defaults",
                  "Ctrl/Cmd+Shift+C: Copy view link",
                  "?: Toggle shortcuts help",
                  "Esc: Close shortcuts help"
                ].join("\n");
                await navigator.clipboard.writeText(text);
                setShortcutsCopied(true);
                window.setTimeout(() => setShortcutsCopied(false), 1800);
              }}
            >
              {shortcutsCopied ? "Copied" : "Copy Shortcuts"}
            </button>
            <button className="align-start" onClick={() => setShowShortcuts(false)}>Close</button>
          </section>
        </div>
      ) : null}
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
  onOpenSources,
  onOpenAsk
}: {
  metrics: MetricsResponse;
  uploads: FileUpload[];
  alerts: Array<{ title: string; severity: string; description: string }>;
  recommendations: Recommendation[];
  onboarding: OnboardingStatus | null;
  onOpenSources: (dataset?: DatasetType) => void;
  onOpenAsk: (question: string) => void;
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
  const freshnessRows = requiredDatasets.map((dataset) => {
    const upload = latestByDataset.get(dataset);
    const ageDays = upload ? Math.floor((Date.now() - Date.parse(upload.createdAt)) / (24 * 60 * 60 * 1000)) : null;
    const freshness = !upload ? "missing" : ageDays !== null && ageDays >= 14 ? "stale" : ageDays !== null && ageDays >= 7 ? "warning" : "fresh";
    return {
      dataset,
      status: upload?.status ?? "missing",
      updated: upload ? formatLastUpdated(upload.createdAt) : "never",
      freshness
    };
  });
  const staleOrMissingCount = freshnessRows.filter((row) => row.freshness === "stale" || row.freshness === "missing").length;
  const operationalRiskLevel =
    staleOrMissingCount >= 2 || metrics.qualityIssues.length >= 3 ? "high" :
    staleOrMissingCount >= 1 || metrics.qualityIssues.length >= 1 ? "medium" : "low";
  const staleDatasets = freshnessRows.filter((row) => row.freshness === "stale" || row.freshness === "missing").map((row) => row.dataset);

  function exportKpisCsv() {
    const lines = [
      "metric_name,metric_value,metric_formatted,delta_pct",
      ...metrics.cards.map((card) =>
        [
          escapeCsv(card.name),
          String(card.value),
          escapeCsv(card.formatted),
          card.deltaPct == null ? "" : String(card.deltaPct)
        ].join(",")
      )
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kpi-snapshot-${metrics.period.start}-to-${metrics.period.end}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportDashboardSummaryCsv() {
    const lines = [
      "section,key,value",
      `overview,operational_risk,${operationalRiskLevel}`,
      `overview,stale_or_missing_core_datasets,${staleOrMissingCount}`,
      `overview,quality_issues,${metrics.qualityIssues.length}`,
      `overview,data_readiness_pct,${setupScore}`,
      `overview,time_to_first_insight,${escapeCsv(timeToFirstInsight)}`,
      ...metrics.cards.map((card) => `kpi,${escapeCsv(card.name)},${escapeCsv(card.formatted)}`),
      ...freshnessRows.map((row) => `freshness,${row.dataset},${escapeCsv(`${row.status} (${row.updated})`)}`)
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dashboard-summary-${metrics.period.start}-to-${metrics.period.end}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportFreshnessCsv() {
    const lines = [
      "dataset,status,last_upload,freshness",
      ...freshnessRows.map((row) =>
        [row.dataset, row.status, escapeCsv(row.updated), row.freshness].join(",")
      )
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `data-freshness-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <section className={`notice risk-${operationalRiskLevel}`}>
        <strong>Operational risk: {operationalRiskLevel}</strong>
        <p>
          {staleOrMissingCount} stale or missing core datasets, {metrics.qualityIssues.length} quality issues currently affecting reliability.
        </p>
        {(staleOrMissingCount > 0 || metrics.qualityIssues.length > 0) ? (
          <button className="align-start" onClick={() => onOpenSources()}>Resolve In Data Sources</button>
        ) : null}
      </section>
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
        <div className="upload-row">
          <button className="primary" onClick={() => onOpenSources()}>Go To Data Sources</button>
          <button onClick={exportKpisCsv}>Export KPI CSV</button>
          <button onClick={exportDashboardSummaryCsv}>Export Dashboard Summary</button>
          {staleDatasets.length ? <button onClick={() => onOpenAsk(`Which actions should we take first to reduce risk from stale datasets: ${staleDatasets.join(", ")}?`)}>Investigate Staleness</button> : null}
        </div>
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
            <button className="align-start" onClick={() => onOpenAsk(`Analyze ${card.name}. Current value is ${card.formatted}. Explain main drivers, risks, and the first action we should take this week.`)}>
              Use In Ask AI
            </button>
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
        <Panel title="Data Freshness">
          <div className="upload-row">
            <span><strong>{staleOrMissingCount}</strong> datasets need attention</span>
            <span className="freshness-fresh">Fresh: &lt;7d</span>
            <span className="freshness-warning">Warning: 7-13d</span>
            <span className="freshness-stale">Stale: 14+d</span>
            <button onClick={exportFreshnessCsv}>Export CSV</button>
          </div>
          <div className="table freshness-table">
            <div className="table-head"><span>Dataset</span><span>Status</span><span>Last upload</span><span>Action</span></div>
            {freshnessRows.map((row) => (
              <div className="table-row" key={row.dataset}>
                <span>{row.dataset.replace("_", " ")}</span>
                <span className={`freshness-${row.freshness}`}>{row.status}</span>
                <span>{row.updated}</span>
                <button onClick={() => onOpenSources(row.dataset)}>Refresh Now</button>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section className="grid two">
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

function formatLastUpdated(iso: string) {
  const updated = new Date(iso);
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - updated.getTime()) / 1000));
  if (deltaSeconds < 5) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  return `${deltaHours}h ago`;
}

function escapeCsv(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

function AskAI({
  start,
  end,
  seedQuestion,
  autoRunSeed,
  onAutoRunComplete,
  onRecommendationSaved
}: {
  start: string;
  end: string;
  seedQuestion?: string;
  autoRunSeed?: boolean;
  onAutoRunComplete?: () => void;
  onRecommendationSaved?: () => Promise<void>;
}) {
  const [question, setQuestion] = useState(() => localStorage.getItem("bp_ask_question") ?? "Why did revenue change in this period?");
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem("bp_ask_history");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
    } catch {
      return [];
    }
  });
  const normalizedQuestion = question.trim();

  useEffect(() => {
    localStorage.setItem("bp_ask_question", question);
  }, [question]);

  useEffect(() => {
    localStorage.setItem("bp_ask_history", JSON.stringify(history.slice(0, 5)));
  }, [history]);

  useEffect(() => {
    if (!seedQuestion) return;
    setQuestion(seedQuestion);
  }, [seedQuestion]);

  async function submit(questionOverride?: string) {
    const requestQuestion = (questionOverride ?? normalizedQuestion).trim();
    if (requestQuestion.length < 3) return;
    setLoading(true);
    setError(null);
    try {
      setAnswer(await askAi(requestQuestion, start, end));
      setCopyMessage(null);
      setHistory((prev) => [requestQuestion, ...prev.filter((item) => item !== requestQuestion)].slice(0, 5));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to get AI answer right now.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!autoRunSeed || !seedQuestion || loading) return;
    void submit(seedQuestion).finally(() => {
      onAutoRunComplete?.();
    });
  }, [autoRunSeed, seedQuestion, loading, onAutoRunComplete]);

  async function copyAnswer() {
    if (!answer) return;
    const text = [
      answer.directAnswer,
      `Confidence: ${answer.confidence}`,
      `Date range: ${answer.dateRange.start} to ${answer.dateRange.end}`,
      `Recommended next action: ${answer.recommendedNextAction}`
    ].join("\n");
    await navigator.clipboard.writeText(text);
    setCopyMessage("Answer copied.");
  }

  async function saveAsRecommendation() {
    if (!answer) return;
    await createRecommendationFromAnswer({
      title: answer.recommendedNextAction,
      description: answer.directAnswer,
      priority: answer.confidence === "high" ? "high" : answer.confidence === "medium" ? "medium" : "low",
      expectedImpact: answer.supportingMetrics[0]?.value ?? "Operational clarity",
      confidence: answer.confidence,
      reason: "Saved from Ask AI"
    });
    setSaveMessage("Saved to recommendations.");
    await onRecommendationSaved?.();
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem("bp_ask_history");
  }

  const suggestions = ["Why did revenue drop last week?", "Which lead source gives us the best customers?", "Are we spending too much on ads?"];

  return (
    <div className="stack">
      <Panel title="Ask AI">
        <div className="ask-box">
          <textarea
            aria-label="Ask AI question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <button className="primary" onClick={() => void submit()} disabled={loading || normalizedQuestion.length < 3}>{loading ? "Analyzing" : "Ask"}</button>
        </div>
        <div className="chips">
          {suggestions.map((item) => <button key={item} onClick={() => setQuestion(item)}>{item}</button>)}
        </div>
        {history.length ? (
          <div className="chips">
            {history.map((item) => <button key={`history-${item}`} onClick={() => setQuestion(item)}>{item}</button>)}
            <button onClick={clearHistory}>Clear History</button>
          </div>
        ) : null}
        {error ? <div className="notice error">{error}</div> : null}
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
      {answer ? (
        <div className="upload-row">
          <button onClick={() => void copyAnswer()}>Copy Answer</button>
          <button onClick={() => void saveAsRecommendation()}>Save As Recommendation</button>
          <button onClick={() => { setAnswer(null); setCopyMessage(null); }}>Clear Answer</button>
          {copyMessage ? <span>{copyMessage}</span> : null}
          {saveMessage ? <span>{saveMessage}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function DataSources({
  uploads,
  onboarding,
  refresh
}: {
  uploads: FileUpload[];
  onboarding: OnboardingStatus | null;
  refresh: () => Promise<void>;
}) {
  const [datasetType, setDatasetType] = useState<DatasetType>(
    () => (localStorage.getItem("bp_sources_dataset_type") as DatasetType) ?? "jobs"
  );
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mappingDraft, setMappingDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [historyDatasetFilter, setHistoryDatasetFilter] = useState<DatasetType | "all">(
    () => (localStorage.getItem("bp_upload_history_dataset") as DatasetType | "all") ?? "all"
  );
  const [historyStatusFilter, setHistoryStatusFilter] = useState<FileUpload["status"] | "all">(
    () => (localStorage.getItem("bp_upload_history_status") as FileUpload["status"] | "all") ?? "all"
  );
  const [historySort, setHistorySort] = useState<"newest" | "oldest" | "rows_desc" | "rows_asc">(
    () => (localStorage.getItem("bp_upload_history_sort") as "newest" | "oldest" | "rows_desc" | "rows_asc") ?? "newest"
  );
  const requiredDatasets: DatasetType[] = ["jobs", "leads", "revenue", "marketing_spend"];
  const latestByDataset = new Map<DatasetType, FileUpload>();
  for (const upload of uploads) {
    if (!latestByDataset.has(upload.datasetType)) latestByDataset.set(upload.datasetType, upload);
  }
  const completed = requiredDatasets.filter((dataset) => latestByDataset.get(dataset)?.status === "processed").length;
  const remaining = requiredDatasets.length - completed;
  const setupScore = Math.round((completed / requiredDatasets.length) * 100);
  const filteredUploads = uploads.filter((upload) => {
    const datasetMatch = historyDatasetFilter === "all" || upload.datasetType === historyDatasetFilter;
    const statusMatch = historyStatusFilter === "all" || upload.status === historyStatusFilter;
    return datasetMatch && statusMatch;
  });
  const sortedUploads = [...filteredUploads].sort((a, b) => {
    if (historySort === "rows_desc") return b.rowCount - a.rowCount;
    if (historySort === "rows_asc") return a.rowCount - b.rowCount;
    const aTs = Date.parse(a.createdAt);
    const bTs = Date.parse(b.createdAt);
    return historySort === "oldest" ? aTs - bTs : bTs - aTs;
  });
  const stalePriorityDataset = requiredDatasets
    .map((dataset) => {
      const latest = latestByDataset.get(dataset);
      const ageDays = latest ? Math.floor((Date.now() - Date.parse(latest.createdAt)) / (24 * 60 * 60 * 1000)) : Number.POSITIVE_INFINITY;
      return { dataset, ageDays, missing: !latest };
    })
    .sort((a, b) => {
      if (a.missing && !b.missing) return -1;
      if (!a.missing && b.missing) return 1;
      return b.ageDays - a.ageDays;
    })[0]?.dataset ?? "jobs";

  useEffect(() => {
    localStorage.setItem("bp_upload_history_dataset", historyDatasetFilter);
    localStorage.setItem("bp_upload_history_status", historyStatusFilter);
    localStorage.setItem("bp_upload_history_sort", historySort);
  }, [historyDatasetFilter, historyStatusFilter, historySort]);

  useEffect(() => {
    localStorage.setItem("bp_sources_dataset_type", datasetType);
    setPendingFile(null);
    setPreview(null);
    setMappingDraft({});
    setMessage("");
  }, [datasetType]);

  function clearHistoryFilters() {
    setHistoryDatasetFilter("all");
    setHistoryStatusFilter("all");
    setHistorySort("newest");
  }

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

  function exportHistoryCsv() {
    const lines = [
      "filename,dataset_type,row_count,status,created_at",
      ...sortedUploads.map((upload) =>
        [
          escapeCsv(upload.filename),
          upload.datasetType,
          String(upload.rowCount),
          upload.status,
          upload.createdAt
        ].join(",")
      )
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `upload-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <Panel title="Onboarding Progress">
        <div className="stack">
          <p>Data readiness: <strong>{setupScore}%</strong></p>
          <p>Core datasets complete: <strong>{completed}/{requiredDatasets.length}</strong> ({remaining} remaining)</p>
          <p>Time to first insight: <strong>{formatTimeToFirstInsight(onboarding?.timeToFirstInsightSeconds ?? null, onboarding?.firstUploadAt ?? null)}</strong></p>
          <button className="align-start" onClick={() => setDatasetType(stalePriorityDataset)}>Refresh Stale Dataset</button>
          <div className="table">
            <div className="table-head"><span>Dataset</span><span>Status</span></div>
            {requiredDatasets.map((dataset) => {
              const row = latestByDataset.get(dataset);
              return (
                <div className="table-row" key={dataset}>
                  <span>{dataset.replace("_", " ")}</span>
                  <span>{row?.status === "processed" ? "complete" : row ? row.status : "missing"}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
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
        <div className="upload-row">
          <select value={historyDatasetFilter} onChange={(event) => setHistoryDatasetFilter(event.target.value as DatasetType | "all")}>
            <option value="all">All Datasets</option>
            {datasetTypes.map((type) => <option key={`history-${type.value}`} value={type.value}>{type.label}</option>)}
          </select>
          <select value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value as FileUpload["status"] | "all")}>
            <option value="all">All Statuses</option>
            <option value="processed">Processed</option>
            <option value="mapped">Mapped</option>
            <option value="failed">Failed</option>
          </select>
          <select value={historySort} onChange={(event) => setHistorySort(event.target.value as "newest" | "oldest" | "rows_desc" | "rows_asc")}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="rows_desc">Rows high to low</option>
            <option value="rows_asc">Rows low to high</option>
          </select>
          <button onClick={clearHistoryFilters}>Clear Filters</button>
          <button onClick={exportHistoryCsv} disabled={!sortedUploads.length}>Export CSV</button>
          <span>{filteredUploads.length} of {uploads.length} shown</span>
        </div>
        <div className="table">
          <div className="table-head"><span>File</span><span>Dataset</span><span>Rows</span><span>Status</span></div>
          {sortedUploads.map((upload) => (
            <div className="table-row" key={upload.id}>
              <span>{upload.filename}</span>
              <span>{upload.datasetType}</span>
              <span>{upload.rowCount}</span>
              <span>{upload.status}</span>
            </div>
          ))}
          {!filteredUploads.length ? <Empty text="No uploads match this filter." /> : null}
        </div>
      </Panel>
    </div>
  );
}

function Reports({ reports, start, end, refresh }: { reports: Report[]; start: string; end: string; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(() => localStorage.getItem("bp_reports_query") ?? "");
  const [sort, setSort] = useState<"newest" | "oldest">(
    () => (localStorage.getItem("bp_reports_sort") as "newest" | "oldest") ?? "newest"
  );
  const filtered = reports.filter((report) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return report.title.toLowerCase().includes(q) || report.summary.toLowerCase().includes(q) || report.reportType.toLowerCase().includes(q);
  });
  const sorted = [...filtered].sort((a, b) => {
    const aTs = Date.parse(a.createdAt);
    const bTs = Date.parse(b.createdAt);
    return sort === "oldest" ? aTs - bTs : bTs - aTs;
  });

  useEffect(() => {
    localStorage.setItem("bp_reports_query", query);
    localStorage.setItem("bp_reports_sort", sort);
  }, [query, sort]);

  function clearReportFilters() {
    setQuery("");
    setSort("newest");
  }

  function exportReportsCsv() {
    const lines = [
      "id,report_type,title,summary,created_at",
      ...sorted.map((report) => [
        report.id,
        report.reportType,
        escapeCsv(report.title),
        escapeCsv(report.summary),
        report.createdAt
      ].join(","))
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `reports-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
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
      <div className="upload-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reports" />
        <select value={sort} onChange={(event) => setSort(event.target.value as "newest" | "oldest")}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        <button onClick={clearReportFilters}>Clear Filters</button>
        <button onClick={exportReportsCsv} disabled={!sorted.length}>Export CSV</button>
        <span>{sorted.length} of {reports.length} shown</span>
      </div>
      {sorted.map((report) => (
        <section className="report" key={report.id}>
          <span className="eyebrow">{report.reportType}</span>
          <h2>{report.title}</h2>
          <p>{report.summary}</p>
          <ul className="bullets">{report.content.metricChanges.slice(0, 6).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ))}
      {!sorted.length ? <Empty text={reports.length ? "No reports match this filter." : "No generated reports yet."} /> : null}
    </div>
  );
}

function Recommendations({
  recommendations,
  onUseInAsk,
  onStatusChanged
}: {
  recommendations: Recommendation[];
  onUseInAsk: (question: string) => void;
  onStatusChanged: () => Promise<void>;
}) {
  const [priorityFilter, setPriorityFilter] = useState<"all" | "high" | "medium" | "low">(
    () => (localStorage.getItem("bp_recommendations_priority") as "all" | "high" | "medium" | "low") ?? "all"
  );
  const [statusFilter, setStatusFilter] = useState<"all" | "new" | "accepted" | "rejected" | "completed" | "dismissed">(
    () => (localStorage.getItem("bp_recommendations_status") as "all" | "new" | "accepted" | "rejected" | "completed" | "dismissed") ?? "all"
  );
  const [actionableOnly, setActionableOnly] = useState(() => localStorage.getItem("bp_recommendations_actionable_only") === "true");
  const [sortBy, setSortBy] = useState<"updated_desc" | "updated_asc" | "priority_desc" | "priority_asc">(
    () => (localStorage.getItem("bp_recommendations_sort") as "updated_desc" | "updated_asc" | "priority_desc" | "priority_asc") ?? "updated_desc"
  );
  const [query, setQuery] = useState(() => localStorage.getItem("bp_recommendations_query") ?? "");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const filtered = recommendations.filter((rec) => {
    const byPriority = priorityFilter === "all" || rec.priority === priorityFilter;
    const byStatus = statusFilter === "all" || rec.status === statusFilter;
    const byActionable = !actionableOnly || rec.status === "new" || rec.status === "accepted";
    const q = query.trim().toLowerCase();
    const byQuery = !q || rec.title.toLowerCase().includes(q) || rec.description.toLowerCase().includes(q) || rec.expectedImpact.toLowerCase().includes(q);
    return byPriority && byStatus && byActionable && byQuery;
  });
  const statusCounts = recommendations.reduce<Record<string, number>>((acc, rec) => {
    acc[rec.status] = (acc[rec.status] ?? 0) + 1;
    return acc;
  }, {});
  const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "updated_desc") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (sortBy === "updated_asc") return Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
    if (sortBy === "priority_desc") return (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0);
    return (priorityRank[a.priority] ?? 0) - (priorityRank[b.priority] ?? 0);
  });
  const bulkAcceptCount = sorted.filter((rec) => rec.status !== "accepted").length;
  const bulkCompleteCount = sorted.filter((rec) => rec.status !== "completed").length;
  const bulkDismissCount = sorted.filter((rec) => rec.status !== "dismissed").length;

  useEffect(() => {
    localStorage.setItem("bp_recommendations_priority", priorityFilter);
    localStorage.setItem("bp_recommendations_status", statusFilter);
    localStorage.setItem("bp_recommendations_actionable_only", actionableOnly ? "true" : "false");
    localStorage.setItem("bp_recommendations_sort", sortBy);
    localStorage.setItem("bp_recommendations_query", query);
  }, [priorityFilter, statusFilter, actionableOnly, sortBy, query]);

  useEffect(() => {
    if (!actionMessage) return;
    const timer = window.setTimeout(() => setActionMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [actionMessage]);

  function clearRecommendationFilters() {
    setPriorityFilter("all");
    setStatusFilter("all");
    setActionableOnly(false);
    setSortBy("updated_desc");
    setQuery("");
  }

  async function bulkUpdateFiltered(status: "accepted" | "dismissed" | "completed") {
    const targets = sorted.filter((rec) => rec.status !== status);
    if (!targets.length) return;
    const confirmed = window.confirm(`Update ${targets.length} filtered recommendations to "${status}"?`);
    if (!confirmed) return;
    try {
      await Promise.all(targets.map((rec) => updateRecommendationStatus(rec.id, status)));
      await onStatusChanged();
      setActionMessage(`Updated ${targets.length} recommendations to "${status}".`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Failed to update recommendations.");
    }
  }

  function exportRecommendationsCsv() {
    const lines = [
      "id,title,priority,description,expected_impact",
      ...filtered.map((rec) =>
        [rec.id, escapeCsv(rec.title), rec.priority, escapeCsv(rec.description), escapeCsv(rec.expectedImpact)].join(",")
      )
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `recommendations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel title="Prioritized Actions">
      <div className="upload-row">
        <button className={statusFilter === "new" ? "range-active" : ""} onClick={() => setStatusFilter("new")}>New: {statusCounts.new ?? 0}</button>
        <button className={statusFilter === "accepted" ? "range-active" : ""} onClick={() => setStatusFilter("accepted")}>Accepted: {statusCounts.accepted ?? 0}</button>
        <button className={statusFilter === "completed" ? "range-active" : ""} onClick={() => setStatusFilter("completed")}>Completed: {statusCounts.completed ?? 0}</button>
        <button className={statusFilter === "dismissed" ? "range-active" : ""} onClick={() => setStatusFilter("dismissed")}>Dismissed: {statusCounts.dismissed ?? 0}</button>
        <button className={statusFilter === "rejected" ? "range-active" : ""} onClick={() => setStatusFilter("rejected")}>Rejected: {statusCounts.rejected ?? 0}</button>
        <button className={statusFilter === "all" ? "range-active" : ""} onClick={() => setStatusFilter("all")}>All</button>
      </div>
      {actionMessage ? <div className="notice">{actionMessage}</div> : null}
      <div className="upload-row">
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as "all" | "high" | "medium" | "low")}>
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "new" | "accepted" | "rejected" | "completed" | "dismissed")}>
          <option value="all">All statuses</option>
          <option value="new">New</option>
          <option value="accepted">Accepted</option>
          <option value="dismissed">Dismissed</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </select>
        <label className="upload-row">
          <input type="checkbox" checked={actionableOnly} onChange={(event) => setActionableOnly(event.target.checked)} />
          Actionable only
        </label>
        <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "updated_desc" | "updated_asc" | "priority_desc" | "priority_asc")}>
          <option value="updated_desc">Recently updated</option>
          <option value="updated_asc">Oldest updated</option>
          <option value="priority_desc">Priority high to low</option>
          <option value="priority_asc">Priority low to high</option>
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recommendations" />
        <button onClick={clearRecommendationFilters}>Clear Filters</button>
        <button onClick={() => void bulkUpdateFiltered("accepted")} disabled={!bulkAcceptCount}>Mark Filtered Accepted ({bulkAcceptCount})</button>
        <button onClick={() => void bulkUpdateFiltered("completed")} disabled={!bulkCompleteCount}>Mark Filtered Completed ({bulkCompleteCount})</button>
        <button onClick={() => void bulkUpdateFiltered("dismissed")} disabled={!bulkDismissCount}>Mark Filtered Dismissed ({bulkDismissCount})</button>
        <button onClick={exportRecommendationsCsv} disabled={!filtered.length}>Export CSV</button>
        <span>{filtered.length} of {recommendations.length} shown</span>
      </div>
      <div className="list">
        {sorted.map((rec) => (
          <div key={rec.id} className="stack">
            <StatusItem title={rec.title} meta={rec.priority} body={`${rec.description} Expected impact: ${rec.expectedImpact}`} />
            <span>Last updated: {formatLastUpdated(rec.updatedAt)}</span>
            <button className="align-start" onClick={() => onUseInAsk(`How should we execute this recommendation first: ${rec.title}? Context: ${rec.description}. Expected impact: ${rec.expectedImpact}.`)}>
              Use In Ask AI
            </button>
            <div className="upload-row">
              <span>Status: {rec.status}</span>
              <select
                value={rec.status}
                onChange={async (event) => {
                  try {
                    const nextStatus = event.target.value as "new" | "accepted" | "rejected" | "completed" | "dismissed";
                    await updateRecommendationStatus(rec.id, nextStatus);
                    await onStatusChanged();
                    setActionMessage(`Updated "${rec.title}" to "${nextStatus}".`);
                  } catch (error) {
                    setActionMessage(error instanceof Error ? error.message : "Failed to update recommendation.");
                  }
                }}
              >
                <option value="new">New</option>
                <option value="accepted">Accepted</option>
                <option value="dismissed">Dismissed</option>
                <option value="completed">Completed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
        ))}
        {!filtered.length ? <Empty text="No recommendations match this filter." /> : null}
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
  const [userQuery, setUserQuery] = useState(() => localStorage.getItem("bp_users_query") ?? "");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">(
    () => (localStorage.getItem("bp_users_status_filter") as "all" | "active" | "disabled") ?? "all"
  );
  const roleCounts = users.reduce<Record<string, number>>((acc, user) => {
    acc[user.role] = (acc[user.role] ?? 0) + 1;
    return acc;
  }, {});
  const filteredUsers = users.filter((user) => {
    const q = userQuery.trim().toLowerCase();
    const queryMatch = !q || user.email.toLowerCase().includes(q);
    const statusMatch = statusFilter === "all" || (statusFilter === "active" ? !user.disabled : user.disabled);
    return queryMatch && statusMatch;
  });

  useEffect(() => {
    localStorage.setItem("bp_users_query", userQuery);
    localStorage.setItem("bp_users_status_filter", statusFilter);
  }, [userQuery, statusFilter]);

  function clearUserFilters() {
    setUserQuery("");
    setStatusFilter("all");
  }

  function exportUsersCsv() {
    const lines = [
      "user_id,email,role,status",
      ...filteredUsers.map((user) => [user.userId, escapeCsv(user.email), user.role, user.disabled ? "disabled" : "active"].join(","))
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function resetLocalPreferences() {
    const keys = [
      "bp_active_tab",
      "bp_range_start",
      "bp_range_end",
      "bp_upload_history_dataset",
      "bp_upload_history_status",
      "bp_upload_history_sort",
      "bp_reports_query",
      "bp_reports_sort",
      "bp_users_query",
      "bp_users_status_filter",
      "bp_ask_question"
    ];
    for (const key of keys) localStorage.removeItem(key);
    window.location.reload();
  }
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
          <p>Owners: {roleCounts.owner ?? 0} | Admins: {roleCounts.admin ?? 0} | Viewers: {roleCounts.viewer ?? 0}</p>
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
          <div className="upload-row">
            <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search users by email" />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "disabled")}>
              <option value="all">All statuses</option>
              <option value="active">Active only</option>
              <option value="disabled">Disabled only</option>
            </select>
            <button onClick={clearUserFilters}>Clear Filters</button>
            <button onClick={exportUsersCsv} disabled={!filteredUsers.length}>Export CSV</button>
            <span>{filteredUsers.length} of {users.length} shown</span>
          </div>
          <div className="table">
            <div className="table-head"><span>Email</span><span>Role</span><span>Status</span><span>Action</span></div>
            {filteredUsers.map((user) => (
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
            {!filteredUsers.length ? <Empty text="No users match this filter." /> : null}
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
      <Panel title="Local Preferences">
        <div className="stack">
          <p>Reset saved filters, date ranges, and Ask AI draft for this browser session.</p>
          <button className="align-start" onClick={resetLocalPreferences}>Reset Local Preferences</button>
        </div>
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

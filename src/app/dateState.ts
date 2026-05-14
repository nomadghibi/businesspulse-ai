export function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isValidDateRange(start: string, end: string) {
  const today = dateDaysAgo(0);
  return isIsoDate(start) && isIsoDate(end) && start <= end && start <= today && end <= today;
}

export function clampDateToToday(value: string) {
  if (!isIsoDate(value)) return value;
  const today = dateDaysAgo(0);
  return value > today ? today : value;
}

export function readUrlViewState() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  const start = params.get("start");
  const end = params.get("end");
  const live = params.get("live");
  return { tab, start, end, live };
}

export function initialDateRange() {
  const { start: startParam, end: endParam } = readUrlViewState();
  if (startParam && endParam && isValidDateRange(startParam, endParam)) {
    return { start: startParam, end: endParam };
  }
  const startSaved = localStorage.getItem("bp_range_start");
  const endSaved = localStorage.getItem("bp_range_end");
  if (startSaved && endSaved) return { start: startSaved, end: endSaved };
  return { start: dateDaysAgo(29), end: dateDaysAgo(0) };
}

export function dateRangeDaysAgo(days: number) {
  return { start: dateDaysAgo(days - 1), end: dateDaysAgo(0) };
}

export function shiftDateRange(start: string, end: string, direction: "backward" | "forward") {
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

export function alignRangeToToday(start: string, end: string) {
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

export function shiftDateRangeWithoutFuture(start: string, end: string, direction: "backward" | "forward") {
  const next = shiftDateRange(start, end, direction);
  if (direction === "backward") return next;
  const today = dateDaysAgo(0);
  if (next.end <= today) return next;
  return alignRangeToToday(start, end);
}

export function dateWindowDays(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1);
}

export function canShiftForward(end: string) {
  return end < dateDaysAgo(0);
}

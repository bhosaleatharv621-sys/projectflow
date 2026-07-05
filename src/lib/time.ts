// Core business logic and time helpers (brief Section 10 — implement exactly).
//
// Timezone rule: everything uses the device's LOCAL timezone. A cycle belongs
// to the local calendar day it STARTED on (so a session started 11:58pm and
// ended 12:05am counts entirely toward the start day — no confusing split).

import type { Project, TimeSession } from "./types";

// --- Formatting -------------------------------------------------------------

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Seconds -> "HH:MM:SS" (hours can exceed 99). */
export function secsToClock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

/** Seconds -> "Xh Ym" (compact). */
export function secsToHM(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Seconds -> decimal hours. */
export function secsToHours(total: number): number {
  return Math.max(0, total) / 3600;
}

/** A local-timezone date key, YYYY-MM-DD. */
export function localDateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today's local date key. */
export function todayKey(): string {
  return localDateKey(new Date());
}

/** Local midnight of today, as a Date. */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// --- Range filters (Today / Week / Month / Year / All) ----------------------

export type RangeKey = "today" | "week" | "month" | "year" | "all";

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  week: "Week",
  month: "Month",
  year: "Year",
  all: "All",
};

/**
 * Calendar-based lower bound for a range in the device's local timezone.
 * null = unbounded ("All"). Week starts on Monday.
 */
export function rangeStart(range: RangeKey, now: Date = new Date()): Date | null {
  const day = startOfToday(now);
  switch (range) {
    case "today":
      return day;
    case "week": {
      const dow = (day.getDay() + 6) % 7; // Mon=0 .. Sun=6
      day.setDate(day.getDate() - dow);
      return day;
    }
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    case "year":
      return new Date(now.getFullYear(), 0, 1);
    case "all":
      return null;
  }
}

/** "9:12 AM" style local time from an ISO timestamp. */
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

// --- Live elapsed for a running cycle --------------------------------------

/** elapsed = now - session.start_time  (client-side, never stored per-tick). */
export function liveElapsedSeconds(session: TimeSession, now: number = Date.now()): number {
  if (session.end_time) return session.duration_seconds ?? 0;
  return Math.max(0, Math.floor((now - new Date(session.start_time).getTime()) / 1000));
}

/** Does this session's start_time fall on the given local day? */
export function sessionStartedOn(session: TimeSession, dayKey: string): boolean {
  return localDateKey(new Date(session.start_time)) === dayKey;
}

// --- Aggregate metrics ------------------------------------------------------

/**
 * Total time spent for a project across all sessions ever, plus the live
 * elapsed time if a session is currently open.
 */
export function totalSpentSeconds(sessions: TimeSession[], now: number = Date.now()): number {
  return sessions.reduce((sum, s) => sum + liveElapsedSeconds(s, now), 0);
}

/**
 * Today's contribution: sum of durations for sessions that STARTED today,
 * plus the live elapsed time of the open session if it started today.
 */
export function todayContributionSeconds(
  sessions: TimeSession[],
  dayKey: string = todayKey(),
  now: number = Date.now(),
): number {
  return sessions
    .filter((s) => sessionStartedOn(s, dayKey))
    .reduce((sum, s) => sum + liveElapsedSeconds(s, now), 0);
}

// --- Progress + pace --------------------------------------------------------

/**
 * % complete = totalSpent(hours) / target_hours. Allowed to exceed 100%
 * (callers cap the *bar fill* visually, not this number).
 */
export function percentComplete(totalSeconds: number, targetHours: number): number {
  if (!targetHours || targetHours <= 0) return 0;
  return (secsToHours(totalSeconds) / targetHours) * 100;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Whole days between two dates (local). */
export function daysBetween(from: string | Date, to: string | Date): number {
  const a = typeof from === "string" ? new Date(from) : from;
  const b = typeof to === "string" ? new Date(to) : to;
  const MS = 24 * 60 * 60 * 1000;
  return (b.getTime() - a.getTime()) / MS;
}

// --- Project health (worked-vs-target status buckets) ------------------------

export type HealthKey = "completed" | "not_started" | "in_progress" | "near_target" | "over_target";

export interface ProjectHealth {
  key: HealthKey;
  label: string;
  color: string; // hex accent used by badges/bars
}

/**
 * Health buckets from completion %:
 *   admin-marked completed wins; then 0% = Not started, 1–79% = In progress,
 *   80–99% = Near target, >= 100% = Over target.
 */
export function projectHealth(project: Project, totalSeconds: number): ProjectHealth {
  if (project.status === "completed") {
    return { key: "completed", label: "Completed", color: "#059669" };
  }
  const pct = percentComplete(totalSeconds, project.target_hours);
  if (pct <= 0) return { key: "not_started", label: "Not started", color: "#6b7280" };
  if (pct < 80) return { key: "in_progress", label: "In progress", color: "#4f46e5" };
  if (pct < 100) return { key: "near_target", label: "Near target", color: "#d97706" };
  return { key: "over_target", label: "Over target", color: "#dc2626" };
}

export type BurnTone = "green" | "amber" | "red" | "none";

export interface BurnStatus {
  tone: BurnTone;
  label: string; // "" when no deadline
  expectedProgress: number; // 0..1
}

/**
 * On-time / behind-schedule badge (brief Section 10).
 * Only meaningful when a deadline is set; otherwise tone "none" / empty label.
 *
 *   totalDays        = daysBetween(created_at, deadline)
 *   daysElapsed      = daysBetween(created_at, today)
 *   expectedProgress = clamp(daysElapsed / totalDays, 0, 1)
 *   onTrack          = percentComplete >= expectedProgress
 *
 * Colour: green = on track; amber = on track but close to deadline with a
 * shrinking gap; red = behind, or over the deadline while < 100% complete.
 */
export function burnStatus(project: Project, totalSeconds: number, now: Date = new Date()): BurnStatus {
  if (!project.deadline) {
    return { tone: "none", label: "", expectedProgress: 0 };
  }

  const totalDays = daysBetween(project.created_at, project.deadline);
  const daysElapsed = daysBetween(project.created_at, now);
  const pct = percentComplete(totalSeconds, project.target_hours) / 100; // 0..1
  const complete = pct >= 1;

  // Guard against a same-day / zero-length window.
  const expectedProgress = totalDays <= 0 ? (complete ? 1 : 1) : clamp(daysElapsed / totalDays, 0, 1);

  const pastDeadline = daysElapsed > totalDays;

  if (complete) {
    return { tone: "green", label: "Completed", expectedProgress };
  }

  if (pastDeadline) {
    // Past the deadline and not done yet.
    return { tone: "red", label: "Overdue", expectedProgress };
  }

  const onTrack = pct >= expectedProgress;
  if (!onTrack) {
    return { tone: "red", label: "Behind schedule", expectedProgress };
  }

  // On track — but flag "amber" when the buffer is thin and the deadline is near.
  const buffer = pct - expectedProgress; // how far ahead of pace, 0..1
  const deadlineNear = totalDays > 0 && daysElapsed / totalDays >= 0.75;
  if (deadlineNear && buffer < 0.1) {
    return { tone: "amber", label: "At risk", expectedProgress };
  }

  return { tone: "green", label: "On track", expectedProgress };
}

/**
 * A plain-language pace tip for Project Detail (no AI needed): projects the
 * finish date from the recent daily pace and compares to the deadline.
 */
export function paceTip(
  project: Project,
  totalSeconds: number,
  daysWorked: number,
): string | null {
  const remainingHours = Math.max(0, project.target_hours - secsToHours(totalSeconds));
  if (remainingHours <= 0) return "Target reached — nice work.";
  if (daysWorked <= 0) return null;

  const avgDailyHours = secsToHours(totalSeconds) / daysWorked;
  if (avgDailyHours <= 0) return null;

  const daysToFinish = Math.ceil(remainingHours / avgDailyHours);
  if (!project.deadline) {
    return `At your current pace (~${avgDailyHours.toFixed(1)}h/day) you'll finish in about ${daysToFinish} more day${daysToFinish === 1 ? "" : "s"}.`;
  }

  const daysLeft = Math.ceil(daysBetween(new Date(), project.deadline));
  if (daysToFinish <= daysLeft) {
    const early = daysLeft - daysToFinish;
    return `On pace to finish ~${early} day${early === 1 ? "" : "s"} before the deadline.`;
  }
  const over = daysToFinish - daysLeft;
  const extraPerDay = daysLeft > 0 ? (remainingHours / daysLeft - avgDailyHours) * 60 : 0;
  if (daysLeft > 0 && extraPerDay > 0) {
    return `Behind pace — you'll finish ~${over} day${over === 1 ? "" : "s"} late. Add ~${Math.round(extraPerDay)} min/day to hit the deadline.`;
  }
  return `Behind pace — at this rate you'll finish ~${over} day${over === 1 ? "" : "s"} after the deadline.`;
}

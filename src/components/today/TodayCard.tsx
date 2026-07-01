"use client";

import { useState } from "react";
import { Play, Pause, Square, X, ChevronDown, Loader2 } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { BurnBadge } from "@/components/ui/BurnBadge";
import {
  burnStatus,
  formatClockTime,
  liveElapsedSeconds,
  percentComplete,
  secsToClock,
  secsToHM,
  secsToHours,
  sessionStartedOn,
  todayContributionSeconds,
  todayKey,
  totalSpentSeconds,
} from "@/lib/time";
import type { Category, Project, TimeSession } from "@/lib/types";

export type CardState = "running" | "paused" | "idle";

export function TodayCard({
  project,
  category,
  sessions,
  now,
  state,
  busy,
  onStart,
  onPause,
  onStop,
  onRemove,
}: {
  project: Project;
  category: Category | null;
  sessions: TimeSession[]; // this project's sessions only
  now: number;
  state: CardState;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const day = todayKey();

  const today = todayContributionSeconds(sessions, day, now);
  const total = totalSpentSeconds(sessions, now);
  const pct = percentComplete(total, project.target_hours);
  const burn = burnStatus(project, total);

  const todaysCycles = sessions
    .filter((s) => sessionStartedOn(s, day))
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  const barColor = pct >= 100 ? "#059669" : burn.tone === "red" ? "#dc2626" : category?.color ?? "var(--brand)";

  return (
    <div
      className="card p-4 transition"
      style={{ boxShadow: state === "running" ? `0 0 0 2px ${category?.color ?? "#4f46e5"}` : undefined }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
            style={{ background: category?.color ?? "#888" }}
          >
            <CategoryIcon icon={category?.icon ?? "Folder"} size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold leading-tight">{project.name}</span>
              <span className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-xs font-medium muted">
                {project.project_number}
              </span>
              {state === "running" && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
                  <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-emerald-500" />
                  Recording
                </span>
              )}
            </div>
            <p className="muted mt-0.5 text-xs">{category?.name ?? "—"}</p>
          </div>
        </div>

        <button
          className="rounded-lg p-1.5 muted hover:bg-[var(--surface-2)]"
          onClick={onRemove}
          title="Remove from today"
          disabled={state === "running"}
        >
          <X size={16} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div>
          <span className="text-xs muted">Today </span>
          <span className={`font-mono text-lg font-semibold ${state === "running" ? "text-emerald-500" : ""}`}>
            {secsToClock(today)}
          </span>
        </div>
        <div className="muted text-sm">
          Total {secsToHours(total).toFixed(1)}h / {project.target_hours}h ·{" "}
          <span className="font-medium">{Math.round(pct)}%</span>
        </div>
        {project.deadline ? <BurnBadge status={burn} /> : null}
      </div>

      <div className="mt-2">
        <ProgressBar percent={pct} color={barColor} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          {state === "running" ? (
            <button className="btn btn-ghost" onClick={onPause} disabled={busy}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Pause size={15} />} Pause
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={onStart}
              disabled={busy}
              style={{ background: category?.color ?? undefined }}
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}{" "}
              {state === "paused" ? "Resume" : "Start"}
            </button>
          )}
          {state !== "idle" && (
            <button className="btn btn-ghost text-red-500" onClick={onStop} disabled={busy}>
              <Square size={14} /> Stop
            </button>
          )}
        </div>

        {todaysCycles.length > 0 && (
          <button
            className="inline-flex items-center gap-1 text-xs muted hover:text-brand"
            onClick={() => setExpanded((v) => !v)}
          >
            {todaysCycles.length} cycle{todaysCycles.length === 1 ? "" : "s"} today
            <ChevronDown size={14} className={`transition ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {expanded && todaysCycles.length > 0 && (
        <div className="mt-3 space-y-1 border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {todaysCycles.map((c) => {
            const dur = liveElapsedSeconds(c, now);
            const running = !c.end_time;
            return (
              <div key={c.id} className="flex items-center justify-between text-xs">
                <span className="muted">
                  {formatClockTime(c.start_time)} – {running ? "now" : formatClockTime(c.end_time!)}
                </span>
                <span className={`font-mono ${running ? "text-emerald-500" : ""}`}>{secsToHM(dur)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

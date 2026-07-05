"use client";

// Role-aware dashboard strip for the Today (landing) page.
// Every number here comes from data the caller is allowed to see: admin
// figures use org-wide aggregates (RLS lets the admin see everything);
// employee figures are computed from the employee's OWN bounded sessions.

import {
  Briefcase,
  CheckCircle2,
  Users,
  UserPlus,
  Clock,
  CalendarRange,
  CircleDot,
  Target,
  Flame,
  Play,
  Loader2,
} from "lucide-react";
import { percentComplete, secsToHM, formatClockTime } from "@/lib/time";
import type { Member, Project, TimeSession } from "@/lib/types";

function StatCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: "amber" | "red" | "green";
}) {
  const color =
    tone === "amber" ? "#d97706" : tone === "red" ? "#dc2626" : tone === "green" ? "#059669" : "var(--brand)";
  return (
    <div className="card flex items-center gap-3 p-3">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-lg font-bold leading-tight">{value}</p>
        <p className="muted truncate text-[11px]">{label}</p>
      </div>
    </div>
  );
}

export function AdminStats({
  projects,
  members,
  pendingCount,
  openSessions,
  orgTodaySeconds,
  orgWeekSeconds,
  lifetimeTotals,
}: {
  projects: Project[];
  members: Member[];
  pendingCount: number;
  openSessions: TimeSession[];
  orgTodaySeconds: number;
  orgWeekSeconds: number;
  lifetimeTotals: Map<string, number>;
}) {
  const activeProjects = projects.filter((p) => p.status !== "completed").length;
  const completedProjects = projects.filter((p) => p.status === "completed").length;
  const activeEmployees = members.filter((m) => m.role === "employee" && m.status === "active").length;

  let nearTarget = 0;
  let overTarget = 0;
  for (const p of projects) {
    if (p.status === "completed") continue;
    const pct = percentComplete(lifetimeTotals.get(p.id) ?? 0, p.target_hours);
    if (pct >= 100) overTarget++;
    else if (pct >= 80) nearTarget++;
  }

  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      <StatCard icon={<Briefcase size={17} />} label="Active projects" value={activeProjects} />
      <StatCard icon={<CheckCircle2 size={17} />} label="Completed projects" value={completedProjects} tone="green" />
      <StatCard icon={<Users size={17} />} label="Active employees" value={activeEmployees} />
      <StatCard
        icon={<UserPlus size={17} />}
        label="Pending access requests"
        value={pendingCount}
        tone={pendingCount > 0 ? "amber" : undefined}
      />
      <StatCard icon={<Clock size={17} />} label="Org hours today" value={secsToHM(orgTodaySeconds)} />
      <StatCard icon={<CalendarRange size={17} />} label="Org hours this week" value={secsToHM(orgWeekSeconds)} />
      <StatCard
        icon={<CircleDot size={17} />}
        label="Working right now"
        value={openSessions.length}
        tone={openSessions.length > 0 ? "green" : undefined}
      />
      <StatCard
        icon={overTarget > 0 ? <Flame size={17} /> : <Target size={17} />}
        label={`Near target ${nearTarget} · Over ${overTarget}`}
        value={nearTarget + overTarget}
        tone={overTarget > 0 ? "red" : nearTarget > 0 ? "amber" : undefined}
      />
    </div>
  );
}

export function EmployeeStats({
  myTodaySeconds,
  myWeekSeconds,
  runningProjectName,
  recentProjects,
  recentSessions,
  projectById,
  busyId,
  onQuickStart,
}: {
  myTodaySeconds: number;
  myWeekSeconds: number;
  runningProjectName: string | null;
  recentProjects: Project[]; // most recently worked, deduped
  recentSessions: TimeSession[]; // caller's own, newest first
  projectById: Map<string, Project>;
  busyId: string | null;
  onQuickStart: (projectId: string) => void;
}) {
  return (
    <div className="mb-5 space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <StatCard icon={<Clock size={17} />} label="My hours today" value={secsToHM(myTodaySeconds)} />
        <StatCard icon={<CalendarRange size={17} />} label="My hours this week" value={secsToHM(myWeekSeconds)} />
        <StatCard
          icon={<CircleDot size={17} />}
          label="Active timer"
          value={runningProjectName ?? "None"}
          tone={runningProjectName ? "green" : undefined}
        />
      </div>

      {recentProjects.length > 0 && (
        <div className="card p-3">
          <p className="muted mb-2 text-[11px] font-medium uppercase tracking-wide">Quick start</p>
          <div className="flex flex-wrap gap-1.5">
            {recentProjects.map((p) => (
              <button
                key={p.id}
                className="btn btn-ghost px-3 py-1.5 text-xs"
                onClick={() => onQuickStart(p.id)}
                disabled={busyId === p.id}
              >
                {busyId === p.id ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {recentSessions.length > 0 && (
        <div className="card p-3">
          <p className="muted mb-2 text-[11px] font-medium uppercase tracking-wide">My recent sessions</p>
          <div className="space-y-1">
            {recentSessions.slice(0, 5).map((s) => {
              const proj = projectById.get(s.project_id);
              return (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="muted min-w-0 truncate">
                    {proj?.name ?? "—"} ·{" "}
                    {new Date(s.start_time).toLocaleDateString(undefined, { day: "numeric", month: "short" })}{" "}
                    {formatClockTime(s.start_time)}
                  </span>
                  <span className="shrink-0 font-mono">{secsToHM(s.duration_seconds ?? 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

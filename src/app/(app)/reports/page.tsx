"use client";

// Reports. All numbers are aggregated in Postgres under the caller's RLS:
// an employee's report (and export) can never include the admin's time.
// The project completion table renders for the admin only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RangeFilter } from "@/components/ui/RangeFilter";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Avatar } from "@/components/ui/Avatar";
import { useMember } from "@/components/MemberProvider";
import {
  getProjectTotals,
  getRangeProjectTotals,
  getRangeUserTotals,
  listCategories,
  listMembers,
  listProjects,
  listSessionsSince,
} from "@/lib/api";
import { downloadText, sessionsToCsv } from "@/lib/export";
import {
  formatClockTime,
  localDateKey,
  percentComplete,
  rangeStart,
  secsToHM,
  secsToHours,
  todayKey,
  type RangeKey,
} from "@/lib/time";
import type { Category, Member, Project, TimeSession, UserTotal } from "@/lib/types";

type RangeSel = RangeKey | "custom";

// Bounded fetch for the date-wise/notes sections and export preview.
const SESSION_FETCH_LIMIT = 2000;

export default function ReportsPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";

  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [rangeTotals, setRangeTotals] = useState<Map<string, number>>(new Map());
  const [userTotals, setUserTotals] = useState<UserTotal[]>([]);
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [lifetimeTotals, setLifetimeTotals] = useState<Map<string, number>>(new Map());
  const [range, setRange] = useState<RangeSel>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Effective [from, to) bounds for the selected range (local timezone).
  const bounds = useMemo((): { fromIso: string | null; toIso: string | null } => {
    if (range === "custom") {
      const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
      const toExclusive = customTo ? new Date(`${customTo}T00:00:00`) : null;
      if (toExclusive) toExclusive.setDate(toExclusive.getDate() + 1); // include the To day
      return {
        fromIso: from ? from.toISOString() : null,
        toIso: toExclusive ? toExclusive.toISOString() : null,
      };
    }
    return { fromIso: rangeStart(range)?.toISOString() ?? null, toIso: null };
  }, [range, customFrom, customTo]);

  const reload = useCallback(async () => {
    const { fromIso, toIso } = bounds;
    const [p, c, m, rt, ut, sess, lt] = await Promise.all([
      listProjects(),
      listCategories(),
      listMembers(),
      getRangeProjectTotals(fromIso, toIso),
      getRangeUserTotals(fromIso, toIso),
      listSessionsSince(fromIso, SESSION_FETCH_LIMIT, toIso),
      isAdmin ? getProjectTotals() : Promise.resolve(new Map<string, number>()),
    ]);
    setProjects(p);
    setCategories(c);
    setMembers(m);
    setRangeTotals(rt);
    setUserTotals(ut);
    setSessions(sess.filter((s) => s.end_time));
    setLifetimeTotals(lt);
    setLoading(false);
  }, [bounds, isAdmin]);

  useEffect(() => {
    reload();
  }, [reload]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const byProject = useMemo(
    () =>
      [...rangeTotals.entries()]
        .map(([id, secs]) => ({ project: projById.get(id), secs }))
        .filter((x): x is { project: Project; secs: number } => !!x.project && x.secs > 0)
        .sort((a, b) => b.secs - a.secs),
    [rangeTotals, projById],
  );

  const byPerson = useMemo(
    () => userTotals.slice().sort((a, b) => b.total_seconds - a.total_seconds),
    [userTotals],
  );

  // Date-wise breakdown from the bounded session fetch, local-day buckets.
  const byDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sessions) {
      const key = localDateKey(new Date(s.start_time));
      map.set(key, (map.get(key) ?? 0) + (s.duration_seconds ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sessions]);

  const withNotes = useMemo(() => sessions.filter((s) => s.notes), [sessions]);

  const totalSecs = byProject.reduce((sum, x) => sum + x.secs, 0);
  const totalSessions = userTotals.reduce((sum, t) => sum + t.session_count, 0);
  const maxProjectSecs = byProject[0]?.secs ?? 1;
  const maxPersonSecs = byPerson[0]?.total_seconds ?? 1;
  const maxDaySecs = Math.max(1, ...byDate.map(([, secs]) => secs));

  const truncated = sessions.length >= SESSION_FETCH_LIMIT;

  async function exportCsv() {
    setExporting(true);
    try {
      const { fromIso, toIso } = bounds;
      const rows = await listSessionsSince(fromIso, 10000, toIso);
      downloadText(
        `projectflow-report-${range}-${todayKey()}.csv`,
        // Target hours column is included for the admin only.
        sessionsToCsv(rows, projects, categories, members, { includeTargets: isAdmin }),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Where the organization's time went."
        right={
          <button className="btn btn-ghost" onClick={exportCsv} disabled={exporting || loading}>
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Export CSV
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangeFilter value={range === "custom" ? null : range} onChange={(r) => setRange(r)} />
        <button
          onClick={() => setRange("custom")}
          className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
            range === "custom" ? "bg-[var(--surface)] shadow" : "muted bg-[var(--surface-2)]"
          }`}
        >
          Custom
        </button>
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="muted text-xs">From</label>
            <input
              type="date"
              className="input max-w-[150px] py-1.5"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <label className="muted text-xs">To</label>
            <input
              type="date"
              className="input max-w-[150px] py-1.5"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin muted" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="card p-3">
              <p className="muted text-[11px]">Total time</p>
              <p className="font-mono text-lg font-bold">{secsToHM(totalSecs)}</p>
            </div>
            <div className="card p-3">
              <p className="muted text-[11px]">People active</p>
              <p className="text-lg font-bold">{byPerson.filter((t) => t.total_seconds > 0).length}</p>
            </div>
            <div className="card p-3">
              <p className="muted text-[11px]">Sessions</p>
              <p className="text-lg font-bold">{totalSessions}</p>
            </div>
            <div className="card p-3">
              <p className="muted text-[11px]">Projects worked</p>
              <p className="text-lg font-bold">{byProject.length}</p>
            </div>
          </div>

          {/* Time by project */}
          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">Time by project</p>
            {byProject.length === 0 ? (
              <p className="muted text-sm">No completed sessions in this period.</p>
            ) : (
              <div className="space-y-2.5">
                {byProject.map(({ project, secs }) => {
                  const cat = catById.get(project.category_id);
                  return (
                    <div key={project.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="truncate">
                          {project.project_number} — {project.name}
                        </span>
                        <span className="muted ml-2 shrink-0 font-mono">{secsToHours(secs).toFixed(1)}h</span>
                      </div>
                      <div
                        className="h-2.5 w-full overflow-hidden rounded-full"
                        style={{ background: "var(--surface-2)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(secs / maxProjectSecs) * 100}%`,
                            background: cat?.color ?? "var(--brand)",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Time by employee */}
          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">Time by employee</p>
            {byPerson.filter((t) => t.total_seconds > 0).length === 0 ? (
              <p className="muted text-sm">Nobody logged time in this period.</p>
            ) : (
              <div className="space-y-2.5">
                {byPerson
                  .filter((t) => t.total_seconds > 0)
                  .map((t) => {
                    const person = memberById.get(t.user_id);
                    return (
                      <div key={t.user_id}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar name={person?.display_name ?? "?"} size={20} />
                            <span className="truncate">{person?.display_name ?? "—"}</span>
                          </span>
                          <span className="muted shrink-0 font-mono text-xs">
                            {secsToHM(t.total_seconds)} · {t.session_count} session
                            {t.session_count === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div
                          className="h-2.5 w-full overflow-hidden rounded-full"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(t.total_seconds / maxPersonSecs) * 100}%`, background: "var(--brand)" }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Date-wise breakdown */}
          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">
              Time by date
              {truncated && (
                <span className="muted ml-2 text-xs font-normal">
                  (latest {SESSION_FETCH_LIMIT} sessions — narrow the range for exact daily figures)
                </span>
              )}
            </p>
            {byDate.length === 0 ? (
              <p className="muted text-sm">No completed sessions in this period.</p>
            ) : (
              <div className="space-y-1.5">
                {byDate.slice(0, 31).map(([day, secs]) => (
                  <div key={day} className="flex items-center gap-3 text-sm">
                    <span className="muted w-24 shrink-0 text-xs">
                      {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(secs / maxDaySecs) * 100}%`, background: "var(--brand)" }}
                      />
                    </div>
                    <span className="muted w-14 shrink-0 text-right font-mono text-xs">{secsToHM(secs)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Session notes report */}
          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">Session notes</p>
            {withNotes.length === 0 ? (
              <p className="muted text-sm">No notes recorded in this period.</p>
            ) : (
              <div className="space-y-2">
                {withNotes.slice(0, 50).map((s) => {
                  const person = memberById.get(s.user_id);
                  const proj = projById.get(s.project_id);
                  return (
                    <div key={s.id} className="rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate">
                          <span className="font-medium">{person?.display_name ?? "—"}</span>
                          <span className="muted">
                            {" "}
                            · {proj ? proj.name : "—"} ·{" "}
                            {new Date(s.start_time).toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                            })}{" "}
                            {formatClockTime(s.start_time)}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono muted text-xs">{secsToHM(s.duration_seconds ?? 0)}</span>
                      </div>
                      <p className="mt-0.5 text-xs italic">“{s.notes}”</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Project completion — ADMIN ONLY (worked / target / %). */}
          {isAdmin && (
            <div className="card p-4">
              <p className="mb-3 text-sm font-medium">Project completion (lifetime)</p>
              {projects.length === 0 ? (
                <p className="muted text-sm">No projects yet.</p>
              ) : (
                <div className="space-y-3">
                  {projects
                    .slice()
                    .sort(
                      (a, b) =>
                        percentComplete(lifetimeTotals.get(b.id) ?? 0, b.target_hours) -
                        percentComplete(lifetimeTotals.get(a.id) ?? 0, a.target_hours),
                    )
                    .map((p) => {
                      const total = lifetimeTotals.get(p.id) ?? 0;
                      const pct = percentComplete(total, p.target_hours);
                      const remaining = Math.max(0, p.target_hours - secsToHours(total));
                      const color = pct >= 100 ? "#059669" : pct >= 75 ? "#d97706" : "var(--brand)";
                      return (
                        <div key={p.id}>
                          <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-sm">
                            <span className="truncate font-medium">
                              {p.project_number} — {p.name}
                            </span>
                            <span className="muted shrink-0 font-mono text-xs">
                              {secsToHours(total).toFixed(1)}h / {p.target_hours}h · {remaining.toFixed(1)}h left ·{" "}
                              <b style={{ color: "var(--text)" }}>{Math.round(pct)}%</b>
                            </span>
                          </div>
                          <ProgressBar percent={pct} color={color} />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// Reports. All numbers are aggregated in Postgres under the caller's RLS:
// an employee's report can never include the admin's time. The project
// completion table (worked vs target vs %) renders for the admin only.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RangeFilter } from "@/components/ui/RangeFilter";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useMember } from "@/components/MemberProvider";
import {
  getProjectTotals,
  getRangeProjectTotals,
  listCategories,
  listMembers,
  listProjects,
  listSessionsSince,
} from "@/lib/api";
import { downloadText, sessionsToCsv } from "@/lib/export";
import {
  percentComplete,
  rangeStart,
  secsToHM,
  secsToHours,
  todayKey,
  type RangeKey,
} from "@/lib/time";
import type { Category, Project } from "@/lib/types";

export default function ReportsPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";

  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rangeTotals, setRangeTotals] = useState<Map<string, number>>(new Map());
  const [lifetimeTotals, setLifetimeTotals] = useState<Map<string, number>>(new Map());
  const [range, setRange] = useState<RangeKey>("today");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(async () => {
    const fromIso = rangeStart(range)?.toISOString() ?? null;
    const [p, c, rt, lt] = await Promise.all([
      listProjects(),
      listCategories(),
      getRangeProjectTotals(fromIso),
      isAdmin ? getProjectTotals() : Promise.resolve(new Map<string, number>()),
    ]);
    setProjects(p);
    setCategories(c);
    setRangeTotals(rt);
    setLifetimeTotals(lt);
    setLoading(false);
  }, [range, isAdmin]);

  useEffect(() => {
    reload();
  }, [reload]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const byProject = useMemo(
    () =>
      [...rangeTotals.entries()]
        .map(([id, secs]) => ({ project: projects.find((p) => p.id === id), secs }))
        .filter((x): x is { project: Project; secs: number } => !!x.project && x.secs > 0)
        .sort((a, b) => b.secs - a.secs),
    [rangeTotals, projects],
  );

  const totalSecs = byProject.reduce((sum, x) => sum + x.secs, 0);
  const maxSecs = byProject[0]?.secs ?? 1;

  async function exportCsv() {
    setExporting(true);
    try {
      // Fetch raw rows only at export time, bounded to the selected range.
      const fromIso = rangeStart(range)?.toISOString() ?? null;
      const [sessions, members] = await Promise.all([listSessionsSince(fromIso, 10000), listMembers()]);
      downloadText(
        `projectflow-${range}-${todayKey()}.csv`,
        sessionsToCsv(sessions, projects, categories, members),
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
          <button className="btn btn-ghost" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Export CSV
          </button>
        }
      />

      <div className="mb-4">
        <RangeFilter value={range} onChange={setRange} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin muted" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="card p-4">
            <p className="muted text-xs">Total worked in period</p>
            <p className="font-mono text-2xl font-bold">{secsToHM(totalSecs)}</p>
          </div>

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
                          style={{ width: `${(secs / maxSecs) * 100}%`, background: cat?.color ?? "var(--brand)" }}
                        />
                      </div>
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

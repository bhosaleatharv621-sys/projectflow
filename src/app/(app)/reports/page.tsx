"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { listCategories, listProjects, listSessions } from "@/lib/api";
import { downloadText, sessionsToCsv } from "@/lib/export";
import { localDateKey, secsToHM, secsToHours, todayKey } from "@/lib/time";
import type { Category, Project, TimeSession } from "@/lib/types";

type Range = "day" | "week";

export default function ReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("day");

  const reload = useCallback(async () => {
    const [p, c, s] = await Promise.all([listProjects(), listCategories(), listSessions()]);
    setProjects(p);
    setCategories(c);
    setSessions(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const inRange = useMemo(() => {
    const today = todayKey();
    if (range === "day") {
      return sessions.filter((s) => s.end_time && localDateKey(new Date(s.start_time)) === today);
    }
    const start = new Date();
    start.setDate(start.getDate() - 6);
    const startKey = localDateKey(start);
    return sessions.filter(
      (s) => s.end_time && localDateKey(new Date(s.start_time)) >= startKey,
    );
  }, [sessions, range]);

  const byProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of inRange) {
      map.set(s.project_id, (map.get(s.project_id) ?? 0) + (s.duration_seconds ?? 0));
    }
    return [...map.entries()]
      .map(([id, secs]) => ({ project: projById.get(id), secs }))
      .filter((x) => x.project)
      .sort((a, b) => b.secs - a.secs);
  }, [inRange, projById]);

  const totalSecs = inRange.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
  const maxSecs = byProject[0]?.secs ?? 1;

  function exportCsv() {
    const csv = sessionsToCsv(sessions, projects, categories);
    downloadText(`projectflow-sessions-${todayKey()}.csv`, csv);
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Where your time went."
        right={
          <button className="btn btn-ghost" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </button>
        }
      />

      <div className="mb-4 inline-flex gap-1 rounded-xl bg-[var(--surface-2)] p-1 text-sm">
        {(["day", "week"] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-lg px-4 py-1.5 font-medium capitalize transition ${
              range === r ? "bg-[var(--surface)] shadow" : "muted"
            }`}
          >
            {r === "day" ? "Today" : "This week"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin muted" />
        </div>
      ) : (
        <>
          <div className="card mb-3 p-4">
            <p className="muted text-xs">Total worked ({range === "day" ? "today" : "last 7 days"})</p>
            <p className="font-mono text-2xl font-bold">{secsToHM(totalSecs)}</p>
          </div>

          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">Time by project</p>
            {byProject.length === 0 ? (
              <p className="muted text-sm">No completed sessions in this period.</p>
            ) : (
              <div className="space-y-2.5">
                {byProject.map(({ project, secs }) => {
                  const cat = project ? catById.get(project.category_id) : undefined;
                  return (
                    <div key={project!.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="truncate">{project!.name}</span>
                        <span className="muted ml-2 shrink-0 font-mono">{secsToHours(secs).toFixed(1)}h</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
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

          <p className="muted mt-4 text-xs">
            Richer charts (donut, weekly stacked bars, heatmap) and Excel export arrive in a later phase.
          </p>
        </>
      )}
    </div>
  );
}

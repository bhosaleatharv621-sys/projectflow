"use client";

// Project detail & completion analytics — ADMIN ONLY (worked vs target vs %
// is an admin statistic; employees work from the Projects browser instead).

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, CheckCircle2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { BurnBadge } from "@/components/ui/BurnBadge";
import { ProjectFormModal } from "@/components/projects/ProjectFormModal";
import { useMember } from "@/components/MemberProvider";
import {
  deleteProject,
  listCategories,
  listMembers,
  listProjects,
  listSessionsForProject,
  updateProject,
} from "@/lib/api";
import { currencySymbol, STATUS_LABELS } from "@/lib/constants";
import {
  burnStatus,
  formatClockTime,
  liveElapsedSeconds,
  localDateKey,
  paceTip,
  percentComplete,
  secsToHM,
  secsToHours,
  todayContributionSeconds,
  todayKey,
  totalSpentSeconds,
} from "@/lib/time";
import { track } from "@/lib/sync";
import type { Category, Member, Project, TimeSession } from "@/lib/types";

export default function ProjectDetailPage({ params }: { params: { id: string } }) {
  const member = useMember();
  const router = useRouter();
  const isAdmin = member.role === "admin";

  const [project, setProject] = useState<Project | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [numbers, setNumbers] = useState<string[]>([]);
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin) router.replace("/projects");
  }, [isAdmin, router]);

  const reload = useCallback(async () => {
    const [all, cats, sess, mems] = await Promise.all([
      listProjects(),
      listCategories(),
      listSessionsForProject(params.id),
      listMembers(),
    ]);
    const p = all.find((x) => x.id === params.id) ?? null;
    setProject(p);
    setCategories(cats);
    setNumbers(all.map((x) => x.project_number));
    setCategory(p ? cats.find((c) => c.id === p.category_id) ?? null : null);
    setSessions(sess);
    setMembers(mems);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    if (isAdmin) reload();
  }, [isAdmin, reload]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);

  const metrics = useMemo(() => {
    if (!project) return null;
    const total = totalSpentSeconds(sessions);
    const today = todayContributionSeconds(sessions, todayKey());
    const pct = percentComplete(total, project.target_hours);
    const remaining = Math.max(0, project.target_hours - secsToHours(total));
    const daysWorked = new Set(sessions.map((s) => localDateKey(new Date(s.start_time)))).size;
    return {
      total,
      today,
      pct,
      remaining,
      burn: burnStatus(project, total),
      tip: paceTip(project, total, daysWorked),
      sessionCount: sessions.filter((s) => s.end_time).length,
    };
  }, [project, sessions]);

  async function markComplete() {
    if (!project) return;
    await track(
      updateProject(project.id, { status: "completed", completed_at: new Date().toISOString() }),
    );
    reload();
  }

  async function onDelete() {
    if (!project) return;
    if (!confirm(`Delete "${project.name}" and all its time history?`)) return;
    await track(deleteProject(project.id));
    router.push("/projects");
  }

  if (!isAdmin) return null;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin muted" />
      </div>
    );
  }
  if (!project || !metrics) {
    return (
      <div className="card p-6">
        <p>Project not found.</p>
        <Link href="/projects" className="mt-2 inline-block text-brand">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/projects" className="mb-3 inline-flex items-center gap-1.5 text-sm muted hover:text-brand">
        <ArrowLeft size={15} /> Projects
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{ background: category?.color ?? "#888" }}
          >
            <CategoryIcon icon={category?.icon ?? "Folder"} size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <span className="rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium muted">
                {project.project_number}
              </span>
            </div>
            <p className="muted mt-1 text-sm">
              {STATUS_LABELS[project.status] ?? project.status}
              {project.cost != null && (
                <>
                  {" · "}
                  {currencySymbol()}
                  {project.cost.toLocaleString("en-IN")}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => setEditOpen(true)}>
            <Pencil size={15} /> Edit
          </button>
          {project.status !== "completed" && (
            <button className="btn btn-ghost text-emerald-600" onClick={markComplete}>
              <CheckCircle2 size={15} /> Mark complete
            </button>
          )}
          <button className="btn btn-ghost text-red-500" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total worked" value={`${secsToHours(metrics.total).toFixed(1)}h`} />
        <Stat label="Target" value={`${project.target_hours}h`} />
        <Stat label="Remaining" value={`${metrics.remaining.toFixed(1)}h`} />
        <Stat label="Today" value={secsToHM(metrics.today)} />
      </div>

      <div className="card mt-3 p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Completion</span>
          <div className="flex items-center gap-2">
            {project.deadline && <BurnBadge status={metrics.burn} />}
            <span className="text-sm font-semibold">{Math.round(metrics.pct)}%</span>
          </div>
        </div>
        <ProgressBar
          percent={metrics.pct}
          color={metrics.pct >= 100 ? "#059669" : metrics.burn.tone === "red" ? "#dc2626" : category?.color ?? "var(--brand)"}
        />
        {project.deadline && <p className="muted mt-2 text-xs">Deadline: {project.deadline}</p>}
        {metrics.tip && (
          <p className="mt-3 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm">{metrics.tip}</p>
        )}
      </div>

      {project.notes && (
        <div className="card mt-3 p-4">
          <p className="mb-1 text-sm font-medium">Notes</p>
          <p className="muted whitespace-pre-wrap text-sm">{project.notes}</p>
        </div>
      )}

      <div className="card mt-3 p-4">
        <p className="mb-3 text-sm font-medium">
          Session history · {metrics.sessionCount} cycle{metrics.sessionCount === 1 ? "" : "s"}
        </p>
        {sessions.length === 0 ? (
          <p className="muted text-sm">No sessions logged yet.</p>
        ) : (
          <div className="space-y-1.5">
            {sessions.map((s) => {
              const running = !s.end_time;
              const dur = liveElapsedSeconds(s);
              const person = memberById.get(s.user_id);
              return (
                <div key={s.id} className="rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                  <div className="flex items-center justify-between">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{person?.display_name ?? "—"}</span>
                      <span className="muted">
                        {" "}
                        ·{" "}
                        {new Date(s.start_time).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}{" "}
                        · {formatClockTime(s.start_time)} –{" "}
                        {running ? "running" : formatClockTime(s.end_time!)}
                      </span>
                    </span>
                    <span className={`shrink-0 font-mono ${running ? "text-emerald-500" : "muted"}`}>
                      {secsToHM(dur)}
                    </span>
                  </div>
                  {s.notes && <p className="muted mt-0.5 text-xs italic">“{s.notes}”</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ProjectFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={reload}
        categories={categories}
        editing={project}
        existingNumbers={numbers}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-3">
      <p className="muted text-xs">{label}</p>
      <p className="mt-0.5 text-lg font-bold">{value}</p>
    </div>
  );
}

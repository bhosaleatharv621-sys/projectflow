"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus,
  Loader2,
  Play,
  CalendarPlus,
  Pencil,
  Trash2,
  Search,
  FolderKanban,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { CategoryIcon } from "@/components/CategoryIcon";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { BurnBadge } from "@/components/ui/BurnBadge";
import { HealthBadge } from "@/components/ui/HealthBadge";
import { ProjectFormModal } from "@/components/projects/ProjectFormModal";
import { useMember } from "@/components/MemberProvider";
import {
  addToToday,
  deleteProject,
  getProjectTotals,
  listCategories,
  listProjects,
  listTodaySelections,
  startSession,
  updateProject,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { burnStatus, percentComplete, projectHealth, secsToHours, todayKey } from "@/lib/time";
import { STATUS_LABELS } from "@/lib/constants";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import type { Category, Project } from "@/lib/types";

type SortKey = "recent" | "name" | "number" | "deadline";

export default function ProjectsPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // PERF: one small query for projects, one for categories, and — for the
    // admin only — one aggregate view read for lifetime totals. No session
    // rows ever cross the wire here.
    const [p, c, t] = await Promise.all([
      listProjects(),
      listCategories(),
      isAdmin ? getProjectTotals() : Promise.resolve(new Map<string, number>()),
    ]);
    setProjects(p);
    setCategories(c);
    setTotals(t);
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    reload();
  }, [reload]);

  // LIVE PROGRESS (admin): totals refresh whenever any session changes.
  useEffect(() => {
    if (!isAdmin) return;
    const supabase = createClient();
    const channel = supabase
      .channel("projects-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_sessions" }, () => {
        getProjectTotals().then(setTotals).catch(() => {});
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  // PERF: search is a pure in-memory filter over the already-loaded project
  // list — zero network per keystroke, instant at 1000+ projects.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (catFilter && p.category_id !== catFilter) return false;
      if (!q) return true;
      const cat = catById.get(p.category_id);
      return (
        p.name.toLowerCase().includes(q) ||
        p.project_number.toLowerCase().includes(q) ||
        (cat?.name.toLowerCase().includes(q) ?? false)
      );
    });
    list.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "number":
          return a.project_number.localeCompare(b.project_number, undefined, { numeric: true });
        case "deadline":
          return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return list;
  }, [projects, query, catFilter, sort, catById]);

  async function onStartTimer(p: Project) {
    setBusyId(p.id);
    try {
      const day = todayKey();
      const todays = await listTodaySelections(day);
      if (!todays.some((t) => t.project_id === p.id)) {
        await track(addToToday(member.userId, p.id, day, todays.length));
      }
      await track(startSession(p.id));
      router.push("/today");
    } finally {
      setBusyId(null);
    }
  }

  async function onAddToday(p: Project) {
    setBusyId(p.id);
    try {
      const day = todayKey();
      const todays = await listTodaySelections(day);
      await track(addToToday(member.userId, p.id, day, todays.length));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(p: Project) {
    if (!confirm(`Delete "${p.name}" and all its time history? This affects the whole organization.`)) return;
    try {
      await track(deleteProject(p.id));
      toast.success("Project deleted");
      reload();
    } catch (e) {
      toast.error(friendlyError(e));
    }
  }

  async function onMarkComplete(p: Project) {
    if (!confirm(`Mark "${p.name}" as completed?`)) return;
    setBusyId(p.id);
    try {
      await track(updateProject(p.id, { status: "completed", completed_at: new Date().toISOString() }));
      toast.success("Project completed");
      await reload();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle={isAdmin ? "Manage the organization's projects." : "Find a project and start working."}
        right={
          isAdmin ? (
            <div className="flex gap-2">
              <Link href="/categories" className="btn btn-ghost">
                <FolderKanban size={16} /> Categories
              </Link>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                <Plus size={16} /> New project
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input
            className="input pl-9"
            placeholder="Search by name, number, or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="input max-w-[180px]" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="input max-w-[150px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="recent">Newest</option>
          <option value="name">Name</option>
          <option value="number">Number</option>
          <option value="deadline">Deadline</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">{projects.length === 0 ? "No projects yet" : "No matching projects"}</p>
          <p className="muted mt-1 text-sm">
            {projects.length === 0
              ? isAdmin
                ? "Create the first project for your team."
                : "No projects yet. Ask your admin to create one."
              : "Try a different search or filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((p) => {
            const cat = catById.get(p.category_id);
            const total = totals.get(p.id) ?? 0;
            const pct = percentComplete(total, p.target_hours);
            const burn = burnStatus(p, total);
            const health = projectHealth(p, total);
            const barColor = health.key === "completed" ? "#059669" : health.color;
            return (
              <div key={p.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                      style={{ background: cat?.color ?? "#888" }}
                    >
                      <CategoryIcon icon={cat?.icon ?? "Folder"} size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isAdmin ? (
                          <Link href={`/projects/${p.id}`} className="font-semibold hover:text-brand">
                            {p.name}
                          </Link>
                        ) : (
                          <span className="font-semibold">{p.name}</span>
                        )}
                        <span className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-xs font-medium muted">
                          {p.project_number}
                        </span>
                        {isAdmin ? (
                          <>
                            <HealthBadge health={health} />
                            {p.deadline && <BurnBadge status={burn} />}
                          </>
                        ) : (
                          /* Employees see the plain project status — never
                             progress-derived values. */
                          <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-0.5 text-xs font-medium muted">
                            {STATUS_LABELS[p.status] ?? p.status}
                          </span>
                        )}
                      </div>
                      <p className="muted mt-0.5 text-xs">{cat?.name ?? "—"}</p>
                      {/* Completion statistics are an admin-only view. */}
                      {isAdmin && (
                        <div className="mt-2 max-w-md">
                          <div className="mb-1 flex justify-between text-xs muted">
                            <span>
                              {secsToHours(total).toFixed(1)}h worked · {p.target_hours}h target ·{" "}
                              {Math.max(0, p.target_hours - secsToHours(total)).toFixed(1)}h left
                            </span>
                            <span className="font-semibold" style={{ color: "var(--text)" }}>
                              {Math.round(pct)}%
                            </span>
                          </div>
                          <ProgressBar percent={pct} color={barColor} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <button
                      className="btn btn-ghost px-2.5 py-1.5"
                      title="Start timer now"
                      onClick={() => onStartTimer(p)}
                      disabled={busyId === p.id}
                    >
                      {busyId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                    </button>
                    <button
                      className="btn btn-ghost px-2.5 py-1.5"
                      title="Add to Today"
                      onClick={() => onAddToday(p)}
                      disabled={busyId === p.id}
                    >
                      <CalendarPlus size={15} />
                    </button>
                    {isAdmin && (
                      <>
                        {p.status !== "completed" && (
                          <button
                            className="btn btn-ghost px-2.5 py-1.5 text-emerald-600"
                            title="Mark complete"
                            onClick={() => onMarkComplete(p)}
                            disabled={busyId === p.id}
                          >
                            <CheckCircle2 size={15} />
                          </button>
                        )}
                        <button
                          className="btn btn-ghost px-2.5 py-1.5"
                          title="Edit"
                          onClick={() => {
                            setEditing(p);
                            setModalOpen(true);
                          }}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="btn btn-ghost px-2.5 py-1.5 text-red-500"
                          title="Delete"
                          onClick={() => onDelete(p)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <ProjectFormModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSaved={reload}
          categories={categories}
          editing={editing}
          existingNumbers={projects.map((p) => p.project_number)}
        />
      )}
    </div>
  );
}

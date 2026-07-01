"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Loader2, Play, CalendarPlus, Pencil, Trash2, Search } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { BurnBadge } from "@/components/ui/BurnBadge";
import { ProjectFormModal } from "@/components/projects/ProjectFormModal";
import {
  addToToday,
  deleteProject,
  listCategories,
  listProjectsByCategory,
  listSessions,
  listTodaySelections,
  startSession,
} from "@/lib/api";
import { currencySymbol } from "@/lib/constants";
import {
  burnStatus,
  percentComplete,
  secsToHours,
  todayKey,
  totalSpentSeconds,
} from "@/lib/time";
import { track } from "@/lib/sync";
import type { Category, Project, TimeSession } from "@/lib/types";

type SortKey = "name" | "deadline" | "percent" | "recent";

export default function CategoryDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [cats, p, s] = await Promise.all([
      listCategories(),
      listProjectsByCategory(params.id),
      listSessions(),
    ]);
    setCategories(cats);
    setCategory(cats.find((c) => c.id === params.id) ?? null);
    setProjects(p);
    setSessions(s);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, TimeSession[]>();
    for (const s of sessions) {
      const arr = map.get(s.project_id) ?? [];
      arr.push(s);
      map.set(s.project_id, arr);
    }
    return map;
  }, [sessions]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const items = projects
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.project_number.toLowerCase().includes(q))
      .map((p) => {
        const total = totalSpentSeconds(sessionsByProject.get(p.id) ?? []);
        return { project: p, total, pct: percentComplete(total, p.target_hours) };
      });
    items.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.project.name.localeCompare(b.project.name);
        case "deadline":
          return (a.project.deadline ?? "9999").localeCompare(b.project.deadline ?? "9999");
        case "percent":
          return b.pct - a.pct;
        default:
          return b.project.created_at.localeCompare(a.project.created_at);
      }
    });
    return items;
  }, [projects, sessionsByProject, query, sort]);

  async function onStartTimer(p: Project) {
    setBusyId(p.id);
    try {
      const day = todayKey();
      const todays = await listTodaySelections(day);
      if (!todays.some((t) => t.project_id === p.id)) {
        await track(addToToday(p.id, day, todays.length));
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
      await track(addToToday(p.id, day, todays.length));
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(p: Project) {
    if (!confirm(`Delete "${p.name}" and all its time history?`)) return;
    await track(deleteProject(p.id));
    reload();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="animate-spin muted" />
      </div>
    );
  }

  if (!category) {
    return (
      <div className="card p-6">
        <p>Category not found.</p>
        <Link href="/categories" className="mt-2 inline-block text-brand">
          Back to categories
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/categories" className="mb-3 inline-flex items-center gap-1.5 text-sm muted hover:text-brand">
        <ArrowLeft size={15} /> Categories
      </Link>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ background: category.color }}>
            <CategoryIcon icon={category.icon} size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{category.name}</h1>
            <p className="muted text-sm">{projects.length} project{projects.length === 1 ? "" : "s"}</p>
          </div>
        </div>
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

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
          <input
            className="input pl-9"
            placeholder="Search by name or number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="input max-w-[170px]" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="recent">Sort: Newest</option>
          <option value="name">Sort: Name</option>
          <option value="deadline">Sort: Deadline</option>
          <option value="percent">Sort: % complete</option>
        </select>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">No projects yet</p>
          <p className="muted mt-1 text-sm">Add your first project to this category.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map(({ project: p, total, pct }) => {
            const burn = burnStatus(p, total);
            const barColor = pct >= 100 ? "#059669" : burn.tone === "red" ? "#dc2626" : category.color;
            return (
              <div key={p.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/projects/${p.id}`} className="font-semibold hover:text-brand">
                        {p.name}
                      </Link>
                      <span className="rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-xs font-medium muted">
                        {p.project_number}
                      </span>
                      {p.deadline ? (
                        <BurnBadge status={burn} />
                      ) : (
                        <span className="text-xs muted">{Math.round(pct)}%</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs muted">
                      {p.cost != null && (
                        <span>
                          {currencySymbol()}
                          {p.cost.toLocaleString("en-IN")}
                        </span>
                      )}
                      <span>
                        {secsToHours(total).toFixed(1)}h / {p.target_hours}h
                      </span>
                      {p.deadline && <span>Due {p.deadline}</span>}
                    </div>
                    <div className="mt-2 max-w-md">
                      <ProgressBar percent={pct} color={barColor} />
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ProjectFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={reload}
        categories={categories}
        defaultCategoryId={category.id}
        editing={editing}
        existingNumbers={projects.map((p) => p.project_number)}
      />
    </div>
  );
}

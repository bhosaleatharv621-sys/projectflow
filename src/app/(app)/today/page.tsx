"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Loader2 } from "lucide-react";
import { TodayCard, type CardState } from "@/components/today/TodayCard";
import { AddToTodayModal } from "@/components/today/AddToTodayModal";
import {
  addToToday,
  listCategories,
  listProjects,
  listSessions,
  listTodaySelections,
  removeFromToday,
  startSession,
  stopActiveSession,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { secsToHM, todayContributionSeconds, todayKey } from "@/lib/time";
import { track } from "@/lib/sync";
import type { Category, DailySelection, Project, TimeSession } from "@/lib/types";

export default function TodayPage() {
  const [selections, setSelections] = useState<DailySelection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sessions, setSessions] = useState<TimeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Projects the user explicitly Stopped this session -> show "Start" (fresh
  // cycle at 0:00) instead of "Resume". Cleared when a new cycle begins.
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(new Set());

  const day = todayKey();

  const reload = useCallback(async () => {
    const [sel, proj, cats, sess] = await Promise.all([
      listTodaySelections(day),
      listProjects(),
      listCategories(),
      listSessions(),
    ]);
    setSelections(sel);
    setProjects(proj);
    setCategories(cats);
    setSessions(sess);
    setLoading(false);
  }, [day]);

  // Resolve true state from the server on load, and again on focus/online.
  useEffect(() => {
    reload();
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [reload]);

  // Live cross-device reflection: reload when sessions/selections change.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("today-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_sessions" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "daily_selections" }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  const openSession = useMemo(() => sessions.find((s) => !s.end_time) ?? null, [sessions]);

  // Tick every second only while a timer is open.
  useEffect(() => {
    if (!openSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openSession]);

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, TimeSession[]>();
    for (const s of sessions) {
      const arr = map.get(s.project_id) ?? [];
      arr.push(s);
      map.set(s.project_id, arr);
    }
    return map;
  }, [sessions]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const cards = useMemo(
    () =>
      selections
        .map((sel) => projectById.get(sel.project_id))
        .filter((p): p is Project => !!p),
    [selections, projectById],
  );

  const totalToday = useMemo(() => todayContributionSeconds(sessions, day, now), [sessions, day, now]);

  function cardState(projectId: string): CardState {
    if (openSession?.project_id === projectId) return "running";
    const todaySecs = todayContributionSeconds(sessionsByProject.get(projectId) ?? [], day, now);
    if (todaySecs > 0 && !stoppedIds.has(projectId)) return "paused";
    return "idle";
  }

  async function onStart(projectId: string) {
    setBusyId(projectId);
    try {
      await track(startSession(projectId));
      setStoppedIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      await reload();
      setNow(Date.now());
    } finally {
      setBusyId(null);
    }
  }

  async function onPause(projectId: string) {
    setBusyId(projectId);
    try {
      await track(stopActiveSession());
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onStop(projectId: string) {
    if (!confirm("Stop this project? Your time so far is saved. The next Start begins a new cycle at 0:00.")) return;
    setBusyId(projectId);
    try {
      if (openSession?.project_id === projectId) {
        await track(stopActiveSession());
      }
      setStoppedIds((prev) => new Set(prev).add(projectId));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(projectId: string) {
    setBusyId(projectId);
    try {
      await track(removeFromToday(projectId, day));
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  const existingIds = useMemo(() => new Set(selections.map((s) => s.project_id)), [selections]);

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today</h1>
          <p className="muted mt-0.5 text-sm">{dateLabel}</p>
        </div>
        <div className="text-right">
          <p className="muted text-xs">Total worked today</p>
          <p className="font-mono text-xl font-bold">{secsToHM(totalToday)}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin muted" />
        </div>
      ) : cards.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-semibold">Nothing planned yet</p>
          <p className="muted mx-auto mt-1 max-w-sm text-sm">
            Add the handful of projects you want to work on today. Today starts fresh each morning.
          </p>
          {projects.length === 0 ? (
            <Link href="/categories" className="btn btn-primary mx-auto mt-4 w-fit">
              Create your first project
            </Link>
          ) : (
            <button className="btn btn-primary mx-auto mt-4 w-fit" onClick={() => setAddOpen(true)}>
              <CalendarPlus size={16} /> Add project to today
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {cards.map((p) => (
            <TodayCard
              key={p.id}
              project={p}
              category={categoryById.get(p.category_id) ?? null}
              sessions={sessionsByProject.get(p.id) ?? []}
              now={now}
              state={cardState(p.id)}
              busy={busyId === p.id}
              onStart={() => onStart(p.id)}
              onPause={() => onPause(p.id)}
              onStop={() => onStop(p.id)}
              onRemove={() => onRemove(p.id)}
            />
          ))}

          <button
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-3.5 text-sm font-medium muted transition hover:border-brand hover:text-brand"
            style={{ borderColor: "var(--border)" }}
          >
            <CalendarPlus size={18} /> Add project to today
          </button>
        </div>
      )}

      <AddToTodayModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={reload}
        projects={projects}
        categories={categories}
        existingIds={existingIds}
        startPosition={selections.length}
      />
    </div>
  );
}

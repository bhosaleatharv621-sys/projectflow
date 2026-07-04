"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Loader2 } from "lucide-react";
import { TodayCard, type CardState } from "@/components/today/TodayCard";
import { AddToTodayModal } from "@/components/today/AddToTodayModal";
import { SessionNotesModal } from "@/components/today/SessionNotesModal";
import { useMember } from "@/components/MemberProvider";
import {
  addToToday,
  getMyOpenSession,
  getProjectTotals,
  listCategories,
  listMySessionsSince,
  listProjects,
  listTodaySelections,
  removeFromToday,
  startSession,
  stopActiveSession,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { liveElapsedSeconds, startOfToday, todayKey } from "@/lib/time";
import { secsToHM } from "@/lib/time";
import { track } from "@/lib/sync";
import type { Category, DailySelection, Project, TimeSession } from "@/lib/types";

export default function TodayPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";

  const [selections, setSelections] = useState<DailySelection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [mySessions, setMySessions] = useState<TimeSession[]>([]);
  const [openSession, setOpenSession] = useState<TimeSession | null>(null);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<TimeSession | null>(null);
  // Projects the user explicitly Stopped this visit -> show "Start" (fresh
  // cycle at 0:00) instead of "Resume". Cleared when a new cycle begins.
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(new Set());

  const day = todayKey();

  const reload = useCallback(async () => {
    // PERF: everything here is scoped — my selections for today, MY sessions
    // since local midnight, my single open session, and (admin only) the
    // pre-aggregated lifetime totals. The old code fetched every session in
    // the database and reduced in the browser.
    const sinceIso = startOfToday().toISOString();
    const [sel, proj, cats, sess, open, tot] = await Promise.all([
      listTodaySelections(day),
      listProjects(),
      listCategories(),
      listMySessionsSince(member.userId, sinceIso),
      getMyOpenSession(member.userId),
      isAdmin ? getProjectTotals() : Promise.resolve(new Map<string, number>()),
    ]);
    setSelections(sel);
    setProjects(proj);
    setCategories(cats);
    setMySessions(sess);
    setOpenSession(open);
    setTotals(tot);
    setLoading(false);
  }, [day, member.userId, isAdmin]);

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

  // Live cross-device reflection.
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

  // Tick every second only while a timer is open.
  useEffect(() => {
    if (!openSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openSession]);

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, TimeSession[]>();
    for (const s of mySessions) {
      const arr = map.get(s.project_id) ?? [];
      arr.push(s);
      map.set(s.project_id, arr);
    }
    return map;
  }, [mySessions]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const cards = useMemo(
    () => selections.map((sel) => projectById.get(sel.project_id)).filter((p): p is Project => !!p),
    [selections, projectById],
  );

  const totalToday = useMemo(
    () => mySessions.reduce((sum, s) => sum + liveElapsedSeconds(s, now), 0),
    [mySessions, now],
  );

  function cardState(projectId: string): CardState {
    if (openSession?.project_id === projectId) return "running";
    const todaySecs = (sessionsByProject.get(projectId) ?? []).reduce(
      (sum, s) => sum + liveElapsedSeconds(s, now),
      0,
    );
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

  // Stop = close the session immediately (no time accrues while typing),
  // then open the work-notes modal for the just-closed session.
  async function onStop(projectId: string) {
    setBusyId(projectId);
    try {
      let closed: TimeSession | null = null;
      if (openSession?.project_id === projectId) {
        closed = await track(stopActiveSession());
      }
      setStoppedIds((prev) => new Set(prev).add(projectId));
      await reload();
      if (closed) setNotesFor(closed);
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

  const notesProject = notesFor ? projectById.get(notesFor.project_id) : null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Today</h1>
          <p className="muted mt-0.5 text-sm">
            {dateLabel} · {member.displayName}
          </p>
        </div>
        <div className="text-right">
          <p className="muted text-xs">My time today</p>
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
            Add the projects you want to work on today. Today starts fresh each morning.
          </p>
          {projects.length === 0 ? (
            <Link href="/projects" className="btn btn-primary mx-auto mt-4 w-fit">
              Browse projects
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
              todaySessions={sessionsByProject.get(p.id) ?? []}
              totalSeconds={totals.get(p.id) ?? 0}
              now={now}
              state={cardState(p.id)}
              busy={busyId === p.id}
              isAdmin={isAdmin}
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
        userId={member.userId}
      />

      <SessionNotesModal
        session={notesFor}
        projectName={notesProject ? `${notesProject.project_number} — ${notesProject.name}` : ""}
        onClose={() => {
          setNotesFor(null);
          reload();
        }}
      />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarPlus, Loader2, History } from "lucide-react";
import { TodayCard, type CardState } from "@/components/today/TodayCard";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { AddToTodayModal } from "@/components/today/AddToTodayModal";
import { SessionNotesModal } from "@/components/today/SessionNotesModal";
import { ManualTimeModal } from "@/components/today/ManualTimeModal";
import { useMember } from "@/components/MemberProvider";
import { AdminStats, EmployeeStats } from "@/components/dashboard/DashboardStats";
import { OnboardingCard } from "@/components/dashboard/OnboardingCard";
import {
  addToToday,
  getMyOpenSession,
  getProjectTotals,
  getRangeProjectTotals,
  listCategories,
  listMembers,
  listMySessionsSince,
  listOpenSessions,
  listPendingRequests,
  listProjects,
  listTimeEntryRequests,
  listTodaySelections,
  removeFromToday,
  startSession,
  stopActiveSession,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import { liveElapsedSeconds, rangeStart, startOfToday, todayKey } from "@/lib/time";
import { secsToHM } from "@/lib/time";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import type {
  Category,
  DailySelection,
  Member,
  Project,
  TimeEntryRequest,
  TimeSession,
} from "@/lib/types";

export default function TodayPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";

  const [selections, setSelections] = useState<DailySelection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [myWeekSessions, setMyWeekSessions] = useState<TimeSession[]>([]);
  const [openSession, setOpenSession] = useState<TimeSession | null>(null);
  const [totals, setTotals] = useState<Map<string, number>>(new Map());
  // Admin dashboard extras (org-wide, cheap aggregates only).
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [allOpenSessions, setAllOpenSessions] = useState<TimeSession[]>([]);
  const [orgTodaySeconds, setOrgTodaySeconds] = useState(0);
  const [orgWeekSeconds, setOrgWeekSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesFor, setNotesFor] = useState<TimeSession | null>(null);
  const [notesMode, setNotesMode] = useState<"create" | "edit">("create");
  const [manualOpen, setManualOpen] = useState(false);
  const [myRequests, setMyRequests] = useState<TimeEntryRequest[]>([]);
  // Projects the user explicitly Stopped this visit -> show "Start" (fresh
  // cycle at 0:00) instead of "Resume". Cleared when a new cycle begins.
  const [stoppedIds, setStoppedIds] = useState<Set<string>>(new Set());

  const day = todayKey();

  const reload = useCallback(async () => {
    // PERF: everything here is scoped — my selections for today, MY sessions
    // since the start of the week (feeds both the timetable and the personal
    // dashboard), my single open session, and (admin only) small org
    // aggregates. No unbounded session history is ever fetched.
    const weekIso = (rangeStart("week") ?? startOfToday()).toISOString();
    const todayIso = startOfToday().toISOString();
    const [sel, proj, cats, sess, open, tot] = await Promise.all([
      listTodaySelections(day),
      listProjects(),
      listCategories(),
      listMySessionsSince(member.userId, weekIso),
      getMyOpenSession(member.userId),
      isAdmin ? getProjectTotals() : Promise.resolve(new Map<string, number>()),
    ]);
    setSelections(sel);
    setProjects(proj);
    setCategories(cats);
    setMyWeekSessions(sess);
    setOpenSession(open);
    setTotals(tot);

    // My manual-time requests (RLS scopes; admin also receives others', so
    // filter to the caller's own for this personal card).
    try {
      const reqs = await listTimeEntryRequests();
      setMyRequests(reqs.filter((r) => r.user_id === member.userId).slice(0, 5));
    } catch {
      // table may not exist yet if 0006 hasn't been run — degrade silently
      setMyRequests([]);
    }

    if (isAdmin) {
      const [mems, pend, opens, orgToday, orgWeek] = await Promise.all([
        listMembers(),
        listPendingRequests(),
        listOpenSessions(),
        getRangeProjectTotals(todayIso),
        getRangeProjectTotals(weekIso),
      ]);
      setMembers(mems);
      setPendingCount(pend.length);
      setAllOpenSessions(opens);
      setOrgTodaySeconds([...orgToday.values()].reduce((a, b) => a + b, 0));
      setOrgWeekSeconds([...orgWeek.values()].reduce((a, b) => a + b, 0));
    }
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

  // Timestamp comparison via Date (not string compare — Postgres returns
  // "+00:00" offsets while toISOString() uses "Z").
  const myTodaySessions = useMemo(() => {
    const todayMs = startOfToday().getTime();
    return myWeekSessions.filter((s) => new Date(s.start_time).getTime() >= todayMs);
  }, [myWeekSessions]);

  const sessionsByProject = useMemo(() => {
    const map = new Map<string, TimeSession[]>();
    for (const s of myTodaySessions) {
      const arr = map.get(s.project_id) ?? [];
      arr.push(s);
      map.set(s.project_id, arr);
    }
    return map;
  }, [myTodaySessions]);

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const cards = useMemo(
    () => selections.map((sel) => projectById.get(sel.project_id)).filter((p): p is Project => !!p),
    [selections, projectById],
  );

  const totalToday = useMemo(
    () => myTodaySessions.reduce((sum, s) => sum + liveElapsedSeconds(s, now), 0),
    [myTodaySessions, now],
  );

  const totalWeek = useMemo(
    () => myWeekSessions.reduce((sum, s) => sum + liveElapsedSeconds(s, now), 0),
    [myWeekSessions, now],
  );

  // Most recently worked projects (deduped, newest first) for quick-start.
  const recentProjects = useMemo(() => {
    const seen = new Set<string>();
    const out: Project[] = [];
    for (const s of myWeekSessions) {
      if (seen.has(s.project_id)) continue;
      seen.add(s.project_id);
      const p = projectById.get(s.project_id);
      if (p) out.push(p);
      if (out.length >= 4) break;
    }
    return out;
  }, [myWeekSessions, projectById]);

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
      toast.success("Timer started");
      await reload();
      setNow(Date.now());
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function quickStart(projectId: string) {
    setBusyId(projectId);
    try {
      if (!selections.some((s) => s.project_id === projectId)) {
        await track(addToToday(member.userId, projectId, day, selections.length));
      }
      await track(startSession(projectId));
      setStoppedIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      toast.success("Timer started");
      await reload();
      setNow(Date.now());
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onPause(projectId: string) {
    setBusyId(projectId);
    try {
      await track(stopActiveSession());
      toast.success("Paused — time saved");
      await reload();
    } catch (e) {
      toast.error(friendlyError(e));
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
      if (closed) {
        setNotesMode("create");
        setNotesFor(closed);
      }
    } catch (e) {
      toast.error(friendlyError(e));
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

      {/* First-use guidance: admin sees it while setup is incomplete;
          employees see it until they've logged any work. Dismissible. */}
      {!loading && isAdmin && (categories.length === 0 || projects.length === 0 || members.filter((m) => m.role === "employee").length === 0) && (
        <OnboardingCard
          role="admin"
          steps={[
            { label: "Create categories", done: categories.length > 0, href: "/categories" },
            { label: "Create projects", done: projects.length > 0, href: "/projects" },
            {
              label: "Approve employees when they request access",
              done: members.filter((m) => m.role === "employee").length > 0,
              href: "/team",
            },
            { label: "Monitor the team and reports", href: "/reports" },
          ]}
        />
      )}
      {!loading && !isAdmin && myWeekSessions.length === 0 && selections.length === 0 && (
        <OnboardingCard
          role="employee"
          steps={[
            { label: "Find a project in the Projects tab", href: "/projects" },
            { label: "Add it to Today" },
            { label: "Start the timer when you begin working" },
            { label: "Stop the timer when you finish" },
            { label: "Add a short note about what you did" },
          ]}
        />
      )}

      {!loading &&
        (isAdmin ? (
          <AdminStats
            projects={projects}
            members={members}
            pendingCount={pendingCount}
            openSessions={allOpenSessions}
            orgTodaySeconds={orgTodaySeconds}
            orgWeekSeconds={orgWeekSeconds}
            lifetimeTotals={totals}
          />
        ) : (
          <EmployeeStats
            myTodaySeconds={totalToday}
            myWeekSeconds={totalWeek}
            runningProjectName={
              openSession ? projectById.get(openSession.project_id)?.name ?? null : null
            }
            recentProjects={recentProjects}
            recentSessions={myWeekSessions.filter((s) => s.end_time)}
            projectById={projectById}
            busyId={busyId}
            onQuickStart={quickStart}
          />
        ))}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
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
              onEditNote={(s) => {
                setNotesMode("edit");
                setNotesFor(s);
              }}
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

      {!loading && projects.length > 0 && (
        <div className="mt-3 text-center">
          <button
            className="inline-flex items-center gap-1.5 text-xs muted hover:text-brand"
            onClick={() => setManualOpen(true)}
          >
            <History size={13} /> Forgot to track time? Request a manual entry
          </button>
        </div>
      )}

      {/* My manual-time requests: pending until the admin approves. */}
      {!loading && myRequests.length > 0 && (
        <div className="card mt-3 p-3">
          <p className="muted mb-2 text-[11px] font-medium uppercase tracking-wide">
            My manual time requests
          </p>
          <div className="space-y-1">
            {myRequests.map((r) => {
              const proj = projectById.get(r.project_id);
              const tone =
                r.status === "approved"
                  ? { background: "rgba(5,150,105,0.12)", color: "#059669" }
                  : r.status === "rejected"
                    ? { background: "rgba(220,38,38,0.12)", color: "#dc2626" }
                    : { background: "rgba(217,119,6,0.13)", color: "#b45309" };
              return (
                <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="muted min-w-0 truncate">
                    {proj?.name ?? "—"} ·{" "}
                    {new Date(r.start_time).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}{" "}
                    · {secsToHM(r.duration_seconds)}
                  </span>
                  <span className="rounded-full px-2 py-0.5 font-semibold capitalize" style={tone}>
                    {r.status}
                  </span>
                </div>
              );
            })}
          </div>
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

      <ManualTimeModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onSubmitted={reload}
        projects={projects}
      />

      <SessionNotesModal
        session={notesFor}
        mode={notesMode}
        projectName={notesProject ? `${notesProject.project_number} — ${notesProject.name}` : ""}
        onClose={() => {
          setNotesFor(null);
          reload();
        }}
      />
    </div>
  );
}

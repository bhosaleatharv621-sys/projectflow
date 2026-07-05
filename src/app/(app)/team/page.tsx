"use client";

// Team activity. The visibility rule is enforced by RLS, not here:
//   * admin receives everyone's sessions and every member row
//   * employees receive coworkers' sessions/rows but NEVER the admin's
// This page just renders whatever the database allows it to see.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  CircleDot,
  UserPlus,
  Check,
  X,
  UserMinus,
  UserCheck,
  Users,
  Pencil,
  History,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RangeFilter } from "@/components/ui/RangeFilter";
import { Avatar } from "@/components/ui/Avatar";
import { SessionNotesModal } from "@/components/today/SessionNotesModal";
import { useMember } from "@/components/MemberProvider";
import {
  approveJoinRequest,
  approveTimeEntryRequest,
  deactivateMember,
  getRangeUserTotals,
  listMembers,
  listOpenSessions,
  listPendingRequests,
  listProjects,
  listSessionsSince,
  listTimeEntryRequests,
  reactivateMember,
  rejectJoinRequest,
  rejectTimeEntryRequest,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  formatClockTime,
  liveElapsedSeconds,
  rangeStart,
  secsToClock,
  secsToHM,
  startOfToday,
  type RangeKey,
} from "@/lib/time";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import type {
  JoinRequest,
  Member,
  Project,
  TimeEntryRequest,
  TimeSession,
  UserTotal,
} from "@/lib/types";

function RoleBadge({ role }: { role: string }) {
  if (role !== "admin") return null;
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ background: "rgba(79,70,229,0.12)", color: "var(--brand)" }}
    >
      Admin
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const inactive = status === "inactive";
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
      style={
        inactive
          ? { background: "rgba(220,38,38,0.12)", color: "#dc2626" }
          : { background: "rgba(5,150,105,0.12)", color: "#059669" }
      }
    >
      {inactive ? "Inactive" : "Active"}
    </span>
  );
}

export default function TeamPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openSessions, setOpenSessions] = useState<TimeSession[]>([]);
  const [totals, setTotals] = useState<UserTotal[]>([]);
  const [todayTotals, setTodayTotals] = useState<UserTotal[]>([]);
  const [weekTotals, setWeekTotals] = useState<UserTotal[]>([]);
  const [recent, setRecent] = useState<TimeSession[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [timeRequests, setTimeRequests] = useState<TimeEntryRequest[]>([]);
  const [range, setRange] = useState<RangeKey>("today");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [editNoteFor, setEditNoteFor] = useState<TimeSession | null>(null);

  const reload = useCallback(async () => {
    const fromIso = rangeStart(range)?.toISOString() ?? null;
    const todayIso = startOfToday().toISOString();
    const weekIso = (rangeStart("week") ?? startOfToday()).toISOString();
    // PERF: totals come pre-summed from range-bounded RPCs; the raw session
    // list is capped (recent activity), so payloads stay flat as history grows.
    const [m, p, open, tot, rec, reqs, todayT, weekT] = await Promise.all([
      listMembers(),
      listProjects(),
      listOpenSessions(),
      getRangeUserTotals(fromIso),
      listSessionsSince(fromIso, 50),
      isAdmin ? listPendingRequests() : Promise.resolve([] as JoinRequest[]),
      isAdmin ? getRangeUserTotals(todayIso) : Promise.resolve([] as UserTotal[]),
      isAdmin ? getRangeUserTotals(weekIso) : Promise.resolve([] as UserTotal[]),
    ]);
    setMembers(m);
    setProjects(p);
    setOpenSessions(open);
    setTotals(tot);
    setRecent(rec.filter((s) => s.end_time));
    setRequests(reqs);
    setTodayTotals(todayT);
    setWeekTotals(weekT);

    if (isAdmin) {
      try {
        setTimeRequests(await listTimeEntryRequests("pending"));
      } catch {
        // 0006 not applied yet — degrade silently
        setTimeRequests([]);
      }
    }
    setLoading(false);
  }, [range, isAdmin]);

  useEffect(() => {
    reload();
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  // Live board: refresh when any visible session changes; the admin also
  // gets live updates when a new join request arrives.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("team-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_sessions" }, () => reload())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "organization_join_requests" },
        () => reload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_entry_requests" },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  // Tick for live elapsed of open sessions.
  useEffect(() => {
    if (openSessions.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openSessions.length]);

  async function toggleActive(m: Member) {
    const deactivating = m.status === "active";
    if (
      deactivating &&
      !confirm(
        `Deactivate ${m.display_name}? They will lose access until reactivated; any running timer is stopped and saved.`,
      )
    ) {
      return;
    }
    setDecidingId(m.user_id);
    try {
      if (deactivating) {
        await track(deactivateMember(m.user_id));
        toast.success("Employee deactivated");
      } else {
        await track(reactivateMember(m.user_id));
        toast.success("Employee reactivated");
      }
      await reload();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setDecidingId(null);
    }
  }

  async function decide(req: JoinRequest, action: "approve" | "reject") {
    if (action === "reject" && !confirm(`Reject the access request from ${req.display_name} (${req.email})?`)) {
      return;
    }
    setDecidingId(req.id);
    try {
      if (action === "approve") {
        await track(approveJoinRequest(req.id));
        toast.success("Employee approved");
      } else {
        await track(rejectJoinRequest(req.id));
        toast.success("Request rejected");
      }
      await reload();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setDecidingId(null);
    }
  }

  async function decideTime(r: TimeEntryRequest, action: "approve" | "reject") {
    if (action === "reject" && !confirm("Reject this manual time request?")) return;
    setDecidingId(r.id);
    try {
      if (action === "approve") {
        await track(approveTimeEntryRequest(r.id));
        toast.success("Manual time approved — session created");
      } else {
        await track(rejectTimeEntryRequest(r.id));
        toast.success("Manual time request rejected");
      }
      await reload();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setDecidingId(null);
    }
  }

  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const openByUser = useMemo(() => new Map(openSessions.map((s) => [s.user_id, s])), [openSessions]);
  const totalByUser = useMemo(() => new Map(totals.map((t) => [t.user_id, t])), [totals]);
  const todayByUser = useMemo(() => new Map(todayTotals.map((t) => [t.user_id, t.total_seconds])), [todayTotals]);
  const weekByUser = useMemo(() => new Map(weekTotals.map((t) => [t.user_id, t.total_seconds])), [weekTotals]);

  // Last-active approximation from the data already on hand: a running
  // session means "now"; otherwise the newest end_time in the fetched window.
  const lastActiveByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of recent) {
      if (s.end_time && !map.has(s.user_id)) map.set(s.user_id, s.end_time);
    }
    return map;
  }, [recent]);

  const people = useMemo(
    () => (isAdmin ? members : members.filter((m) => m.role !== "admin")),
    [members, isAdmin],
  );
  const activeMembers = useMemo(() => people.filter((m) => m.status === "active"), [people]);
  const inactiveMembers = useMemo(() => people.filter((m) => m.status === "inactive"), [people]);

  const maxTotal = Math.max(1, ...totals.map((t) => t.total_seconds));

  function lastActiveLabel(userId: string): string {
    if (openByUser.has(userId)) return "now";
    const iso = lastActiveByUser.get(userId);
    if (!iso) return "—";
    const d = new Date(iso);
    const today = startOfToday().getTime();
    if (d.getTime() >= today) return formatClockTime(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }

  function MemberRow({ m }: { m: Member }) {
    const inactive = m.status === "inactive";
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-[var(--surface-2)]"
        style={inactive ? { opacity: 0.65 } : undefined}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={m.display_name} size={32} />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-tight">
              <span className="truncate">{m.display_name}</span>
              {m.user_id === member.userId && <span className="muted text-xs font-normal">(you)</span>}
              <RoleBadge role={m.role} />
              <StatusBadge status={m.status} />
            </p>
            <p className="muted text-xs">
              Today {secsToHM(todayByUser.get(m.user_id) ?? 0)} · Week{" "}
              {secsToHM(weekByUser.get(m.user_id) ?? 0)} · Last active {lastActiveLabel(m.user_id)}
            </p>
          </div>
        </div>
        {isAdmin && m.role !== "admin" && (
          <button
            className="btn btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
            onClick={() => toggleActive(m)}
            disabled={decidingId === m.user_id}
          >
            {decidingId === m.user_id ? (
              <Loader2 size={13} className="animate-spin" />
            ) : inactive ? (
              <>
                <UserCheck size={13} className="text-emerald-500" /> Reactivate
              </>
            ) : (
              <>
                <UserMinus size={13} className="text-red-500" /> Deactivate
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle={isAdmin ? "Everyone's activity, live." : "What your colleagues are working on."}
        right={<RangeFilter value={range} onChange={setRange} />}
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin muted" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pending access requests — ADMIN ONLY (RLS hides them from others). */}
          {isAdmin && requests.length > 0 && (
            <div className="card p-4" style={{ borderColor: "rgba(217,119,6,0.4)" }}>
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                <UserPlus size={15} className="text-amber-500" />
                Pending access requests
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
                  {requests.length}
                </span>
              </p>
              <div className="space-y-2">
                {requests.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Avatar name={r.display_name} size={28} />
                      <div className="min-w-0">
                        <span className="font-medium">{r.display_name}</span>
                        <span className="muted"> · {r.email}</span>
                        <span className="muted">
                          {" "}
                          · requested{" "}
                          {new Date(r.requested_at).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        className="btn btn-primary px-3 py-1.5"
                        onClick={() => decide(r, "approve")}
                        disabled={decidingId === r.id}
                      >
                        {decidingId === r.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}
                        Approve
                      </button>
                      <button
                        className="btn btn-ghost px-3 py-1.5 text-red-500"
                        onClick={() => decide(r, "reject")}
                        disabled={decidingId === r.id}
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending manual time requests — ADMIN ONLY */}
          {isAdmin && timeRequests.length > 0 && (
            <div className="card p-4" style={{ borderColor: "rgba(79,70,229,0.35)" }}>
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                <History size={15} className="text-brand" />
                Manual time requests
                <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-semibold text-brand">
                  {timeRequests.length}
                </span>
              </p>
              <div className="space-y-2.5">
                {timeRequests.map((r) => {
                  const person = memberById.get(r.user_id);
                  const proj = projectById.get(r.project_id);
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">
                          <span className="font-medium">{person?.display_name ?? "—"}</span>
                          <span className="muted"> · {proj ? proj.name : "—"}</span>
                        </p>
                        <p className="muted text-xs">
                          {new Date(r.start_time).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}{" "}
                          {formatClockTime(r.start_time)} – {formatClockTime(r.end_time)} ·{" "}
                          {secsToHM(r.duration_seconds)}
                          {r.reason && <> · “{r.reason}”</>}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          className="btn btn-primary px-3 py-1.5"
                          onClick={() => decideTime(r, "approve")}
                          disabled={decidingId === r.id}
                        >
                          {decidingId === r.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          Approve
                        </button>
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-red-500"
                          onClick={() => decideTime(r, "reject")}
                          disabled={decidingId === r.id}
                        >
                          <X size={14} /> Reject
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Working now */}
          <div className="card p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium">
              <CircleDot size={15} className="text-emerald-500" /> Working now
            </p>
            {openSessions.length === 0 ? (
              <p className="muted text-sm">Nobody has a timer running right now.</p>
            ) : (
              <div className="space-y-2">
                {openSessions.map((s) => {
                  const person = memberById.get(s.user_id);
                  const proj = projectById.get(s.project_id);
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Avatar name={person?.display_name ?? "?"} size={28} />
                        <span className="min-w-0 truncate">
                          <span className="font-medium">
                            {person?.display_name ?? "—"}
                            {s.user_id === member.userId && <span className="muted font-normal"> (you)</span>}
                          </span>
                          <span className="muted"> · {proj ? `${proj.project_number} — ${proj.name}` : "—"}</span>
                          <span className="muted"> · since {formatClockTime(s.start_time)}</span>
                        </span>
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-emerald-500">
                        {secsToClock(liveElapsedSeconds(s, now))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Members management — ADMIN ONLY */}
          {isAdmin && (
            <div className="card p-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Users size={15} className="muted" /> Members
                <span className="muted text-xs font-normal">
                  {activeMembers.length} active
                  {inactiveMembers.length > 0 ? ` · ${inactiveMembers.length} inactive` : ""}
                </span>
              </p>
              {activeMembers.length === 0 ? (
                <p className="muted text-sm">No members yet — approve access requests to add employees.</p>
              ) : (
                <div className="space-y-0.5">
                  {activeMembers.map((m) => (
                    <MemberRow key={m.user_id} m={m} />
                  ))}
                </div>
              )}
              {inactiveMembers.length > 0 && (
                <>
                  <p className="muted mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide">Inactive</p>
                  <div className="space-y-0.5">
                    {inactiveMembers.map((m) => (
                      <MemberRow key={m.user_id} m={m} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Time per person in range */}
          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">Time by person</p>
            {people.length === 0 ? (
              <p className="muted text-sm">No team members yet.</p>
            ) : (
              <div className="space-y-2.5">
                {people
                  .slice()
                  .sort(
                    (a, b) =>
                      (totalByUser.get(b.user_id)?.total_seconds ?? 0) -
                      (totalByUser.get(a.user_id)?.total_seconds ?? 0),
                  )
                  .map((m) => {
                    const t = totalByUser.get(m.user_id);
                    const secs = t?.total_seconds ?? 0;
                    return (
                      <div key={m.user_id}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <Avatar name={m.display_name} size={20} />
                            <span className="truncate">{m.display_name}</span>
                            {m.user_id === member.userId && <span className="muted text-xs">(you)</span>}
                            {m.status === "inactive" && <StatusBadge status="inactive" />}
                          </span>
                          <span className="muted shrink-0 font-mono text-xs">
                            {secsToHM(secs)}
                            {t ? ` · ${t.session_count} cycle${t.session_count === 1 ? "" : "s"}` : ""}
                          </span>
                        </div>
                        <div
                          className="h-2.5 w-full overflow-hidden rounded-full"
                          style={{ background: "var(--surface-2)" }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${(secs / maxTotal) * 100}%`, background: "var(--brand)" }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Recent sessions with notes */}
          <div className="card p-4">
            <p className="mb-3 text-sm font-medium">Recent sessions</p>
            {recent.length === 0 ? (
              <p className="muted text-sm">No completed sessions in this period yet.</p>
            ) : (
              <div className="space-y-2">
                {recent.map((s) => {
                  const person = memberById.get(s.user_id);
                  const proj = projectById.get(s.project_id);
                  return (
                    <div key={s.id} className="rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]">
                      <div className="flex items-center justify-between gap-3">
                        <span className="flex min-w-0 items-center gap-2 truncate">
                          <Avatar name={person?.display_name ?? "?"} size={20} />
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{person?.display_name ?? "—"}</span>
                            <span className="muted">
                              {" "}
                              · {proj ? `${proj.project_number} — ${proj.name}` : "—"} ·{" "}
                              {new Date(s.start_time).toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                              })}{" "}
                              {formatClockTime(s.start_time)}
                            </span>
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="font-mono muted">{secsToHM(s.duration_seconds ?? 0)}</span>
                          {/* You can only edit YOUR OWN notes (RLS-enforced too). */}
                          {s.user_id === member.userId && (
                            <button
                              className="rounded p-0.5 muted hover:text-brand"
                              title={s.notes ? "Edit note" : "Add note"}
                              onClick={() => setEditNoteFor(s)}
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                        </span>
                      </div>
                      {s.notes && <p className="muted mt-0.5 pl-7 text-xs italic">“{s.notes}”</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <SessionNotesModal
        session={editNoteFor}
        mode="edit"
        projectName={
          editNoteFor
            ? (() => {
                const p = projectById.get(editNoteFor.project_id);
                return p ? `${p.project_number} — ${p.name}` : "";
              })()
            : ""
        }
        onClose={() => {
          setEditNoteFor(null);
          reload();
        }}
      />
    </div>
  );
}

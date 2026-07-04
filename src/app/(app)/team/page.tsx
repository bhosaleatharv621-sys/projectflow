"use client";

// Team activity. The visibility rule is enforced by RLS, not here:
//   * admin receives everyone's sessions and every member row
//   * employees receive coworkers' sessions/rows but NEVER the admin's
// This page just renders whatever the database allows it to see.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, CircleDot, UserPlus, Check, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { RangeFilter } from "@/components/ui/RangeFilter";
import { useMember } from "@/components/MemberProvider";
import {
  approveJoinRequest,
  getRangeUserTotals,
  listMembers,
  listOpenSessions,
  listPendingRequests,
  listProjects,
  listSessionsSince,
  rejectJoinRequest,
} from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import {
  formatClockTime,
  liveElapsedSeconds,
  rangeStart,
  secsToClock,
  secsToHM,
  type RangeKey,
} from "@/lib/time";
import { track } from "@/lib/sync";
import type { JoinRequest, Member, Project, TimeSession, UserTotal } from "@/lib/types";

export default function TeamPage() {
  const member = useMember();
  const isAdmin = member.role === "admin";

  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [openSessions, setOpenSessions] = useState<TimeSession[]>([]);
  const [totals, setTotals] = useState<UserTotal[]>([]);
  const [recent, setRecent] = useState<TimeSession[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [range, setRange] = useState<RangeKey>("today");
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const fromIso = rangeStart(range)?.toISOString() ?? null;
    // PERF: totals come pre-summed from a range-bounded RPC; the raw session
    // list is capped (recent activity), so payloads stay flat as history grows.
    const [m, p, open, tot, rec, reqs] = await Promise.all([
      listMembers(),
      listProjects(),
      listOpenSessions(),
      getRangeUserTotals(fromIso),
      listSessionsSince(fromIso, 50),
      isAdmin ? listPendingRequests() : Promise.resolve([] as JoinRequest[]),
    ]);
    setMembers(m);
    setProjects(p);
    setOpenSessions(open);
    setTotals(tot);
    setRecent(rec.filter((s) => s.end_time));
    setRequests(reqs);
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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  async function decide(req: JoinRequest, action: "approve" | "reject") {
    if (action === "reject" && !confirm(`Reject the access request from ${req.display_name} (${req.email})?`)) {
      return;
    }
    setDecidingId(req.id);
    try {
      if (action === "approve") await track(approveJoinRequest(req.id));
      else await track(rejectJoinRequest(req.id));
      await reload();
    } finally {
      setDecidingId(null);
    }
  }

  // Tick for live elapsed of open sessions.
  useEffect(() => {
    if (openSessions.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [openSessions.length]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.user_id, m])), [members]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Presentation: employees' people list excludes the admin (their rows are
  // already absent thanks to RLS, so this is belt-and-braces only).
  const people = useMemo(
    () => (isAdmin ? members : members.filter((m) => m.role !== "admin")),
    [members, isAdmin],
  );

  const totalByUser = useMemo(() => new Map(totals.map((t) => [t.user_id, t])), [totals]);
  const maxTotal = Math.max(1, ...totals.map((t) => t.total_seconds));

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
                      <div className="min-w-0">
                        <span className="font-medium">
                          {person?.display_name ?? "—"}
                          {s.user_id === member.userId && <span className="muted"> (you)</span>}
                        </span>
                        <span className="muted"> · {proj ? `${proj.project_number} — ${proj.name}` : "—"}</span>
                        <span className="muted"> · since {formatClockTime(s.start_time)}</span>
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
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="truncate">
                            {m.display_name}
                            {m.role === "admin" && <span className="muted text-xs"> · admin</span>}
                            {m.user_id === member.userId && <span className="muted"> (you)</span>}
                          </span>
                          <span className="muted ml-2 shrink-0 font-mono">
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
              <p className="muted text-sm">No completed sessions in this period.</p>
            ) : (
              <div className="space-y-2">
                {recent.map((s) => {
                  const person = memberById.get(s.user_id);
                  const proj = projectById.get(s.project_id);
                  return (
                    <div
                      key={s.id}
                      className="rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center justify-between gap-3">
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
                        <span className="shrink-0 font-mono muted">{secsToHM(s.duration_seconds ?? 0)}</span>
                      </div>
                      {s.notes && <p className="muted mt-0.5 text-xs italic">“{s.notes}”</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Typed data-access helpers used by client components. Every read/write goes
// through Supabase; RLS (migration 0002) is the authorization wall:
//   * categories/projects are org-wide reads, admin-only writes
//   * time_sessions hide the admin's rows from employees
//   * daily_selections are strictly personal
//
// PERF NOTES (the 10–15s project-creation fix lives here):
//   1. No auth.getUser() before writes. That was a blocking network
//      round-trip on EVERY insert. Identity now comes from column defaults
//      (auth.uid(), current_org_id()) applied inside Postgres — a create is
//      exactly ONE network call.
//   2. No unbounded session fetches. The old listSessions() pulled every
//      session ever and summed in JS; totals now come from an indexed view /
//      range-bounded RPCs, so payloads stay small as the org's history grows.

import { createClient } from "./supabase/client";
import type {
  AuditLog,
  Category,
  DailySelection,
  JoinRequest,
  Member,
  Project,
  ProjectStatus,
  ProjectTotal,
  TimeEntryRequest,
  TimeSession,
  UserTotal,
} from "./types";

function db() {
  return createClient();
}

// --- Members ----------------------------------------------------------------

/**
 * Org members visible to the caller. RLS already applies the visibility rule
 * (employees never receive the admin's row), so no client-side filtering is
 * needed for correctness — only for presentation.
 */
export async function listMembers(): Promise<Member[]> {
  const { data, error } = await db()
    .from("members")
    .select("*")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return data as Member[];
}

// --- Join requests (admin approval flow) -------------------------------------
// Reads are RLS-scoped (admin sees the org's requests, others only their own).
// All mutations go through SECURITY DEFINER RPCs that assert the caller is
// the admin — an employee invoking them gets a database error.

export async function listPendingRequests(): Promise<JoinRequest[]> {
  const { data, error } = await db()
    .from("organization_join_requests")
    .select("*")
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  if (error) throw error;
  return data as JoinRequest[];
}

export async function approveJoinRequest(requestId: string): Promise<void> {
  const { error } = await db().rpc("approve_join_request", { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectJoinRequest(requestId: string): Promise<void> {
  const { error } = await db().rpc("reject_join_request", { p_request_id: requestId });
  if (error) throw error;
}

/** Safety valve for accounts that predate the signup trigger. */
export async function requestAccess(): Promise<void> {
  const { error } = await db().rpc("request_access");
  if (error) throw error;
}

// --- Manual time entry requests (approval model) -----------------------------
// Reads are RLS-scoped (own rows, or the whole org for the admin). Mutations
// go through SECURITY DEFINER RPCs: submit is always for the caller;
// approve/reject assert the admin inside the database.

export async function listTimeEntryRequests(status?: string): Promise<TimeEntryRequest[]> {
  let q = db()
    .from("time_entry_requests")
    .select("*")
    .order("requested_at", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return data as TimeEntryRequest[];
}

export async function submitTimeEntryRequest(input: {
  projectId: string;
  startIso: string;
  endIso: string;
  reason: string;
}): Promise<void> {
  const { error } = await db().rpc("submit_time_entry_request", {
    p_project_id: input.projectId,
    p_start: input.startIso,
    p_end: input.endIso,
    p_reason: input.reason,
  });
  if (error) throw error;
}

export async function approveTimeEntryRequest(requestId: string): Promise<void> {
  const { error } = await db().rpc("approve_time_entry_request", { p_request_id: requestId });
  if (error) throw error;
}

export async function rejectTimeEntryRequest(requestId: string): Promise<void> {
  const { error } = await db().rpc("reject_time_entry_request", { p_request_id: requestId });
  if (error) throw error;
}

// --- Audit log (admin-only read; RLS returns zero rows to anyone else) ------

export async function listAuditLogs(limit = 100): Promise<AuditLog[]> {
  const { data, error } = await db()
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data as AuditLog[];
}

// --- Member deactivation (admin only; asserted inside the database) ---------

export async function deactivateMember(userId: string): Promise<void> {
  const { error } = await db().rpc("deactivate_member", { p_user_id: userId });
  if (error) throw error;
}

export async function reactivateMember(userId: string): Promise<void> {
  const { error } = await db().rpc("reactivate_member", { p_user_id: userId });
  if (error) throw error;
}

// --- Categories -------------------------------------------------------------

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await db()
    .from("categories")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data as Category[];
}

export async function createCategory(input: {
  name: string;
  icon: string;
  color: string;
}): Promise<Category> {
  // created_by / organization_id are filled by column defaults in Postgres.
  const { data, error } = await db()
    .from("categories")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as Category;
}

export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, "name" | "icon" | "color" | "archived">>,
): Promise<void> {
  const { error } = await db().from("categories").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await db().from("categories").delete().eq("id", id);
  if (error) throw error;
}

// --- Projects ---------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export async function listProjectsByCategory(categoryId: string): Promise<Project[]> {
  const { data, error } = await db()
    .from("projects")
    .select("*")
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Project[];
}

export interface ProjectInput {
  category_id: string;
  project_number: string;
  name: string;
  cost: number | null;
  target_hours: number;
  deadline: string | null;
  notes: string | null;
}

export async function createProject(input: ProjectInput): Promise<Project> {
  // PERF: single round-trip — identity columns default inside the database.
  const { data, error } = await db()
    .from("projects")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  id: string,
  patch: Partial<ProjectInput> & { status?: ProjectStatus; completed_at?: string | null },
): Promise<void> {
  const { error } = await db().from("projects").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await db().from("projects").delete().eq("id", id);
  if (error) throw error;
}

/** Suggest the next sequential project number, e.g. "P-001" -> "P-002". */
export function suggestNextNumber(existing: string[]): string {
  let maxN = 0;
  let prefix = "P-";
  let width = 3;
  for (const n of existing) {
    const m = n.match(/^(.*?)(\d+)\s*$/);
    if (m) {
      const num = parseInt(m[2], 10);
      if (num >= maxN) {
        maxN = num;
        prefix = m[1] || prefix;
        width = Math.max(width, m[2].length);
      }
    }
  }
  const next = maxN + 1;
  return `${prefix}${String(next).padStart(width, "0")}`;
}

// --- Aggregates (computed in Postgres, under the caller's RLS) --------------

/** Lifetime worked seconds per project, from the indexed project_totals view. */
export async function getProjectTotals(): Promise<Map<string, number>> {
  const { data, error } = await db().from("project_totals").select("*");
  if (error) throw error;
  return new Map((data as ProjectTotal[]).map((r) => [r.project_id, Number(r.total_seconds)]));
}

/** Worked seconds per project within [from, to). null bounds = unbounded. */
export async function getRangeProjectTotals(
  fromIso: string | null,
  toIso: string | null = null,
): Promise<Map<string, number>> {
  const { data, error } = await db().rpc("session_project_totals", {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return new Map((data as ProjectTotal[]).map((r) => [r.project_id, Number(r.total_seconds)]));
}

/** Worked seconds per person within [from, to). null bounds = unbounded. */
export async function getRangeUserTotals(
  fromIso: string | null,
  toIso: string | null = null,
): Promise<UserTotal[]> {
  const { data, error } = await db().rpc("session_user_totals", {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return (data as UserTotal[]).map((r) => ({
    user_id: r.user_id,
    total_seconds: Number(r.total_seconds),
    session_count: Number(r.session_count),
  }));
}

// --- Time sessions ----------------------------------------------------------

/**
 * Sessions within [fromIso, toIso) (all visible people), newest first.
 * PERF: always range-bounded + LIMITed — never "everything ever".
 */
export async function listSessionsSince(
  fromIso: string | null,
  limit = 500,
  toIso: string | null = null,
): Promise<TimeSession[]> {
  let q = db()
    .from("time_sessions")
    .select("*")
    .order("start_time", { ascending: false })
    .limit(limit);
  if (fromIso) q = q.gte("start_time", fromIso);
  if (toIso) q = q.lt("start_time", toIso);
  const { data, error } = await q;
  if (error) throw error;
  return data as TimeSession[];
}

/** The caller's OWN sessions since `fromIso` (Today workspace). */
export async function listMySessionsSince(
  userId: string,
  fromIso: string,
): Promise<TimeSession[]> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .eq("user_id", userId)
    .gte("start_time", fromIso)
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data as TimeSession[];
}

export async function listSessionsForProject(projectId: string): Promise<TimeSession[]> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .eq("project_id", projectId)
    .order("start_time", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data as TimeSession[];
}

/** The caller's OWN currently-open session, if any. */
export async function getMyOpenSession(userId: string): Promise<TimeSession | null> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as TimeSession) ?? null;
}

/** ALL open sessions visible to the caller (live "working now" board). */
export async function listOpenSessions(): Promise<TimeSession[]> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .is("end_time", null)
    .order("start_time", { ascending: true });
  if (error) throw error;
  return data as TimeSession[];
}

/**
 * Start / resume a cycle. The RPC atomically closes the caller's open
 * session first (single-active-timer, enforced server-side) and verifies the
 * project belongs to the caller's organization.
 */
export async function startSession(projectId: string): Promise<TimeSession> {
  const { data, error } = await db().rpc("start_session", { p_project_id: projectId });
  if (error) throw error;
  return data as TimeSession;
}

/** Pause / Stop: close the caller's open session (same data effect). */
export async function stopActiveSession(): Promise<TimeSession | null> {
  const { data, error } = await db().rpc("stop_active_session");
  if (error) throw error;
  return (data as TimeSession) ?? null;
}

/**
 * Attach/edit work notes on a session. RLS only lets you update your OWN
 * sessions; an update matching zero rows means it wasn't yours — surface
 * that as a friendly error instead of silently doing nothing.
 */
export async function updateSessionNotes(sessionId: string, notes: string): Promise<void> {
  const { data, error } = await db()
    .from("time_sessions")
    .update({ notes: notes.trim() || null })
    .eq("id", sessionId)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("You can only edit your own notes.");
  }
}

// --- Daily selection (Today's Timetable) ------------------------------------

export async function listTodaySelections(dayKey: string): Promise<DailySelection[]> {
  const { data, error } = await db()
    .from("daily_selections")
    .select("*")
    .eq("date", dayKey)
    .is("removed_at", null)
    .order("position", { ascending: true });
  if (error) throw error;
  return data as DailySelection[];
}

export async function addToToday(
  userId: string,
  projectId: string,
  dayKey: string,
  position: number,
): Promise<void> {
  // Upsert so re-adding a previously-removed project restores it. user_id is
  // needed explicitly here because it is part of the conflict target.
  const { error } = await db()
    .from("daily_selections")
    .upsert(
      { user_id: userId, project_id: projectId, date: dayKey, position, removed_at: null },
      { onConflict: "user_id,project_id,date" },
    );
  if (error) throw error;
}

export async function removeFromToday(projectId: string, dayKey: string): Promise<void> {
  const { error } = await db()
    .from("daily_selections")
    .update({ removed_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("date", dayKey);
  if (error) throw error;
}

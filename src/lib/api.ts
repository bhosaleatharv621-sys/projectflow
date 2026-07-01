// Typed data-access helpers used by client components. Every read/write goes
// through Supabase (the single source of truth). RLS scopes rows to the user,
// so we never need to pass user_id on reads.

import { createClient } from "./supabase/client";
import type {
  Category,
  DailySelection,
  Project,
  ProjectStatus,
  TimeSession,
} from "./types";

function db() {
  return createClient();
}

async function currentUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await db().auth.getUser();
  if (error || !user) throw new Error("Not authenticated");
  return user.id;
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
  const user_id = await currentUserId();
  const { data, error } = await db()
    .from("categories")
    .insert({ ...input, user_id })
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
  const user_id = await currentUserId();
  const { data, error } = await db()
    .from("projects")
    .insert({ ...input, user_id })
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

// --- Time sessions ----------------------------------------------------------

export async function listSessions(): Promise<TimeSession[]> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data as TimeSession[];
}

export async function listSessionsForProject(projectId: string): Promise<TimeSession[]> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .eq("project_id", projectId)
    .order("start_time", { ascending: false });
  if (error) throw error;
  return data as TimeSession[];
}

/** The single currently-open session for this user, if any. */
export async function getOpenSession(): Promise<TimeSession | null> {
  const { data, error } = await db()
    .from("time_sessions")
    .select("*")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as TimeSession) ?? null;
}

/**
 * Start / resume a cycle for a project. The RPC atomically closes any other
 * open session first (single-active-timer, enforced server-side).
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

export async function addToToday(projectId: string, dayKey: string, position: number): Promise<void> {
  const user_id = await currentUserId();
  // Upsert so re-adding a previously-removed project restores it.
  const { error } = await db()
    .from("daily_selections")
    .upsert(
      { user_id, project_id: projectId, date: dayKey, position, removed_at: null },
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

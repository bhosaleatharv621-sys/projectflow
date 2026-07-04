// Domain types mirroring the Supabase schema
// (supabase/migrations/0001 + 0002). "Session" is the schema/code word for
// one work cycle (a single Start -> Pause/Stop chunk).

export type Role = "admin" | "employee";

export interface Organization {
  id: string;
  name: string;
  created_at: string;
}

export interface Member {
  user_id: string;
  organization_id: string;
  role: Role;
  display_name: string;
  created_at: string;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected";

export interface JoinRequest {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  display_name: string;
  status: JoinRequestStatus;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
}

export type ProjectStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "on_hold";

export interface Category {
  id: string;
  organization_id: string;
  created_by: string;
  name: string;
  icon: string; // lucide icon key
  color: string; // hex, used for accents + chart colors
  created_at: string;
  archived: boolean;
}

export interface Project {
  id: string;
  organization_id: string;
  created_by: string;
  category_id: string;
  project_number: string;
  name: string;
  cost: number | null;
  target_hours: number;
  deadline: string | null; // ISO date (YYYY-MM-DD)
  status: ProjectStatus;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface TimeSession {
  id: string;
  user_id: string; // who did the work
  organization_id: string;
  project_id: string;
  start_time: string; // ISO timestamp
  end_time: string | null; // null while running
  duration_seconds: number | null;
  notes: string | null; // work notes captured when the timer is stopped
}

export interface DailySelection {
  id: string;
  user_id: string;
  project_id: string;
  date: string; // YYYY-MM-DD, local calendar day
  position: number;
  added_at: string;
  removed_at: string | null;
}

// Aggregate rows returned by the reporting RPCs / views. These are computed
// in Postgres under the caller's RLS, so an employee's numbers can never
// include the admin's time.
export interface ProjectTotal {
  project_id: string;
  total_seconds: number;
}

export interface UserTotal {
  user_id: string;
  total_seconds: number;
  session_count: number;
}

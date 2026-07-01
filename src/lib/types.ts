// Domain types mirroring the Supabase schema (supabase/schema.sql).
// Glossary is kept consistent with the brief: "session" is the schema/code
// word for one "cycle" (a single Start -> Pause/Stop chunk).

export type ProjectStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "on_hold";

export interface Category {
  id: string;
  user_id: string;
  name: string;
  icon: string; // lucide icon key
  color: string; // hex, used for accents + chart colors
  created_at: string;
  archived: boolean;
}

export interface Project {
  id: string;
  user_id: string;
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
  user_id: string;
  project_id: string;
  start_time: string; // ISO timestamp
  end_time: string | null; // null while running
  duration_seconds: number | null;
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

// A project joined with its category and the metrics the UI needs. Metrics are
// always derived from time_sessions rows (never stored redundantly).
export interface ProjectWithMetrics extends Project {
  category: Category | null;
  total_spent_seconds: number; // all sessions, ever (excludes the live open one)
  today_seconds: number; // completed sessions starting today
}

// Native CSV generation (no dependency). One row per work cycle, including
// the person and the work notes captured at stop time. Rows are whatever the
// caller's RLS allows — an employee's export can never contain the admin's
// sessions.

import type { Category, Member, Project, TimeSession } from "./types";
import { secsToClock } from "./time";
import { STATUS_LABELS } from "./constants";

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export interface CsvOptions {
  /** Include the Target Hours column — admin only (role-gated by callers). */
  includeTargets?: boolean;
}

export function sessionsToCsv(
  sessions: TimeSession[],
  projects: Project[],
  categories: Category[],
  members: Member[] = [],
  options: CsvOptions = {},
): string {
  const projById = new Map(projects.map((p) => [p.id, p]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const memberById = new Map(members.map((m) => [m.user_id, m]));

  const header = [
    "Date",
    "Employee",
    "Category",
    "Project Number",
    "Project Name",
    "Project Status",
    ...(options.includeTargets ? ["Target Hours"] : []),
    "Session Start",
    "Session End",
    "Duration (hh:mm:ss)",
    "Notes",
  ];

  const rows = sessions
    .filter((s) => s.end_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((s) => {
      const p = projById.get(s.project_id);
      const c = p ? catById.get(p.category_id) : undefined;
      return [
        new Date(s.start_time).toLocaleDateString(),
        memberById.get(s.user_id)?.display_name ?? "",
        c?.name ?? "",
        p?.project_number ?? "",
        p?.name ?? "",
        p ? STATUS_LABELS[p.status] ?? p.status : "",
        ...(options.includeTargets ? [p?.target_hours ?? ""] : []),
        new Date(s.start_time).toLocaleString(),
        s.end_time ? new Date(s.end_time).toLocaleString() : "",
        secsToClock(s.duration_seconds ?? 0),
        s.notes ?? "",
      ];
    });

  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

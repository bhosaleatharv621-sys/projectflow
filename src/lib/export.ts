// Native CSV generation (no dependency). One row per cycle.
// Excel (.xlsx) export via SheetJS is a Phase 3 enhancement.

import type { Category, Project, TimeSession } from "./types";
import { secsToClock } from "./time";

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export function sessionsToCsv(
  sessions: TimeSession[],
  projects: Project[],
  categories: Category[],
): string {
  const projById = new Map(projects.map((p) => [p.id, p]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const header = [
    "Date",
    "Category",
    "Project Number",
    "Project Name",
    "Session Start",
    "Session End",
    "Duration (hh:mm:ss)",
  ];

  const rows = sessions
    .filter((s) => s.end_time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((s) => {
      const p = projById.get(s.project_id);
      const c = p ? catById.get(p.category_id) : undefined;
      return [
        new Date(s.start_time).toLocaleDateString(),
        c?.name ?? "",
        p?.project_number ?? "",
        p?.name ?? "",
        new Date(s.start_time).toLocaleString(),
        s.end_time ? new Date(s.end_time).toLocaleString() : "",
        secsToClock(s.duration_seconds ?? 0),
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

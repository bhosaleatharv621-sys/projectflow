"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { addToToday } from "@/lib/api";
import { todayKey } from "@/lib/time";
import { track } from "@/lib/sync";
import type { Category, Project } from "@/lib/types";

export function AddToTodayModal({
  open,
  onClose,
  onAdded,
  projects,
  categories,
  existingIds,
  startPosition,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  projects: Project[];
  categories: Category[];
  existingIds: Set<string>;
  startPosition: number;
  userId: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (existingIds.has(p.id)) return false;
      if (!q) return true;
      const cat = catById.get(p.category_id);
      return (
        p.name.toLowerCase().includes(q) ||
        p.project_number.toLowerCase().includes(q) ||
        (cat?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [projects, existingIds, query, catById]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const day = todayKey();
      let pos = startPosition;
      for (const id of selected) {
        await track(addToToday(userId, id, day, pos++));
      }
      setSelected(new Set());
      setQuery("");
      onAdded();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add projects to today" wide>
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 muted" />
        <input
          autoFocus
          className="input pl-9"
          placeholder="Search all projects by name, number, or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
        {results.length === 0 ? (
          <p className="muted py-8 text-center text-sm">
            {projects.length === 0 ? "No projects yet — create some first." : "No matching projects."}
          </p>
        ) : (
          results.map((p) => {
            const cat = catById.get(p.category_id);
            const isSel = selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition"
                style={{
                  borderColor: isSel ? "var(--brand)" : "var(--border)",
                  background: isSel ? "color-mix(in srgb, var(--brand) 8%, transparent)" : "transparent",
                }}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ background: cat?.color ?? "#888" }}
                >
                  <CategoryIcon icon={cat?.icon ?? "Folder"} size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs muted">
                    {p.project_number} · {cat?.name ?? "—"}
                  </p>
                </div>
                <div
                  className="flex h-5 w-5 items-center justify-center rounded-md border"
                  style={{
                    borderColor: isSel ? "var(--brand)" : "var(--border)",
                    background: isSel ? "var(--brand)" : "transparent",
                  }}
                >
                  {isSel && <Check size={13} className="text-white" />}
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={confirm} disabled={busy || selected.size === 0}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          Add {selected.size > 0 ? selected.size : ""} project{selected.size === 1 ? "" : "s"}
        </button>
      </div>
    </Modal>
  );
}

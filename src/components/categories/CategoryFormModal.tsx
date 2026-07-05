"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/lib/constants";
import { createCategory, updateCategory } from "@/lib/api";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import type { Category } from "@/lib/types";

export function CategoryFormModal({
  open,
  onClose,
  onSaved,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing?: Category | null;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState(editing?.icon ?? CATEGORY_ICONS[0]);
  const [color, setColor] = useState(editing?.color ?? CATEGORY_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await track(updateCategory(editing.id, { name: name.trim(), icon, color }));
        toast.success("Category updated");
      } else {
        await track(createCategory({ name: name.trim(), icon, color }));
        toast.success("Category created");
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit category" : "New category"}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input
            autoFocus
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Freelance, Client — Acme, College"
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
        </div>

        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-8 w-8 rounded-full ring-offset-2 transition"
                style={{
                  background: c,
                  boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : "none",
                }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="label">Icon</label>
          <div className="grid max-h-48 grid-cols-8 gap-1.5 overflow-y-auto rounded-xl border p-2" style={{ borderColor: "var(--border)" }}>
            {CATEGORY_ICONS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setIcon(k)}
                className="flex aspect-square items-center justify-center rounded-lg transition"
                style={{
                  background: icon === k ? color : "var(--surface-2)",
                  color: icon === k ? "white" : "var(--text-muted)",
                }}
                aria-label={k}
              >
                <CategoryIcon icon={k} size={18} />
              </button>
            ))}
          </div>
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

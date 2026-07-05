"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { createProject, suggestNextNumber, updateProject, type ProjectInput } from "@/lib/api";
import { currencySymbol } from "@/lib/constants";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import type { Category, Project } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: Category[];
  defaultCategoryId?: string;
  editing?: Project | null;
  existingNumbers: string[];
}

function blank(categoryId: string, numbers: string[]) {
  return {
    project_number: suggestNextNumber(numbers),
    name: "",
    category_id: categoryId,
    cost: "",
    target_hours: "",
    deadline: "",
    notes: "",
  };
}

export function ProjectFormModal({
  open,
  onClose,
  onSaved,
  categories,
  defaultCategoryId,
  editing,
  existingNumbers,
}: Props) {
  const [form, setForm] = useState(() =>
    blank(defaultCategoryId ?? categories[0]?.id ?? "", existingNumbers),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset the form whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        project_number: editing.project_number,
        name: editing.name,
        category_id: editing.category_id,
        cost: editing.cost == null ? "" : String(editing.cost),
        target_hours: String(editing.target_hours ?? ""),
        deadline: editing.deadline ?? "",
        notes: editing.notes ?? "",
      });
    } else {
      setForm(blank(defaultCategoryId ?? categories[0]?.id ?? "", existingNumbers));
    }
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function set<K extends keyof ReturnType<typeof blank>>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validated(): ProjectInput | null {
    if (!form.project_number.trim()) {
      setErr("Project number is required.");
      return null;
    }
    if (!form.name.trim()) {
      setErr("Project name is required.");
      return null;
    }
    const target = parseFloat(form.target_hours);
    if (isNaN(target) || target <= 0) {
      setErr("Target hours must be a positive number.");
      return null;
    }
    if (!form.category_id) {
      setErr("Please choose a category.");
      return null;
    }
    return {
      project_number: form.project_number.trim(),
      name: form.name.trim(),
      category_id: form.category_id,
      cost: form.cost === "" ? null : parseFloat(form.cost),
      target_hours: target,
      deadline: form.deadline || null,
      notes: form.notes.trim() || null,
    };
  }

  async function save(addAnother: boolean) {
    const input = validated();
    if (!input) return;
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await track(updateProject(editing.id, input));
        toast.success("Project updated");
      } else {
        await track(createProject(input));
        toast.success("Project created");
      }
      onSaved();
      if (addAnother && !editing) {
        // Keep the category, bump the number, clear the rest, focus name.
        const nextNums = [...existingNumbers, input.project_number];
        setForm({
          ...blank(input.category_id, nextNums),
        });
        setTimeout(() => nameRef.current?.focus(), 20);
      } else {
        onClose();
      }
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit project" : "New project"} wide>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Project number</label>
          <input
            className="input"
            value={form.project_number}
            onChange={(e) => set("project_number", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Category</label>
          <select
            className="input"
            value={form.category_id}
            onChange={(e) => set("category_id", e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label">
            Project name <span className="text-red-500">*</span>
          </label>
          <input
            ref={nameRef}
            className="input"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Website redesign"
          />
        </div>

        <div>
          <label className="label">Project cost ({currencySymbol()})</label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input"
            value={form.cost}
            onChange={(e) => set("cost", e.target.value)}
            placeholder="optional"
          />
        </div>
        <div>
          <label className="label">
            Target hours <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.25"
            className="input"
            value={form.target_hours}
            onChange={(e) => set("target_hours", e.target.value)}
            placeholder="e.g. 12.5"
          />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Deadline (optional)</label>
          <input
            type="date"
            className="input"
            value={form.deadline}
            onChange={(e) => set("deadline", e.target.value)}
          />
          <p className="muted mt-1 text-xs">
            Set a deadline to see on-time / behind-schedule status for this project.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label className="label">Notes</label>
          <textarea
            className="input min-h-[70px]"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="optional"
          />
        </div>
      </div>

      {err && <p className="mt-3 text-sm text-red-500">{err}</p>}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {!editing && (
          <button className="btn btn-ghost" onClick={() => save(true)} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            Save &amp; add another
          </button>
        )}
        <button className="btn btn-primary" onClick={() => save(false)} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          Save
        </button>
      </div>
    </Modal>
  );
}

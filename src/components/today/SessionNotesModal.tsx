"use client";

// Notes-after-stop AND edit-later: the timer is always stopped FIRST (so no
// time accrues while the user types), then this modal captures optional work
// notes and attaches them to the closed session. Skipping/closing keeps the
// session — recorded time is never lost, even on network failure.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { updateSessionNotes } from "@/lib/api";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import { secsToHM } from "@/lib/time";
import type { TimeSession } from "@/lib/types";

export function SessionNotesModal({
  session,
  projectName,
  mode = "create",
  onClose,
}: {
  session: TimeSession | null; // the target session; null = modal closed
  projectName: string;
  mode?: "create" | "edit"; // create = right after stopping; edit = later
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setNotes(mode === "edit" ? session.notes ?? "" : "");
      setErr(null);
    }
  }, [session, mode]);

  if (!session) return null;

  async function save() {
    if (!session) return;
    if (mode === "create" && !notes.trim()) {
      onClose(); // nothing to attach
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await track(updateSessionNotes(session.id, notes));
      toast.success(mode === "edit" ? "Notes updated" : "Notes saved");
      onClose();
    } catch (e) {
      const msg = friendlyError(e);
      setErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "edit" ? "Edit work notes" : "Session stopped — add work notes"}
    >
      <p className="muted mb-3 text-sm">
        <span className="font-medium" style={{ color: "var(--text)" }}>
          {projectName}
        </span>{" "}
        · {secsToHM(session.duration_seconds ?? 0)} recorded.
        {mode === "create" && " Your time is already saved."}
      </p>
      <textarea
        autoFocus
        className="input min-h-[110px]"
        placeholder="What did you work on? (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {err && <p className="mt-2 text-sm text-red-500">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          {mode === "edit" ? "Cancel" : "Skip"}
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          {mode === "edit" ? "Update notes" : "Save session notes"}
        </button>
      </div>
    </Modal>
  );
}

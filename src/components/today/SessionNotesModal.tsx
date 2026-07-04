"use client";

// Notes-after-stop: the timer is stopped FIRST (so no time accrues while the
// user types), then this modal captures optional work notes and attaches them
// to the just-closed session. Skipping keeps the session — time is never lost.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { updateSessionNotes } from "@/lib/api";
import { track } from "@/lib/sync";
import { secsToHM } from "@/lib/time";
import type { TimeSession } from "@/lib/types";

export function SessionNotesModal({
  session,
  projectName,
  onClose,
}: {
  session: TimeSession | null; // the just-stopped session; null = closed
  projectName: string;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session) {
      setNotes("");
      setErr(null);
    }
  }, [session]);

  if (!session) return null;

  async function save() {
    if (!session) return;
    if (!notes.trim()) {
      onClose(); // nothing to attach
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await track(updateSessionNotes(session.id, notes));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save notes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Session stopped — add work notes">
      <p className="muted mb-3 text-sm">
        <span className="font-medium" style={{ color: "var(--text)" }}>
          {projectName}
        </span>{" "}
        · {secsToHM(session.duration_seconds ?? 0)} recorded. Your time is already saved.
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
          Skip
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          Save session notes
        </button>
      </div>
    </Modal>
  );
}

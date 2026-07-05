"use client";

// Manual time REQUEST — never edits official time directly. The entry only
// becomes a real session when the admin approves it.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { submitTimeEntryRequest } from "@/lib/api";
import { track } from "@/lib/sync";
import { toast } from "@/lib/toast";
import { friendlyError } from "@/lib/errors";
import { localDateKey } from "@/lib/time";
import type { Project } from "@/lib/types";

export function ManualTimeModal({
  open,
  onClose,
  onSubmitted,
  projects,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  projects: Project[];
}) {
  const [projectId, setProjectId] = useState("");
  const [date, setDate] = useState(() => localDateKey());
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProjectId(projects[0]?.id ?? "");
      setDate(localDateKey());
      setStart("09:00");
      setEnd("10:00");
      setReason("");
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit() {
    setErr(null);
    if (!projectId) {
      setErr("Please choose a project.");
      return;
    }
    const startDt = new Date(`${date}T${start}`);
    const endDt = new Date(`${date}T${end}`);
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime())) {
      setErr("Please fill in the date and times.");
      return;
    }
    if (endDt <= startDt) {
      setErr("End time must be after start time.");
      return;
    }
    if (endDt.getTime() > Date.now()) {
      setErr("Manual entries must be in the past.");
      return;
    }
    if (!reason.trim()) {
      setErr("Please add a short reason so the admin can review it.");
      return;
    }
    setBusy(true);
    try {
      await track(
        submitTimeEntryRequest({
          projectId,
          startIso: startDt.toISOString(),
          endIso: endDt.toISOString(),
          reason: reason.trim(),
        }),
      );
      toast.success("Manual time request submitted");
      onSubmitted();
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
    <Modal open={open} onClose={onClose} title="Request manual time">
      <p className="muted mb-3 text-sm">
        Forgot to start the timer? Submit the missed block — it counts only after the administrator
        approves it.
      </p>
      <div className="space-y-3">
        <div>
          <label className="label">Project</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Start</label>
            <input type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="label">End</label>
            <input type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Reason</label>
          <textarea
            className="input min-h-[70px]"
            placeholder="e.g. Site visit — forgot to start the timer"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>
      {err && <p className="mt-2 text-sm text-red-500">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 size={16} className="animate-spin" />}
          Submit request
        </button>
      </div>
    </Modal>
  );
}

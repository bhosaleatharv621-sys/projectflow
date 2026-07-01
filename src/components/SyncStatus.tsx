"use client";

import { Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { useSyncState } from "@/lib/sync";

export function SyncStatus() {
  const { state } = useSyncState();

  const map = {
    synced: { icon: <Cloud size={15} />, text: "Synced", cls: "text-emerald-500" },
    syncing: { icon: <Loader2 size={15} className="animate-spin" />, text: "Syncing…", cls: "text-brand" },
    offline: { icon: <CloudOff size={15} />, text: "Offline", cls: "text-amber-500" },
    error: { icon: <TriangleAlert size={15} />, text: "Sync error", cls: "text-red-500" },
  } as const;

  const s = map[state];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.cls}`} title="Sync status">
      {s.icon}
      <span className="hidden sm:inline">{s.text}</span>
    </span>
  );
}

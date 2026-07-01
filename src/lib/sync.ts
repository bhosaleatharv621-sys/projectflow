"use client";

// A tiny global sync-status signal. Write helpers wrap DB calls in
// track(promise); the SyncStatus indicator subscribes to reflect state.
// This is an honest indicator of in-flight writes + online/offline — not a
// full offline queue (that's a Phase 2 enhancement).

import { useSyncExternalStore } from "react";

export type SyncState = "synced" | "syncing" | "offline" | "error";

let inFlight = 0;
let lastError = false;
let lastSyncedAt: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function online(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function getSyncState(): SyncState {
  if (!online()) return "offline";
  if (inFlight > 0) return "syncing";
  if (lastError) return "error";
  return "synced";
}

export function getLastSyncedAt(): number | null {
  return lastSyncedAt;
}

/** Wrap any write/read promise so the indicator reflects it. */
export async function track<T>(p: Promise<T>): Promise<T> {
  inFlight += 1;
  lastError = false;
  emit();
  try {
    const r = await p;
    lastSyncedAt = Date.now();
    return r;
  } catch (e) {
    lastError = true;
    throw e;
  } finally {
    inFlight -= 1;
    emit();
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onNet = () => emit();
  window.addEventListener("online", onNet);
  window.addEventListener("offline", onNet);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("online", onNet);
    window.removeEventListener("offline", onNet);
  };
}

export function useSyncState(): { state: SyncState; lastSyncedAt: number | null } {
  const state = useSyncExternalStore(subscribe, getSyncState, () => "synced" as SyncState);
  const at = useSyncExternalStore(subscribe, getLastSyncedAt, () => null);
  return { state, lastSyncedAt: at };
}

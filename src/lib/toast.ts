"use client";

// Minimal global toast store (same useSyncExternalStore pattern as sync.ts —
// no dependency). Fire-and-forget: toast.success("Timer started").

import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function push(kind: Toast["kind"], message: string) {
  const t: Toast = { id: nextId++, kind, message };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    emit();
  }, 3500);
}

export const toast = {
  success(message: string) {
    push("success", message);
  },
  error(message: string) {
    push("error", message);
  },
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts, () => toasts);
}

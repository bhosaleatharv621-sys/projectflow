"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useToasts } from "@/lib/toast";

/** Bottom-centered toast stack; mounted once in the AppShell. */
export function Toaster() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="card pointer-events-auto flex max-w-sm items-center gap-2 px-4 py-2.5 text-sm shadow-lg"
          role="status"
        >
          {t.kind === "success" ? (
            <CheckCircle2 size={16} className="shrink-0 text-emerald-500" />
          ) : (
            <TriangleAlert size={16} className="shrink-0 text-red-500" />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

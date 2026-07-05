"use client";

// First-use guidance card on the Today page. Deliberately simple: a short
// role-specific checklist, dismissible (persisted in localStorage). Admin
// steps check themselves off as the workspace fills in.

import { useEffect, useState } from "react";
import Link from "next/link";
import { X, CheckCircle2, Circle, Lightbulb } from "lucide-react";

interface Step {
  label: string;
  done?: boolean;
  href?: string;
}

export function OnboardingCard({
  role,
  steps,
}: {
  role: "admin" | "employee";
  steps: Step[];
}) {
  const storageKey = `pf_onboarding_dismissed_${role}`;
  const [dismissed, setDismissed] = useState(true); // avoid flash before read

  useEffect(() => {
    setDismissed(window.localStorage.getItem(storageKey) === "1");
  }, [storageKey]);

  if (dismissed) return null;

  function dismiss() {
    window.localStorage.setItem(storageKey, "1");
    setDismissed(true);
  }

  return (
    <div className="card mb-5 p-4" style={{ borderColor: "color-mix(in srgb, var(--brand) 35%, transparent)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb size={15} className="text-brand" />
          {role === "admin" ? "Get your workspace ready" : "How to track your time"}
        </p>
        <button className="rounded-lg p-1 muted hover:bg-[var(--surface-2)]" onClick={dismiss} aria-label="Dismiss">
          <X size={15} />
        </button>
      </div>
      <ol className="mt-2.5 space-y-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            {s.done ? (
              <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
            ) : (
              <Circle size={15} className="muted shrink-0" />
            )}
            {s.href && !s.done ? (
              <Link href={s.href} className="text-brand hover:underline">
                {s.label}
              </Link>
            ) : (
              <span className={s.done ? "muted line-through" : ""}>{s.label}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

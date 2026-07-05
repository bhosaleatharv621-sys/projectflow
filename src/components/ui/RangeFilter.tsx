"use client";

import { RANGE_LABELS, type RangeKey } from "@/lib/time";

const ORDER: RangeKey[] = ["today", "week", "month", "year", "all"];

/** Today / Week / Month / Year / All pills, shared by Team + Reports.
 *  value null = none highlighted (e.g. a custom range is active). */
export function RangeFilter({
  value,
  onChange,
}: {
  value: RangeKey | null;
  onChange: (r: RangeKey) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-[var(--surface-2)] p-1 text-sm">
      {ORDER.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`rounded-lg px-3.5 py-1.5 font-medium transition ${
            value === r ? "bg-[var(--surface)] shadow" : "muted"
          }`}
        >
          {RANGE_LABELS[r]}
        </button>
      ))}
    </div>
  );
}

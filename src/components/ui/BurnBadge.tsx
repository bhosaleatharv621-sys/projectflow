import type { BurnStatus } from "@/lib/time";

const TONE_STYLES: Record<string, { bg: string; fg: string }> = {
  green: { bg: "rgba(5,150,105,0.14)", fg: "#059669" },
  amber: { bg: "rgba(217,119,6,0.16)", fg: "#b45309" },
  red: { bg: "rgba(220,38,38,0.14)", fg: "#dc2626" },
};

/** On-time / behind-schedule pill. Renders nothing when there's no deadline. */
export function BurnBadge({ status }: { status: BurnStatus }) {
  if (status.tone === "none" || !status.label) return null;
  const s = TONE_STYLES[status.tone] ?? TONE_STYLES.green;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ background: s.bg, color: s.fg }}
    >
      {status.label}
    </span>
  );
}

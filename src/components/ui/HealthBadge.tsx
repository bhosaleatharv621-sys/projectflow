import type { ProjectHealth } from "@/lib/time";

/** Worked-vs-target status pill (Not started / In progress / Near target /
 *  Over target / Completed). Admin-facing — derived from completion %. */
export function HealthBadge({ health }: { health: ProjectHealth }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{
        background: `color-mix(in srgb, ${health.color} 13%, transparent)`,
        color: health.color,
      }}
    >
      {health.label}
    </span>
  );
}

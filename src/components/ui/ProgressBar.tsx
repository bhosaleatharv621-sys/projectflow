export function ProgressBar({
  percent,
  color = "var(--brand)",
  height = 8,
}: {
  percent: number; // may exceed 100; fill is capped visually
  color?: string;
  height?: number;
}) {
  const fill = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, background: "var(--surface-2)" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${fill}%`, background: color }}
      />
    </div>
  );
}

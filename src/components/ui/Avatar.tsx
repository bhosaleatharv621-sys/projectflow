import { CATEGORY_COLORS } from "@/lib/constants";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
}

/** Initials avatar with a deterministic per-name accent color. */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.38)),
        background: colorFor(name || "?"),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

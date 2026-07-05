/** Simple shimmering placeholder blocks for loading states. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl ${className}`}
      style={{ background: "var(--surface-2)" }}
    />
  );
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card space-y-2.5 p-4">
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3 w-full" />
      ))}
    </div>
  );
}

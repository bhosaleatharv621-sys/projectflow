// Friendly error messages: users should never see raw RLS/policy jargon.

export function friendlyError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const lower = raw.toLowerCase();

  if (
    lower.includes("row-level security") ||
    lower.includes("row level security") ||
    lower.includes("permission denied") ||
    lower.includes("violates") ||
    lower.includes("policy")
  ) {
    return "You do not have permission to perform this action.";
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return "Network problem — please check your connection and try again.";
  }
  if (!raw) return "Something went wrong. Please try again.";
  return raw;
}

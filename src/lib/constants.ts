// App-wide constants. Currency symbol is a single easily-changed value
// (Assumption #4: default to INR). A user override lives in Settings and is
// read from localStorage at runtime via currencySymbol().

export const DEFAULT_CURRENCY = "₹"; // ₹

export function currencySymbol(): string {
  if (typeof window === "undefined") return DEFAULT_CURRENCY;
  return window.localStorage.getItem("pf_currency") || DEFAULT_CURRENCY;
}

export function setCurrencySymbol(sym: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("pf_currency", sym || DEFAULT_CURRENCY);
}

// Curated lucide icon keys offered when creating a category.
export const CATEGORY_ICONS = [
  "Folder",
  "Briefcase",
  "Code",
  "PenTool",
  "Palette",
  "GraduationCap",
  "BookOpen",
  "Cpu",
  "Zap",
  "Building2",
  "Rocket",
  "Globe",
  "Camera",
  "Music",
  "Film",
  "Heart",
  "Home",
  "ShoppingCart",
  "Wrench",
  "Beaker",
  "Bug",
  "Brain",
  "LineChart",
  "Wallet",
  "Users",
  "Coffee",
  "Dumbbell",
  "Leaf",
  "Star",
  "Flag",
  "Target",
  "Layers",
  "Database",
  "Server",
  "Smartphone",
  "Megaphone",
] as const;

// Accent swatches. Used consistently for a category everywhere it appears.
export const CATEGORY_COLORS = [
  "#4f46e5", // indigo
  "#0ea5e9", // sky
  "#059669", // emerald
  "#d97706", // amber
  "#dc2626", // red
  "#db2777", // pink
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#65a30d", // lime
  "#e11d48", // rose
] as const;

export const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};

"use client";

import { useEffect, useState } from "react";
import { Download, LogOut, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SyncStatus } from "@/components/SyncStatus";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { currencySymbol, setCurrencySymbol } from "@/lib/constants";
import { listCategories, listMembers, listProjects, listSessionsSince } from "@/lib/api";
import { downloadText, sessionsToCsv } from "@/lib/export";
import { todayKey } from "@/lib/time";

type Theme = "light" | "dark" | "auto";

export default function SettingsPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [currency, setCurrency] = useState("₹");
  const [theme, setTheme] = useState<Theme>("auto");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
    setCurrency(currencySymbol());
    setTheme((localStorage.getItem("pf_theme") as Theme) ?? "auto");
  }, []);

  function applyTheme(t: Theme) {
    setTheme(t);
    localStorage.setItem("pf_theme", t);
    const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  }

  function saveCurrency(v: string) {
    setCurrency(v);
    setCurrencySymbol(v);
  }

  async function exportAll() {
    setExporting(true);
    try {
      const [p, c, s, m] = await Promise.all([
        listProjects(),
        listCategories(),
        listSessionsSince(null, 10000),
        listMembers(),
      ]);
      downloadText(`projectflow-sessions-${todayKey()}.csv`, sessionsToCsv(s, p, c, m));
    } finally {
      setExporting(false);
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="space-y-3">
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Account</h2>
          <p className="muted text-sm">{email || "—"}</p>
          <button className="btn btn-ghost mt-3" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Sync</h2>
          <SyncStatus />
          <p className="muted mt-2 text-xs">
            Every device talks to the same cloud database, scoped privately to your account.
          </p>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Preferences</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Currency symbol</label>
              <input
                className="input max-w-[120px]"
                value={currency}
                maxLength={3}
                onChange={(e) => saveCurrency(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Theme</label>
              <div className="inline-flex gap-1 rounded-xl bg-[var(--surface-2)] p-1 text-sm">
                {(["light", "dark", "auto"] as Theme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => applyTheme(t)}
                    className={`rounded-lg px-3 py-1.5 font-medium capitalize transition ${
                      theme === t ? "bg-[var(--surface)] shadow" : "muted"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">Data</h2>
          <button className="btn btn-ghost" onClick={exportAll} disabled={exporting}>
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            Export all sessions (CSV)
          </button>
        </section>
      </div>
    </div>
  );
}

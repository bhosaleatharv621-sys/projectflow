"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type Mode = "signin" | "signup" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const configured = isSupabaseConfigured();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    setBusy(true);
    const supabase = createClient();
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        setMsg("Check your email for a sign-in link.");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (error) throw error;
        setMsg("Account created. Check your email to confirm, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/today");
        router.refresh();
        return;
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
            <Clock size={28} />
          </div>
          <h1 className="text-2xl font-bold">ProjectFlow</h1>
          <p className="muted mt-1 text-sm">Your personal project time tracker.</p>
        </div>

        {!configured && (
          <div className="card mb-4 border-amber-400 p-4 text-sm">
            <p className="font-semibold text-amber-600">Supabase isn&apos;t connected yet.</p>
            <p className="muted mt-1">
              Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code> and run the SQL
              in <code>supabase/schema.sql</code>. See the README.
            </p>
          </div>
        )}

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div className="flex gap-1 rounded-xl bg-[var(--surface-2)] p-1 text-sm">
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Sign up"],
                ["magic", "Magic link"],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setErr(null);
                  setMsg(null);
                }}
                className={`flex-1 rounded-lg py-1.5 font-medium transition ${
                  mode === m ? "bg-[var(--surface)] shadow" : "muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <label className="label">Email</label>
            <input
              type="email"
              required
              autoComplete="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {mode !== "magic" && (
            <div>
              <label className="label">Password</label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          )}

          {err && <p className="text-sm text-red-500">{err}</p>}
          {msg && <p className="text-sm text-emerald-500">{msg}</p>}

          <button type="submit" disabled={busy} className="btn btn-primary w-full">
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send link"}
          </button>
        </form>

        <p className="muted mt-4 text-center text-xs">
          Single-user tool. Your data is scoped privately to your account.
        </p>
      </div>
    </main>
  );
}

"use client";

// Shown instead of the app to any signed-in account WITHOUT an approved
// members row. This is presentation only — RLS independently returns zero
// org rows to non-members, so even a hand-crafted API call sees nothing.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Hourglass, ShieldX, LogOut, RefreshCw, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { requestAccess } from "@/lib/api";
import type { JoinRequestStatus } from "@/lib/types";

export function AccessGate({
  status,
  email,
  orgName,
  deactivated = false,
}: {
  status: JoinRequestStatus | null; // null = no request on file yet
  email: string;
  orgName: string;
  deactivated?: boolean; // approved member whose account was deactivated
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function submitRequest() {
    setBusy(true);
    setErr(null);
    try {
      await requestAccess();
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not submit the request.");
    } finally {
      setBusy(false);
    }
  }

  const rejected = !deactivated && status === "rejected";
  const blocked = deactivated || rejected; // terminal states: no self-service

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-5 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
            <Clock size={28} />
          </div>
          <h1 className="text-xl font-bold">ProjectFlow</h1>
          <p className="muted mt-0.5 text-sm">{orgName}</p>
        </div>

        <div className="card p-6">
          <div
            className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${
              blocked ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500"
            }`}
          >
            {blocked ? <ShieldX size={24} /> : <Hourglass size={24} />}
          </div>

          {deactivated ? (
            <>
              <p className="font-semibold">Your account has been deactivated.</p>
              <p className="muted mt-1 text-sm">Please contact the administrator.</p>
            </>
          ) : rejected ? (
            <>
              <p className="font-semibold">Your access request was rejected.</p>
              <p className="muted mt-1 text-sm">Please contact the administrator.</p>
            </>
          ) : status === "pending" || status === "approved" ? (
            <>
              <p className="font-semibold">Your access request is pending admin approval.</p>
              <p className="muted mt-1 text-sm">
                The administrator has been notified. Check back once your request is approved.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold">You&apos;re not part of the organization yet.</p>
              <p className="muted mt-1 text-sm">
                Send an access request for the administrator to review.
              </p>
            </>
          )}

          <p className="muted mt-3 text-xs">Signed in as {email}</p>
          {err && <p className="mt-2 text-sm text-red-500">{err}</p>}

          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {status === null && !blocked && (
              <button className="btn btn-primary" onClick={submitRequest} disabled={busy}>
                {busy && <Loader2 size={15} className="animate-spin" />}
                Request access
              </button>
            )}
            {!rejected && (
              <button className="btn btn-ghost" onClick={() => router.refresh()}>
                <RefreshCw size={15} /> Check again
              </button>
            )}
            <button className="btn btn-ghost" onClick={signOut}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

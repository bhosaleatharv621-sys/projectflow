"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarDays,
  FolderKanban,
  BarChart3,
  Settings,
  LogOut,
  Clock,
  Users,
  Briefcase,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMyOpenSession, listPendingRequests } from "@/lib/api";
import { SyncStatus } from "./SyncStatus";
import { Toaster } from "./Toaster";
import type { MemberInfo } from "./MemberProvider";

// Team + Projects are for everyone; Categories management is admin-only and
// lives in the desktop sidebar (mobile reaches it from the Projects page).
const NAV = [
  { href: "/today", label: "Today", icon: CalendarDays },
  { href: "/projects", label: "Projects", icon: Briefcase },
  { href: "/team", label: "Team", icon: Users },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ member, children }: { member: MemberInfo; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = member.role === "admin";

  // Live nav badges: pending-request count (admin) + my-running-timer dot.
  const [pendingCount, setPendingCount] = useState(0);
  const [hasRunning, setHasRunning] = useState(false);

  const refreshBadges = useCallback(async () => {
    try {
      const [open, pend] = await Promise.all([
        getMyOpenSession(member.userId),
        isAdmin ? listPendingRequests() : Promise.resolve([]),
      ]);
      setHasRunning(!!open);
      setPendingCount(pend.length);
    } catch {
      // badges are cosmetic — never break the shell over them
    }
  }, [member.userId, isAdmin]);

  useEffect(() => {
    refreshBadges();
    const supabase = createClient();
    const channel = supabase
      .channel("shell-badges")
      .on("postgres_changes", { event: "*", schema: "public", table: "time_sessions" }, refreshBadges)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "organization_join_requests" },
        refreshBadges,
      )
      .subscribe();
    const onFocus = () => refreshBadges();
    window.addEventListener("focus", onFocus);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshBadges]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function navBadge(href: string) {
    if (href === "/today" && hasRunning) {
      return <span className="h-2 w-2 animate-pulseSoft rounded-full bg-emerald-500" aria-label="Timer running" />;
    }
    if (href === "/team" && isAdmin && pendingCount > 0) {
      return (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600">
          {pendingCount}
        </span>
      );
    }
    return null;
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const navItems = isAdmin
    ? [...NAV.slice(0, 2), { href: "/categories", label: "Categories", icon: FolderKanban }, ...NAV.slice(2)]
    : NAV;

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r p-4 md:flex"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
            <Clock size={18} />
          </div>
          <div className="min-w-0">
            <span className="block text-lg font-bold leading-tight">ProjectFlow</span>
            <span className="muted block truncate text-[11px]" title={member.orgName}>
              {member.orgName}
            </span>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                isActive(href) ? "bg-brand/10 text-brand" : "muted hover:bg-[var(--surface-2)]"
              }`}
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {navBadge(href)}
            </Link>
          ))}
        </nav>

        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 px-2">
            <SyncStatus />
          </div>
          <p className="truncate px-2 text-sm font-medium" title={member.displayName}>
            {member.displayName}
            <span className="muted ml-1.5 text-xs font-normal capitalize">({member.role})</span>
          </p>
          <p className="truncate px-2 text-xs muted" title={member.email}>
            {member.email}
          </p>
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium muted hover:bg-[var(--surface-2)]"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header
          className="sticky top-0 z-30 flex items-center justify-between border-b px-4 py-3 md:hidden"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
              <Clock size={16} />
            </div>
            <div className="min-w-0">
              <span className="block font-bold leading-tight">ProjectFlow</span>
              <span className="muted block truncate text-[10px]">{member.orgName}</span>
            </div>
          </div>
          <SyncStatus />
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-5 md:px-8 md:pb-10">
          {children}
        </main>
      </div>

      <Toaster />

      {/* Mobile bottom tab bar (5 core destinations for everyone) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t md:hidden"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium ${
              isActive(href) ? "text-brand" : "muted"
            }`}
          >
            <span className="relative">
              <Icon size={20} />
              <span className="absolute -right-2 -top-1">{navBadge(href)}</span>
            </span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

"use client";

// PERF + correctness: the caller's identity (user id, org, role, name) is
// resolved ONCE per page load in the server layout and provided here, instead
// of every data helper making its own auth.getUser() network call. Role also
// drives which affordances render — the database still enforces everything.

import { createContext, useContext } from "react";
import type { Role } from "@/lib/types";

export interface MemberInfo {
  userId: string;
  email: string;
  organizationId: string;
  orgName: string;
  role: Role;
  displayName: string;
}

const MemberContext = createContext<MemberInfo | null>(null);

export function MemberProvider({
  value,
  children,
}: {
  value: MemberInfo;
  children: React.ReactNode;
}) {
  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export function useMember(): MemberInfo {
  const ctx = useContext(MemberContext);
  if (!ctx) throw new Error("useMember must be used inside MemberProvider");
  return ctx;
}

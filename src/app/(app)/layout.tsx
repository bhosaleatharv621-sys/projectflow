import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/AppShell";
import { AccessGate } from "@/components/AccessGate";
import { MemberProvider, type MemberInfo } from "@/components/MemberProvider";
import type { JoinRequestStatus, Role } from "@/lib/types";

interface MembershipRow {
  user_id: string;
  organization_id: string;
  role: Role;
  display_name: string;
  organizations: { name: string } | { name: string }[] | null;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Resolve membership ONCE per request; every client component reads it from
  // context instead of re-asking the network (see MemberProvider).
  const { data } = await supabase
    .from("members")
    .select("user_id, organization_id, role, display_name, organizations(name)")
    .eq("user_id", user.id)
    .maybeSingle();

  const row = data as MembershipRow | null;

  if (!row) {
    // No approved membership: this account is outside the organization.
    // Show the access gate (pending / rejected / request-access) — the
    // dashboard, projects, team, and reports never render, and RLS returns
    // zero org rows to this account anyway.
    const [{ data: reqRow }, { data: orgRow }] = await Promise.all([
      supabase
        .from("organization_join_requests")
        .select("status")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("organizations").select("name").limit(1).maybeSingle(),
    ]);

    return (
      <AccessGate
        status={(reqRow?.status as JoinRequestStatus | undefined) ?? null}
        email={user.email ?? ""}
        orgName={
          (orgRow as { name: string } | null)?.name ??
          "ESS – Electric Sciences & Solutions Pvt. Ltd."
        }
      />
    );
  }

  const orgRel = row.organizations;
  const orgName = Array.isArray(orgRel) ? orgRel[0]?.name ?? "" : orgRel?.name ?? "";

  const member: MemberInfo = {
    userId: row.user_id,
    email: user.email ?? "",
    organizationId: row.organization_id,
    orgName,
    role: row.role,
    displayName: row.display_name,
  };

  return (
    <MemberProvider value={member}>
      <AppShell member={member}>{children}</AppShell>
    </MemberProvider>
  );
}

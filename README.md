# ProjectFlow — Organization Time Tracking Platform

Time tracking for **ESS – Electric Sciences & Solutions Pvt. Ltd.** One organization, one administrator (**Prasad Gore**), any number of employees. Built with **Next.js 14 (App Router) + TypeScript + Tailwind + Supabase**; all authorization is enforced in Postgres with Row-Level Security — the UI only decides what to *show*, the database decides what is *allowed*.

## Roles

| Capability | Admin | Employee |
|---|---|---|
| Create / edit / delete categories & projects | ✓ | ✗ (blocked by RLS) |
| Browse & search org projects | ✓ | ✓ |
| Start / pause / resume / stop timers | ✓ | ✓ |
| Work notes when stopping a timer | ✓ | ✓ |
| See colleagues' time | everyone's | everyone's **except the admin's** (RLS-enforced) |
| Project completion (worked / target / %) | ✓ | ✗ (not rendered; true totals unobtainable — admin sessions are invisible to employees) |

**The admin is data, not code.** Exactly one admin per org is enforced by a partial unique index. The **first account to sign up becomes the admin** (seeded display name "Prasad Gore"). **Every later signup creates a *pending access request*** — it appears in the admin's Team page, where the admin approves (user joins as employee) or rejects it. Until approved, the account sees only a "pending approval" screen and RLS returns zero organization rows to it. Role changes are blocked through the API by a trigger — changing the admin is a deliberate act in the Supabase SQL editor:

```sql
update members set role = 'employee' where role = 'admin';
update members set role = 'admin' where user_id = '<new-admin-user-id>';
```

## Setup

1. `npm install`
2. Create a [Supabase](https://supabase.com) project (Mumbai / `ap-south-1` recommended for India — region latency was a large part of slow writes).
3. **SQL Editor → run in order:**
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_organizations.sql`
   - `supabase/migrations/0003_member_approval_flow.sql`
   - `supabase/migrations/0004_member_deactivation.sql`
   - `supabase/migrations/0005_audit_log.sql`
   - `supabase/migrations/0006_manual_time_requests.sql`
   (Existing installs run only the migrations they haven't applied yet — every one is additive and preserves data: `0002` backfills rows into the organization, `0003` adds the approval flow, `0004` adds member deactivation, `0005` the audit log, `0006` manual time requests.)
4. `cp .env.local.example .env.local` and fill in Project Settings → API values.
5. Supabase → Authentication → URL Configuration: add `http://localhost:3000/auth/callback` (and your production callback).
6. `npm run dev` → **Prasad Gore signs up first** (becomes admin) → employees sign up after and wait on the pending screen until the admin approves them from **Team → Pending access requests**.

## Screens

- **Today** — personal timer workspace. One live timer per person (server-enforced); Stop opens the **work-notes modal** (time is saved first, notes attach after — skippable, never lossy).
- **Projects** — org-wide browser with instant search (in-memory over one small query) + category/sort filters. Admin: create/edit/delete, live completion bars, link to Categories management.
- **Team** — who's working right now (live, ticking), time per person, recent sessions with notes; filtered by **Today / Week / Month / Year / All**. Employees never receive the admin's rows.
- **Reports** — range-filtered totals per project + CSV export; admin additionally sees the completion table (worked / target / % / remaining).
- **Settings** — currency, theme, full CSV export, sign out.

## Architecture notes

- `supabase/migrations/0002_organizations.sql` — organizations, members, role-aware RLS, timer RPCs, aggregate view/RPCs, indexes, signup trigger, escalation guard.
- `src/lib/api.ts` — all data access. Writes are single round-trips (identity comes from `auth.uid()` / `current_org_id()` column defaults — no `getUser()` pre-flight). Reads are range-bounded or pre-aggregated (`project_totals` view, `session_*_totals` RPCs) — the client never downloads unbounded session history.
- `src/components/MemberProvider.tsx` — identity/role resolved once per page load in the server layout, consumed everywhere via `useMember()`.
- `src/lib/time.ts` — timer math + range helpers. A cycle belongs to the local day it started.

```
npm run dev / build / lint / typecheck
```

## Known limitations

- Employees can technically read `projects.target_hours` via the API (column-level hiding isn't possible with a single Postgres role); however they can never reconstruct completion %, because the admin's sessions are RLS-invisible to them, so org-wide worked totals are unobtainable. UI never renders these values for employees.
- Anyone can still *sign up* and file an access request (they see nothing until approved); to stop even that, disable public signups in Supabase Auth settings.
- `legacy/index.html` is the original single-user prototype, kept for reference.

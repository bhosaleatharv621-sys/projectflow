# ProjectFlow — Personal Cross-Device Project Time Tracker

A personal, single-user time tracker built around a **Category → Project → Today's Timetable → Work Session** workflow. Organize a large batch of projects, curate a short "Today" list each morning, run **one live timer at a time**, and see exactly where your time goes.

Built with **Next.js (App Router) + TypeScript + Tailwind + Supabase**. Data lives in cloud Postgres scoped privately to your account (Row-Level Security), so every device — phone, tablet, laptop — stays in sync.

> **Status: Phase 1 (core).** Auth, Categories CRUD, Projects CRUD, and Today's Timetable with the single-active-timer rule are implemented, plus a basic Reports view and CSV export. Realtime cross-device reflection and a sync-status indicator are wired in. Richer analytics (Recharts, heatmap, weekly stacked bars), Excel export, offline queue, and PWA polish are later phases — see the roadmap.

---

## 1. What works today

- **Auth** — email/password or magic link (Supabase Auth). Single account, no teams.
- **Categories** — unlimited, each with a lucide icon + accent color used consistently everywhere.
- **Projects** — number (auto-suggested, editable), name, cost (₹ by default), target hours, optional deadline, notes. Fast **"Save & add another"** flow for bulk entry.
- **Today's Timetable** — curate the day via global search + multi-select; one card per project.
- **Single active timer** — starting a project auto-pauses whatever was running, enforced **server-side** in one transaction (`start_session` RPC) so two devices can't disagree.
- **Pause vs. Stop** — both save your time (non-destructive). Pause is resumable; Stop returns the card to idle and the next Start begins a fresh cycle at 0:00.
- **Live metrics** — today's contribution, total vs. target, % complete, and an **on-time / behind-schedule** badge (only when a deadline is set).
- **Today's cycles** — expand a card to see each start–end chunk for the day.
- **Project detail** — full session history, remaining hours, a plain-language pace tip, edit / mark complete / delete.
- **Reports** — Today / This-week totals, time-by-project bars, CSV export.
- **Sync status indicator** + Realtime subscriptions for live cross-device updates.

## 2. Business logic (implemented exactly)

See `src/lib/time.ts`:

- `elapsed = now − session.start_time` (computed client-side; **never** written per-tick).
- `todayContribution = Σ(durations of sessions started today) + live elapsed if open today`.
- `totalSpent = Σ(all session durations) + live elapsed if running`.
- `percentComplete = totalSpent(hours) / target_hours` (allowed to exceed 100%; the bar fill is capped visually).
- **On-time badge:** `expectedProgress = clamp(daysElapsed / totalDays, 0, 1)`; on track when `percentComplete ≥ expectedProgress`; amber when on track but the deadline is near with a thin buffer; red when behind or overdue.

**Timezone rule:** everything uses the device's local timezone, and a cycle belongs to the local calendar day it **started** on (so an 11:58pm→12:05am session counts entirely toward the start day).

---

## 3. Setup

### Prerequisites
- Node 18+ (tested on Node 22)
- A free [Supabase](https://supabase.com) project

### a. Install
```bash
npm install
```

### b. Create the database
In your Supabase project: **SQL Editor → New query**, paste the contents of
[`supabase/schema.sql`](supabase/schema.sql), and run it. This creates the four
tables, Row-Level Security policies, the atomic timer RPCs, and enables Realtime.

### c. Configure environment
```bash
cp .env.local.example .env.local
```
Fill in from **Supabase → Project Settings → API**:
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-public-key>
```

### d. (Auth) redirect URLs
In **Supabase → Authentication → URL Configuration**, add your site URL and
`http://localhost:3000/auth/callback` (and your production
`https://<domain>/auth/callback`) to the redirect allow-list. For quick local
testing you can disable "Confirm email" under Authentication → Providers → Email.

### e. Run
```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint
npm run typecheck
```

If Supabase env vars are missing, the app still builds and the login screen
shows a "connect Supabase" notice instead of crashing.

### Deploy
Deploy to **Vercel**, set the two `NEXT_PUBLIC_*` env vars in the project
settings, and add the production `/auth/callback` redirect URL in Supabase.

---

## 4. Data model

| Table | Purpose |
|---|---|
| `categories` | user-defined containers (name, icon, color) |
| `projects` | number, name, cost, target_hours, deadline, status, notes |
| `time_sessions` | one cycle: `start_time` → `end_time` + `duration_seconds` |
| `daily_selections` | which projects are on Today's Timetable for a given local day |

All derived values (today's contribution, total spent, % complete, burn status)
are computed from `time_sessions` — never stored redundantly, to avoid drift.

### Single-active-timer (server-side)
`start_session(project_id)` runs in one transaction: close any open session for
the user (Pause semantics), then open a fresh session for the requested project.
`stop_active_session()` closes the caller's open session. Both are
`SECURITY DEFINER` and re-assert `auth.uid()`.

---

## 5. Project structure
```
supabase/schema.sql          Postgres schema, RLS, atomic timer RPCs
src/
  app/
    login/                   auth (email/password + magic link)
    auth/callback/           code exchange
    (app)/                   authenticated shell
      today/                 Today's Timetable (core)
      categories/            grid + [id] project list
      projects/[id]/         project detail + history
      reports/               totals + CSV export
      settings/              account, currency, theme, export
  components/                UI + feature components
  lib/
    time.ts                  all business-logic formulas
    api.ts                   typed Supabase data access
    supabase/                browser + server clients, env
    sync.ts                  sync-status signal
    export.ts                CSV generation
legacy/index.html            the original single-file prototype (kept for reference)
```

## 6. Roadmap (next phases)
- **Phase 2** — offline write queue + conflict resolution; harden resolve-on-load.
- **Phase 3** — Recharts analytics (donut, weekly stacked bars, contribution heatmap); Excel (.xlsx) export with a summary sheet.
- **Phase 4** — PWA installability (`next-pwa`), command palette (⌘K), carry-forward-yesterday toggle, drag-and-drop Today ordering, revision history.

Single-user by design: no teams, sharing, or client-facing features.

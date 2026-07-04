-- ============================================================================
-- ProjectFlow — Personal Cross-Device Project Time Tracker
-- Supabase / Postgres schema, Row-Level Security, and atomic timer RPCs.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL -> New query).
-- Everything is scoped to auth.uid() so a signed-in user only ever sees
-- their own rows. There are NO team / sharing / multi-user features by design.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  icon        text not null default 'Folder',      -- lucide icon key
  color       text not null default '#4f46e5',      -- hex accent, used in charts too
  created_at  timestamptz not null default now(),
  archived    boolean not null default false
);

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  category_id   uuid not null references public.categories (id) on delete cascade,
  project_number text not null,
  name          text not null,
  cost          numeric(14, 2),
  target_hours  numeric(10, 2) not null default 0,
  deadline      date,
  status        text not null default 'not_started'
                  check (status in ('not_started', 'in_progress', 'completed', 'on_hold')),
  notes         text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- One "cycle": a single Start -> Pause/Stop chunk.
create table if not exists public.time_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  start_time       timestamptz not null default now(),
  end_time         timestamptz,                 -- null while running
  duration_seconds integer                       -- computed + stored on close
);

-- Which projects are on "Today's Timetable" for a given local calendar day.
create table if not exists public.daily_selections (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  date        date not null,                    -- local calendar day (YYYY-MM-DD)
  position    integer not null default 0,        -- manual ordering within the day
  added_at    timestamptz not null default now(),
  removed_at  timestamptz,                       -- soft-remove if unlisted mid-day
  unique (user_id, project_id, date)
);

-- ---------------------------------------------------------------------------
-- Indexes (keep list/aggregation queries fast at ~100s of projects)
-- ---------------------------------------------------------------------------
create index if not exists idx_projects_user        on public.projects (user_id);
create index if not exists idx_projects_category     on public.projects (category_id);
create index if not exists idx_sessions_user         on public.time_sessions (user_id);
create index if not exists idx_sessions_project      on public.time_sessions (project_id);
create index if not exists idx_sessions_open         on public.time_sessions (user_id) where end_time is null;
create index if not exists idx_sessions_start        on public.time_sessions (start_time);
create index if not exists idx_daily_user_date       on public.daily_selections (user_id, date);

-- ---------------------------------------------------------------------------
-- Row-Level Security — every table is private to its owner.
-- ---------------------------------------------------------------------------
alter table public.categories       enable row level security;
alter table public.projects         enable row level security;
alter table public.time_sessions    enable row level security;
alter table public.daily_selections enable row level security;

-- categories
drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- projects
drop policy if exists "own projects" on public.projects;
create policy "own projects" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- time_sessions
drop policy if exists "own sessions" on public.time_sessions;
create policy "own sessions" on public.time_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- daily_selections
drop policy if exists "own daily selections" on public.daily_selections;
create policy "own daily selections" on public.daily_selections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Atomic timer functions.
--
-- These run as SECURITY DEFINER but re-assert auth.uid() so a user can only
-- ever act on their own data. The single-active-timer rule is enforced HERE,
-- in one transaction, so two devices can never both believe a different
-- project is "the" running one.
-- ---------------------------------------------------------------------------

-- Start (or resume) a cycle for `p_project_id`.
-- Step 1: close any other open session for this user (Pause semantics).
-- Step 2: open a fresh session for the requested project.
-- Returns the newly opened session row.
create or replace function public.start_session(p_project_id uuid)
returns public.time_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now  timestamptz := now();
  v_row  public.time_sessions;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  -- Make sure the project belongs to the caller.
  if not exists (
    select 1 from public.projects
    where id = p_project_id and user_id = v_user
  ) then
    raise exception 'Project not found for current user';
  end if;

  -- Close any currently-open session for this user (auto-pause the previous).
  update public.time_sessions
     set end_time = v_now,
         duration_seconds = greatest(0, extract(epoch from (v_now - start_time))::int)
   where user_id = v_user
     and end_time is null;

  -- If the requested project is already open (shouldn't happen after the close
  -- above, but guard anyway), the update handled it; open a new cycle now.
  insert into public.time_sessions (user_id, project_id, start_time)
  values (v_user, p_project_id, v_now)
  returning * into v_row;

  -- Reflect that work has begun on this project.
  update public.projects
     set status = case when status = 'not_started' then 'in_progress' else status end
   where id = p_project_id and user_id = v_user;

  return v_row;
end;
$$;

-- Stop / Pause: close the caller's open session (data effect is identical;
-- the UI distinguishes them). Returns the closed session, or null if none.
create or replace function public.stop_active_session()
returns public.time_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now  timestamptz := now();
  v_row  public.time_sessions;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  update public.time_sessions
     set end_time = v_now,
         duration_seconds = greatest(0, extract(epoch from (v_now - start_time))::int)
   where user_id = v_user
     and end_time is null
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.start_session(uuid)   to authenticated;
grant execute on function public.stop_active_session() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes so other open devices reflect them live.
-- (Safe to run repeatedly; ignore "already member" errors.)
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.time_sessions;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.daily_selections;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.projects;
  exception when duplicate_object then null;
  end;
end $$;

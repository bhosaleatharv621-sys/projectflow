-- ============================================================================
-- 0002 — Organization platform migration
--
-- Transforms the single-user tracker into a one-organization, role-based
-- platform for ESS – Electric Sciences & Solutions Pvt. Ltd.
--
--   * organizations / members (role: admin | employee)
--   * exactly ONE admin per organization (partial unique index)
--   * the admin is data, not code: seeded as "Prasad Gore", changeable in SQL
--   * every domain table gains organization_id (backfilled, then NOT NULL)
--   * role-aware RLS — employees can NEVER read the admin's time_sessions
--   * work-session notes column
--   * aggregate view + RPCs so clients fetch numbers, not raw rows (perf)
--
-- Safe on BOTH a fresh database (right after 0001) and an existing install
-- with data: backfill is conditional and idempotent-guarded where possible.
-- Run once in the Supabase SQL editor after 0001_initial_schema.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tenant + identity tables
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  role            text not null default 'employee' check (role in ('admin', 'employee')),
  display_name    text not null,
  created_at      timestamptz not null default now()
);

-- Exactly one admin per organization — enforced by the database, not the app.
create unique index if not exists one_admin_per_org
  on public.members (organization_id) where (role = 'admin');

create index if not exists idx_members_org on public.members (organization_id);

-- Seed the single organization (only if none exists yet).
insert into public.organizations (name)
select 'ESS – Electric Sciences & Solutions Pvt. Ltd.'
where not exists (select 1 from public.organizations);

-- ---------------------------------------------------------------------------
-- 2. Auth helpers (SECURITY DEFINER so they bypass RLS on members and can be
--    used INSIDE policies without recursion). STABLE → evaluated once per
--    statement where possible.
-- ---------------------------------------------------------------------------

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.members where user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' from public.members where user_id = auth.uid()),
    false)
$$;

-- Role of an arbitrary row owner — needed for the visibility rule
-- "employees see every employee's time EXCEPT the admin's".
create or replace function public.is_admin_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' from public.members where user_id = p_user),
    false)
$$;

grant execute on function public.current_org_id()      to authenticated;
grant execute on function public.is_admin()            to authenticated;
grant execute on function public.is_admin_user(uuid)   to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Domain table changes: ownership semantics + org scoping + notes
-- ---------------------------------------------------------------------------

-- Old policies referenced user_id; drop before reshaping.
drop policy if exists "own categories"        on public.categories;
drop policy if exists "own projects"          on public.projects;
drop policy if exists "own sessions"          on public.time_sessions;
drop policy if exists "own daily selections"  on public.daily_selections;

-- categories/projects belong to the ORG; user_id becomes "who created it".
alter table public.categories  rename column user_id to created_by;
alter table public.projects    rename column user_id to created_by;

alter table public.categories    add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.projects      add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.time_sessions add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.time_sessions add column if not exists notes text;

-- ---------------------------------------------------------------------------
-- 4. Backfill existing data into the single organization.
--    Earliest-created auth user becomes the admin, seeded as "Prasad Gore"
--    (change later with plain SQL: update members set role/display_name ...).
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  u record;
  v_has_admin boolean;
begin
  select id into v_org from public.organizations order by created_at limit 1;

  for u in (select id, email, raw_user_meta_data, created_at
              from auth.users order by created_at asc) loop
    select exists (select 1 from public.members
                    where organization_id = v_org and role = 'admin')
      into v_has_admin;

    insert into public.members (user_id, organization_id, role, display_name)
    values (
      u.id,
      v_org,
      case when v_has_admin then 'employee' else 'admin' end,
      case
        when not v_has_admin then coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), 'Prasad Gore')
        else coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1))
      end)
    on conflict (user_id) do nothing;
  end loop;

  -- Single-org install: stamp every existing row with the org id.
  update public.categories    set organization_id = v_org where organization_id is null;
  update public.projects      set organization_id = v_org where organization_id is null;
  update public.time_sessions set organization_id = v_org where organization_id is null;
end $$;

alter table public.categories    alter column organization_id set not null;
alter table public.projects      alter column organization_id set not null;
alter table public.time_sessions alter column organization_id set not null;

-- PERF: defaults let the client insert WITHOUT first asking "who am I" —
-- this removes one network round-trip (auth.getUser) from every write path,
-- a direct contributor to the slow project-creation issue.
alter table public.categories    alter column created_by      set default auth.uid();
alter table public.projects      alter column created_by      set default auth.uid();
alter table public.categories    alter column organization_id set default public.current_org_id();
alter table public.projects      alter column organization_id set default public.current_org_id();
alter table public.time_sessions alter column organization_id set default public.current_org_id();
alter table public.time_sessions alter column user_id         set default auth.uid();
alter table public.daily_selections alter column user_id      set default auth.uid();

-- ---------------------------------------------------------------------------
-- 5. Membership lifecycle
-- ---------------------------------------------------------------------------

-- Every new signup automatically joins the (single) organization.
-- If the org has no admin yet, the first signup becomes the admin —
-- seeded display name "Prasad Gore" unless the signup form provided one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_has_admin boolean;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    return new; -- no org seeded yet; nothing to join
  end if;

  select exists (select 1 from public.members
                  where organization_id = v_org and role = 'admin')
    into v_has_admin;

  insert into public.members (user_id, organization_id, role, display_name)
  values (
    new.id,
    v_org,
    case when v_has_admin then 'employee' else 'admin' end,
    case
      when not v_has_admin then coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'Prasad Gore')
      else coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1))
    end)
  on conflict (user_id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- SECURITY: privilege escalation guard. role / organization_id can never be
-- changed through the API (any request where auth.uid() is set — including
-- the admin's own requests). Changing the admin is a deliberate act done in
-- the SQL editor / service context, where auth.uid() is null. Combined with
-- the one_admin_per_org index, nobody can "become" a second admin.
create or replace function public.members_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role
       or new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id then
      raise exception 'role and organization membership cannot be changed through the API';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_guard_trg on public.members;
create trigger members_guard_trg
  before update on public.members
  for each row execute function public.members_guard();

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security — the actual authorization layer.
--    UI hiding is cosmetic; THESE policies are the wall.
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.members       enable row level security;

-- organizations: members read their own org; only the admin renames it.
drop policy if exists "org read"   on public.organizations;
drop policy if exists "org update" on public.organizations;
create policy "org read" on public.organizations
  for select using (id = public.current_org_id());
create policy "org update" on public.organizations
  for update using (public.is_admin() and id = public.current_org_id());

-- members: the VISIBILITY RULE for people.
--   * everyone sees themselves
--   * the admin sees every member
--   * employees see fellow members EXCEPT the admin row
-- (No INSERT policy at all: memberships are created only by the
--  SECURITY DEFINER signup trigger — no self-serve path, no escalation.)
drop policy if exists "members read"        on public.members;
drop policy if exists "members self update" on public.members;
create policy "members read" on public.members
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or (organization_id = public.current_org_id() and role <> 'admin')
  );
-- display_name self-service; role/org changes blocked by members_guard_trg.
create policy "members self update" on public.members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- categories: whole org reads; ONLY the admin writes.
create policy "categories org read" on public.categories
  for select using (organization_id = public.current_org_id());
create policy "categories admin write" on public.categories
  for insert with check (public.is_admin() and organization_id = public.current_org_id());
create policy "categories admin update" on public.categories
  for update using (public.is_admin() and organization_id = public.current_org_id());
create policy "categories admin delete" on public.categories
  for delete using (public.is_admin() and organization_id = public.current_org_id());

-- projects: whole org reads (employees browse/search/select); admin writes.
create policy "projects org read" on public.projects
  for select using (organization_id = public.current_org_id());
create policy "projects admin write" on public.projects
  for insert with check (public.is_admin() and organization_id = public.current_org_id());
create policy "projects admin update" on public.projects
  for update using (public.is_admin() and organization_id = public.current_org_id());
create policy "projects admin delete" on public.projects
  for delete using (public.is_admin() and organization_id = public.current_org_id());

-- time_sessions: THE core visibility rule.
--   Admin  → sees every session in the org.
--   Employee → sees sessions of everyone in the org EXCEPT the admin's.
--   Writes: only your own sessions, only in your org.
create policy "sessions visibility" on public.time_sessions
  for select using (
    organization_id = public.current_org_id()
    and (public.is_admin() or not public.is_admin_user(user_id))
  );
create policy "sessions insert own" on public.time_sessions
  for insert with check (user_id = auth.uid() and organization_id = public.current_org_id());
create policy "sessions update own" on public.time_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- daily_selections: strictly personal (each member curates their own Today).
create policy "today own" on public.daily_selections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7. Timer RPCs — updated for org membership.
--    Any member may run a timer on any ORG project (employees pick from
--    admin-created projects). Single-active-timer stays server-enforced.
-- ---------------------------------------------------------------------------

create or replace function public.start_session(p_project_id uuid)
returns public.time_sessions
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
  v_now  timestamptz := now();
  v_row  public.time_sessions;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select organization_id into v_org from public.members where user_id = v_user;
  if v_org is null then
    raise exception 'No organization membership';
  end if;

  -- The project must belong to the caller's organization.
  if not exists (
    select 1 from public.projects
    where id = p_project_id and organization_id = v_org
  ) then
    raise exception 'Project not found in your organization';
  end if;

  -- Auto-pause: close the caller's open session, if any (atomic with the open).
  update public.time_sessions
     set end_time = v_now,
         duration_seconds = greatest(0, extract(epoch from (v_now - start_time))::int)
   where user_id = v_user
     and end_time is null;

  insert into public.time_sessions (user_id, organization_id, project_id, start_time)
  values (v_user, v_org, p_project_id, v_now)
  returning * into v_row;

  update public.projects
     set status = case when status = 'not_started' then 'in_progress' else status end
   where id = p_project_id;

  return v_row;
end $$;

-- Unchanged semantics; recreated so the returned row includes new columns.
create or replace function public.stop_active_session()
returns public.time_sessions
language plpgsql security definer set search_path = public as $$
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
end $$;

grant execute on function public.start_session(uuid)   to authenticated;
grant execute on function public.stop_active_session() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Aggregates — PERF: the old client fetched EVERY session row and summed
--    in JavaScript (unbounded; the main scale bottleneck). These return the
--    sums directly. All are SECURITY INVOKER, so the caller's RLS applies:
--    an employee calling them can never include the admin's time.
-- ---------------------------------------------------------------------------

drop view if exists public.project_totals;
create view public.project_totals
with (security_invoker = on) as
  select p.id as project_id,
         p.organization_id,
         coalesce(sum(s.duration_seconds), 0)::bigint as total_seconds
    from public.projects p
    left join public.time_sessions s
      on s.project_id = p.id and s.end_time is not null
   group by p.id, p.organization_id;

grant select on public.project_totals to authenticated;

-- Per-project totals within a date range (null bounds = unbounded).
create or replace function public.session_project_totals(p_from timestamptz, p_to timestamptz)
returns table (project_id uuid, total_seconds bigint)
language sql stable security invoker set search_path = public as $$
  select s.project_id, coalesce(sum(s.duration_seconds), 0)::bigint
    from public.time_sessions s
   where s.end_time is not null
     and (p_from is null or s.start_time >= p_from)
     and (p_to   is null or s.start_time <  p_to)
   group by s.project_id
$$;

-- Per-person totals within a date range (Team view).
create or replace function public.session_user_totals(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, total_seconds bigint, session_count bigint)
language sql stable security invoker set search_path = public as $$
  select s.user_id, coalesce(sum(s.duration_seconds), 0)::bigint, count(*)::bigint
    from public.time_sessions s
   where s.end_time is not null
     and (p_from is null or s.start_time >= p_from)
     and (p_to   is null or s.start_time <  p_to)
   group by s.user_id
$$;

grant execute on function public.session_project_totals(timestamptz, timestamptz) to authenticated;
grant execute on function public.session_user_totals(timestamptz, timestamptz)    to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Indexes for the new access patterns (org scans + range filters).
-- ---------------------------------------------------------------------------
create index if not exists idx_categories_org      on public.categories (organization_id);
create index if not exists idx_projects_org        on public.projects (organization_id);
create index if not exists idx_sessions_org_start  on public.time_sessions (organization_id, start_time);
create index if not exists idx_sessions_user_start on public.time_sessions (user_id, start_time);

-- ---------------------------------------------------------------------------
-- 10. Realtime for live team status.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.members;
  exception when duplicate_object then null;
  end;
end $$;

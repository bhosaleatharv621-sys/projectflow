-- ============================================================================
-- 0004 — Member deactivation / reactivation
--
-- Additive only. Existing members all default to 'active'; no data changes.
--
--   * members.status: 'active' | 'inactive'
--   * admin-only deactivate/reactivate RPCs (deactivating force-closes the
--     target's running timer so no session is left dangling)
--   * the admin account can NEVER be deactivated (self or otherwise) —
--     with the one-admin guarantee this also protects "the only admin"
--   * inactive accounts lose ALL org data access at the RLS level:
--     current_org_id()/is_admin() now require an ACTIVE membership
--   * hardening: through the API, only a session's notes can be edited —
--     start/end/duration are immutable outside the SECURITY DEFINER RPCs
--
-- Run once in the Supabase SQL editor after 0003_member_approval_flow.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Status column (existing rows become 'active' via the default)
-- ---------------------------------------------------------------------------
alter table public.members
  add column if not exists status text not null default 'active'
    check (status in ('active', 'inactive'));

-- ---------------------------------------------------------------------------
-- 2. Guard trigger: extend the 0002 escalation guard with status rules.
--      * role / organization_id / user_id: still frozen through the API
--      * status: only the admin may change it through the API
--      * the admin row can never be set inactive — enforced unconditionally,
--        so even direct SQL must demote the admin first (deliberate act)
-- ---------------------------------------------------------------------------
create or replace function public.members_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.role is distinct from old.role
       or new.organization_id is distinct from old.organization_id
       or new.user_id is distinct from old.user_id then
      raise exception 'role and organization membership cannot be changed through the API';
    end if;
    if new.status is distinct from old.status and not public.is_admin() then
      raise exception 'Only the administrator can change member status';
    end if;
  end if;

  if new.role = 'admin' and new.status = 'inactive' then
    raise exception 'The administrator account cannot be deactivated';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Auth helpers now require ACTIVE membership. This is what locks an
--    inactive account out of every table: with current_org_id() = null,
--    every org-scoped RLS predicate evaluates false. (Their own members row
--    stays readable — user_id = auth.uid() — so the app can show the
--    "account deactivated" screen.)
-- ---------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.members
   where user_id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin' from public.members
      where user_id = auth.uid() and status = 'active'),
    false)
$$;

-- ---------------------------------------------------------------------------
-- 4. start_session: only ACTIVE members may run timers.
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

  select organization_id into v_org
    from public.members
   where user_id = v_user and status = 'active';
  if v_org is null then
    raise exception 'No active organization membership';
  end if;

  if not exists (
    select 1 from public.projects
    where id = p_project_id and organization_id = v_org
  ) then
    raise exception 'Project not found in your organization';
  end if;

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

-- ---------------------------------------------------------------------------
-- 5. Deactivate / reactivate RPCs — the only mutation path, admin-asserted
--    inside the database so employees calling them get an error.
-- ---------------------------------------------------------------------------
create or replace function public.deactivate_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target public.members;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can deactivate members';
  end if;

  select * into v_target from public.members
   where user_id = p_user_id and organization_id = public.current_org_id()
   for update;

  if v_target.user_id is null then
    raise exception 'Member not found';
  end if;
  if v_target.role = 'admin' then
    raise exception 'The administrator account cannot be deactivated';
  end if;
  if v_target.status = 'inactive' then
    return; -- already inactive
  end if;

  -- Close any running timer so no open session is stranded.
  update public.time_sessions
     set end_time = now(),
         duration_seconds = greatest(0, extract(epoch from (now() - start_time))::int)
   where user_id = p_user_id and end_time is null;

  update public.members set status = 'inactive' where user_id = p_user_id;
end $$;

create or replace function public.reactivate_member(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can reactivate members';
  end if;

  update public.members
     set status = 'active'
   where user_id = p_user_id
     and organization_id = public.current_org_id()
     and role <> 'admin';
end $$;

grant execute on function public.deactivate_member(uuid) to authenticated;
grant execute on function public.reactivate_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Session immutability hardening: through the API (role "authenticated"),
--    only the notes column of a session may change. Start/end/duration/owner
--    are writable solely by the SECURITY DEFINER timer RPCs (which run as
--    the function owner, not "authenticated").
-- ---------------------------------------------------------------------------
create or replace function public.session_update_guard()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    if new.start_time        is distinct from old.start_time
       or new.end_time          is distinct from old.end_time
       or new.duration_seconds  is distinct from old.duration_seconds
       or new.project_id        is distinct from old.project_id
       or new.user_id           is distinct from old.user_id
       or new.organization_id   is distinct from old.organization_id then
      raise exception 'Only session notes can be edited';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists session_update_guard_trg on public.time_sessions;
create trigger session_update_guard_trg
  before update on public.time_sessions
  for each row execute function public.session_update_guard();

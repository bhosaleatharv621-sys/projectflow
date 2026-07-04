-- ============================================================================
-- 0003 — Admin-controlled organization access approval
--
-- Before: any signup was auto-inserted into members as an employee.
-- After:  a signup creates a PENDING join request; the admin approves or
--         rejects it from the Team page. Nothing about existing data changes:
--         organizations, members (incl. the current admin), categories,
--         projects, and time_sessions are untouched.
--
-- Bootstrap rule kept intact: on a brand-new database with no admin yet, the
-- FIRST signup still becomes the admin directly (otherwise nobody could ever
-- approve anyone). Every later signup goes through approval.
--
-- Run once in the Supabase SQL editor after 0002_organizations.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Join-request table
-- ---------------------------------------------------------------------------

create table if not exists public.organization_join_requests (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  email           text not null,
  display_name    text not null,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  requested_at    timestamptz not null default now(),
  decided_by      uuid references auth.users (id),
  decided_at      timestamptz,
  unique (user_id)                       -- one request per account
);

create index if not exists idx_join_requests_org_status
  on public.organization_join_requests (organization_id, status);

alter table public.organization_join_requests enable row level security;

-- Requesters see their own request (the pending/rejected screens read it);
-- the admin sees every request in the org. Nobody else sees anything.
drop policy if exists "join requests read" on public.organization_join_requests;
create policy "join requests read" on public.organization_join_requests
  for select using (
    user_id = auth.uid()
    or (public.is_admin() and organization_id = public.current_org_id())
  );

-- No INSERT/UPDATE/DELETE policies on purpose: rows are created by the
-- signup trigger and mutated only by the SECURITY DEFINER RPCs below, so
-- there is no API path for a user to approve themselves.

-- ---------------------------------------------------------------------------
-- 2. Signup trigger: request access instead of auto-joining
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_has_admin boolean;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    return new; -- no org seeded yet
  end if;

  select exists (select 1 from public.members
                  where organization_id = v_org and role = 'admin')
    into v_has_admin;

  if not v_has_admin then
    -- Bootstrap: the very first account becomes the admin directly.
    insert into public.members (user_id, organization_id, role, display_name)
    values (
      new.id, v_org, 'admin',
      coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), 'Prasad Gore'))
    on conflict (user_id) do nothing;
  else
    -- Production path: create a pending join request for admin review.
    insert into public.organization_join_requests
      (organization_id, user_id, email, display_name)
    values (
      v_org, new.id,
      coalesce(new.email, ''),
      coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
               split_part(coalesce(new.email, 'user'), '@', 1)))
    on conflict (user_id) do nothing;
  end if;

  return new;
end $$;

-- (The trigger on auth.users from 0002 keeps pointing at this function.)

-- ---------------------------------------------------------------------------
-- 3. Backfill: any existing account with neither a membership nor a request
--    gets a pending request, so nobody is silently stranded.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then return; end if;

  insert into public.organization_join_requests
    (organization_id, user_id, email, display_name)
  select v_org, u.id, coalesce(u.email, ''),
         coalesce(nullif(u.raw_user_meta_data->>'full_name', ''),
                  split_part(coalesce(u.email, 'user'), '@', 1))
    from auth.users u
   where not exists (select 1 from public.members m where m.user_id = u.id)
     and not exists (select 1 from public.organization_join_requests r where r.user_id = u.id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Decision RPCs — the ONLY mutation path for requests.
--    Both assert the caller is the admin inside the function, so employees
--    (or pending users) calling them get an error, regardless of the UI.
--    Approval always creates role = 'employee'; combined with the members
--    guard trigger and the one_admin_per_org index from 0002, there is
--    still no path for anyone to become a second admin.
-- ---------------------------------------------------------------------------

create or replace function public.approve_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.organization_join_requests;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can approve join requests';
  end if;

  select * into v_req
    from public.organization_join_requests
   where id = p_request_id
     and organization_id = public.current_org_id()
   for update;

  if v_req.id is null then
    raise exception 'Join request not found';
  end if;
  -- Allow approving a previously rejected request (admin changed their mind).
  if v_req.status = 'approved' then
    raise exception 'Request is already approved';
  end if;

  insert into public.members (user_id, organization_id, role, display_name)
  values (v_req.user_id, v_req.organization_id, 'employee', v_req.display_name)
  on conflict (user_id) do nothing;

  update public.organization_join_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;
end $$;

create or replace function public.reject_join_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.organization_join_requests;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can reject join requests';
  end if;

  select * into v_req
    from public.organization_join_requests
   where id = p_request_id
     and organization_id = public.current_org_id()
   for update;

  if v_req.id is null then
    raise exception 'Join request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be rejected';
  end if;

  update public.organization_join_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;
end $$;

-- Self-service safety valve: lets a signed-in account with no membership and
-- no request create its own PENDING request (covers accounts created before
-- the trigger existed). It can never grant access by itself.
create or replace function public.request_access()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_email text;
  v_name text;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.members where user_id = v_user) then
    return; -- already a member
  end if;
  if exists (select 1 from public.organization_join_requests where user_id = v_user) then
    return; -- request already on file (pending or decided)
  end if;

  select id into v_org from public.organizations order by created_at limit 1;
  if v_org is null then
    raise exception 'No organization exists yet';
  end if;

  select email, coalesce(nullif(raw_user_meta_data->>'full_name', ''),
                         split_part(coalesce(email, 'user'), '@', 1))
    into v_email, v_name
    from auth.users where id = v_user;

  insert into public.organization_join_requests
    (organization_id, user_id, email, display_name)
  values (v_org, v_user, coalesce(v_email, ''), v_name)
  on conflict (user_id) do nothing;
end $$;

grant execute on function public.approve_join_request(uuid) to authenticated;
grant execute on function public.reject_join_request(uuid)  to authenticated;
grant execute on function public.request_access()           to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tighten daily_selections: previously only self-scoped, which let a
--    PENDING (non-member) account write harmless-but-pointless rows for
--    itself. Now membership is required for any Today-list activity.
-- ---------------------------------------------------------------------------
drop policy if exists "today own" on public.daily_selections;
create policy "today own" on public.daily_selections
  for all
  using (user_id = auth.uid() and public.current_org_id() is not null)
  with check (user_id = auth.uid() and public.current_org_id() is not null);

-- ---------------------------------------------------------------------------
-- 6. Realtime so the admin's pending list updates live.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.organization_join_requests;
  exception when duplicate_object then null;
  end;
end $$;

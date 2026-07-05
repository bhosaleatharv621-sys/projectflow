-- ============================================================================
-- 0006 — Manual time entry requests (admin-approval model)
--
-- Manual time NEVER edits official time directly. An employee submits a
-- request; only on the admin's approval is an official (already-closed)
-- time_sessions row created. Rejection changes nothing.
--
-- Additive only. Run after 0005_audit_log.sql.
-- ============================================================================

create table if not exists public.time_entry_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  project_id         uuid not null references public.projects (id) on delete cascade,
  start_time         timestamptz not null,
  end_time           timestamptz not null,
  duration_seconds   integer not null,
  reason             text,
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  requested_at       timestamptz not null default now(),
  decided_by         uuid references auth.users (id),
  decided_at         timestamptz,
  created_session_id uuid references public.time_sessions (id) on delete set null,
  check (end_time > start_time)
);

create index if not exists idx_time_requests_org_status
  on public.time_entry_requests (organization_id, status);
create index if not exists idx_time_requests_user
  on public.time_entry_requests (user_id);

alter table public.time_entry_requests enable row level security;

-- Requesters see their own; the admin sees the org's. No client write path —
-- all mutations go through the SECURITY DEFINER RPCs below.
drop policy if exists "time requests read" on public.time_entry_requests;
create policy "time requests read" on public.time_entry_requests
  for select using (
    user_id = auth.uid()
    or (public.is_admin() and organization_id = public.current_org_id())
  );

-- ---------------------------------------------------------------------------
-- Submit: always for the CALLER (employees cannot submit for other users).
-- ---------------------------------------------------------------------------
create or replace function public.submit_time_entry_request(
  p_project_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_reason text
) returns public.time_entry_requests
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
  v_row  public.time_entry_requests;
  v_secs integer;
begin
  if v_user is null then
    raise exception 'Not authenticated';
  end if;

  select organization_id into v_org
    from public.members where user_id = v_user and status = 'active';
  if v_org is null then
    raise exception 'No active organization membership';
  end if;

  if not exists (select 1 from public.projects
                  where id = p_project_id and organization_id = v_org) then
    raise exception 'Project not found in your organization';
  end if;

  if p_end <= p_start then
    raise exception 'End time must be after start time';
  end if;
  if p_end > now() then
    raise exception 'Manual entries must be in the past';
  end if;
  v_secs := extract(epoch from (p_end - p_start))::int;
  if v_secs > 24 * 3600 then
    raise exception 'A manual entry cannot be longer than 24 hours';
  end if;

  insert into public.time_entry_requests
    (organization_id, user_id, project_id, start_time, end_time, duration_seconds, reason)
  values (v_org, v_user, p_project_id, p_start, p_end, v_secs, nullif(trim(p_reason), ''))
  returning * into v_row;

  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Approve: admin only. Guards against overlapping the person's existing
-- sessions, then creates the official closed session and links it.
-- ---------------------------------------------------------------------------
create or replace function public.approve_time_entry_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.time_entry_requests;
  v_session public.time_sessions;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can approve manual time requests';
  end if;

  select * into v_req
    from public.time_entry_requests
   where id = p_request_id and organization_id = public.current_org_id()
   for update;

  if v_req.id is null then
    raise exception 'Request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be approved';
  end if;

  -- No overlap with the person's existing (open or closed) sessions.
  if exists (
    select 1 from public.time_sessions s
     where s.user_id = v_req.user_id
       and s.start_time < v_req.end_time
       and coalesce(s.end_time, now()) > v_req.start_time
  ) then
    raise exception 'This entry overlaps one of the person''s existing sessions';
  end if;

  insert into public.time_sessions
    (user_id, organization_id, project_id, start_time, end_time, duration_seconds, notes)
  values
    (v_req.user_id, v_req.organization_id, v_req.project_id,
     v_req.start_time, v_req.end_time, v_req.duration_seconds,
     coalesce('Manual entry: ' || v_req.reason, 'Manual entry'))
  returning * into v_session;

  update public.time_entry_requests
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         created_session_id = v_session.id
   where id = p_request_id;
end $$;

create or replace function public.reject_time_entry_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req public.time_entry_requests;
begin
  if not public.is_admin() then
    raise exception 'Only the administrator can reject manual time requests';
  end if;

  select * into v_req
    from public.time_entry_requests
   where id = p_request_id and organization_id = public.current_org_id()
   for update;

  if v_req.id is null then
    raise exception 'Request not found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Only pending requests can be rejected';
  end if;

  update public.time_entry_requests
     set status = 'rejected', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;
end $$;

grant execute on function public.submit_time_entry_request(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.approve_time_entry_request(uuid) to authenticated;
grant execute on function public.reject_time_entry_request(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- Audit refinements
-- ---------------------------------------------------------------------------

-- A manual entry arrives as an already-closed session insert; don't mislog
-- it as "timer_started". (Refines the 0005 trigger function.)
create or replace function public.audit_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.end_time is null then
      perform public.log_audit(new.organization_id, 'timer_started', 'time_session', new.id,
        jsonb_build_object('project_id', new.project_id));
    end if;
  elsif tg_op = 'UPDATE' then
    if old.end_time is null and new.end_time is not null then
      perform public.log_audit(new.organization_id, 'timer_stopped', 'time_session', new.id,
        jsonb_build_object('project_id', new.project_id, 'duration_seconds', new.duration_seconds));
    end if;
    if new.notes is distinct from old.notes then
      perform public.log_audit(
        new.organization_id,
        case when old.notes is null then 'session_note_added' else 'session_note_edited' end,
        'time_session', new.id,
        jsonb_build_object('project_id', new.project_id));
    end if;
  end if;
  return new;
end $$;

-- Manual-time request lifecycle in the audit log.
create or replace function public.audit_time_requests()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(new.organization_id, 'manual_time_requested', 'time_entry_request', new.id,
      jsonb_build_object('project_id', new.project_id, 'duration_seconds', new.duration_seconds));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.log_audit(new.organization_id, 'manual_time_approved', 'time_entry_request', new.id,
        jsonb_build_object('project_id', new.project_id, 'duration_seconds', new.duration_seconds));
    elsif new.status = 'rejected' then
      perform public.log_audit(new.organization_id, 'manual_time_rejected', 'time_entry_request', new.id,
        jsonb_build_object('project_id', new.project_id));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists audit_time_requests_trg on public.time_entry_requests;
create trigger audit_time_requests_trg
  after insert or update on public.time_entry_requests
  for each row execute function public.audit_time_requests();

-- Realtime so the admin's pending list updates live.
do $$
begin
  begin
    alter publication supabase_realtime add table public.time_entry_requests;
  exception when duplicate_object then null;
  end;
end $$;

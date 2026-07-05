-- ============================================================================
-- 0005 — Audit log
--
-- Additive only. A single audit_logs table, readable ONLY by the admin,
-- written ONLY by database triggers (SECURITY DEFINER) — there is no client
-- write path, so entries cannot be forged or suppressed from the API.
--
-- Logged actions (all server-side, no client cooperation required):
--   access_requested / access_approved / access_rejected
--   member_deactivated / member_reactivated
--   project_created / project_updated / project_completed
--   category_created
--   timer_started / timer_stopped
--   session_note_added / session_note_edited
--
-- Run once in the Supabase SQL editor after 0004_member_deactivation.sql.
-- ============================================================================

create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_user_id   uuid references auth.users (id) on delete set null,
  actor_email     text,
  action          text not null,
  entity_type     text,
  entity_id       uuid,
  details         jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_org_time
  on public.audit_logs (organization_id, created_at desc);

alter table public.audit_logs enable row level security;

-- Admin-only read; pending/rejected/inactive accounts have is_admin() = false
-- (0004 requires an ACTIVE membership), so they can never read this table.
drop policy if exists "audit admin read" on public.audit_logs;
create policy "audit admin read" on public.audit_logs
  for select using (public.is_admin() and organization_id = public.current_org_id());
-- No INSERT/UPDATE/DELETE policies on purpose.

-- ---------------------------------------------------------------------------
-- Writer helper. Resolves the acting user's email once; org comes from the
-- affected row so events fired by not-yet-members (access requests) are
-- still attributed to the right organization.
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(
  p_org uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_details jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
begin
  if v_actor is not null then
    select email into v_email from auth.users where id = v_actor;
  end if;
  insert into public.audit_logs
    (organization_id, actor_user_id, actor_email, action, entity_type, entity_id, details)
  values (p_org, v_actor, v_email, p_action, p_entity_type, p_entity_id, p_details);
end $$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Access requests: requested on insert; approved/rejected on status change.
create or replace function public.audit_join_requests()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(new.organization_id, 'access_requested', 'join_request', new.id,
      jsonb_build_object('email', new.email, 'display_name', new.display_name));
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'approved' then
      perform public.log_audit(new.organization_id, 'access_approved', 'join_request', new.id,
        jsonb_build_object('email', new.email, 'display_name', new.display_name));
    elsif new.status = 'rejected' then
      perform public.log_audit(new.organization_id, 'access_rejected', 'join_request', new.id,
        jsonb_build_object('email', new.email, 'display_name', new.display_name));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists audit_join_requests_trg on public.organization_join_requests;
create trigger audit_join_requests_trg
  after insert or update on public.organization_join_requests
  for each row execute function public.audit_join_requests();

-- Member status changes.
create or replace function public.audit_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.log_audit(
      new.organization_id,
      case when new.status = 'inactive' then 'member_deactivated' else 'member_reactivated' end,
      'member', new.user_id,
      jsonb_build_object('display_name', new.display_name));
  end if;
  return new;
end $$;

drop trigger if exists audit_members_trg on public.members;
create trigger audit_members_trg
  after update on public.members
  for each row execute function public.audit_members();

-- Projects: created / updated / completed.
create or replace function public.audit_projects()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(new.organization_id, 'project_created', 'project', new.id,
      jsonb_build_object('name', new.name, 'number', new.project_number));
  elsif tg_op = 'UPDATE' then
    if new.status = 'completed' and old.status is distinct from 'completed' then
      perform public.log_audit(new.organization_id, 'project_completed', 'project', new.id,
        jsonb_build_object('name', new.name, 'number', new.project_number));
    elsif row(new.*) is distinct from row(old.*) then
      -- Skip pure status flips from the timer RPC (not_started -> in_progress)
      -- to keep the log focused on human edits.
      if not (new.status = 'in_progress' and old.status = 'not_started'
              and new.name = old.name and new.target_hours = old.target_hours
              and coalesce(new.notes,'') = coalesce(old.notes,'')
              and coalesce(new.cost,0) = coalesce(old.cost,0)
              and coalesce(new.deadline, '1900-01-01') = coalesce(old.deadline, '1900-01-01')) then
        perform public.log_audit(new.organization_id, 'project_updated', 'project', new.id,
          jsonb_build_object('name', new.name, 'number', new.project_number));
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists audit_projects_trg on public.projects;
create trigger audit_projects_trg
  after insert or update on public.projects
  for each row execute function public.audit_projects();

-- Categories: created.
create or replace function public.audit_categories()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit(new.organization_id, 'category_created', 'category', new.id,
    jsonb_build_object('name', new.name));
  return new;
end $$;

drop trigger if exists audit_categories_trg on public.categories;
create trigger audit_categories_trg
  after insert on public.categories
  for each row execute function public.audit_categories();

-- Sessions: timer started/stopped, notes added/edited.
create or replace function public.audit_sessions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_audit(new.organization_id, 'timer_started', 'time_session', new.id,
      jsonb_build_object('project_id', new.project_id));
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

drop trigger if exists audit_sessions_trg on public.time_sessions;
create trigger audit_sessions_trg
  after insert or update on public.time_sessions
  for each row execute function public.audit_sessions();

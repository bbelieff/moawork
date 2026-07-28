-- MEMBER-AUTHZ-013
-- CHECKPOINT: exploration complete; 006 direct membership DML revocation and
-- 011 protected-owner/session-cutoff guards are the mandatory boundary.
-- This migration adds no client-side membership DML path.

create table if not exists public.member_hierarchy_assignments (
  org_id uuid not null references public.orgs(id) on delete cascade,
  member_user_id uuid not null references public.users(id) on delete cascade,
  reports_to_user_id uuid references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (org_id, member_user_id),
  check (member_user_id is distinct from reports_to_user_id)
);

create table if not exists public.member_scoped_permission_bindings (
  org_id uuid not null references public.orgs(id) on delete cascade,
  subject_user_id uuid not null references public.users(id) on delete cascade,
  scope_key text not null,
  decision text not null check (decision in ('allow', 'deny')),
  access_level text not null check (access_level in ('viewer', 'editor')),
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (org_id, subject_user_id, scope_key),
  check (scope_key ~ '^[a-z0-9][a-z0-9:_./-]{0,95}$')
);

create table if not exists public.member_hierarchy_authz_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  target_user_id uuid not null references public.users(id) on delete restrict,
  operation text not null check (operation in ('member_hierarchy_role_scope_set', 'member_scoped_permission_bound')),
  request_id uuid not null,
  metadata jsonb not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, operation, request_id)
);

alter table public.member_hierarchy_assignments enable row level security;
alter table public.member_scoped_permission_bindings enable row level security;
alter table public.member_hierarchy_authz_audit enable row level security;
revoke all on table public.member_hierarchy_assignments,
  public.member_scoped_permission_bindings, public.member_hierarchy_authz_audit
  from public, anon, authenticated;

create or replace function public.member_hierarchy_authz_require_owner(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null
     or not public.member_account_session_valid()
     or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner with valid session required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.member_hierarchy_authz_require_active_nonowner(
  p_org_id uuid, p_target_user_id uuid, p_actor_user_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_target_user_id is null or p_target_user_id = p_actor_user_id then
    raise exception 'self or missing target is not mutable' using errcode = '42501';
  end if;
  if not exists (
    select 1
      from public.org_members m join public.orgs o on o.id = m.org_id
     where m.org_id = p_org_id and m.user_id = p_target_user_id
       and m.status = 'active' and m.role <> 'owner' and o.status = 'active'
  ) then
    raise exception 'active non-owner member required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.member_hierarchy_authz_validate_manager(
  p_org_id uuid, p_target_user_id uuid, p_manager_user_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_manager_user_id is null then return; end if;
  if p_manager_user_id = p_target_user_id then
    raise exception 'self reporting is not allowed' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.org_members m join public.orgs o on o.id=m.org_id
     where m.org_id=p_org_id and m.user_id=p_manager_user_id
       and m.status='active' and m.role <> 'owner' and o.status='active'
  ) then
    raise exception 'active non-owner manager required' using errcode = '42501';
  end if;
  if exists (
    with recursive managers(member_user_id, reports_to_user_id) as (
      select h.member_user_id, h.reports_to_user_id
        from public.member_hierarchy_assignments h
       where h.org_id=p_org_id and h.member_user_id=p_manager_user_id
      union all
      select h.member_user_id, h.reports_to_user_id
        from public.member_hierarchy_assignments h
        join managers m on h.member_user_id=m.reports_to_user_id
       where h.org_id=p_org_id
    ) select 1 from managers where reports_to_user_id=p_target_user_id
  ) then
    raise exception 'hierarchy cycle is not allowed' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.member_hierarchy_authz_replay(
  p_operation text, p_request_id uuid, p_org_id uuid, p_target_user_id uuid, p_metadata jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.member_hierarchy_authz_audit%rowtype;
begin
  if p_request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
  select * into v_existing from public.member_hierarchy_authz_audit
   where actor_user_id=auth.uid() and operation=p_operation and request_id=p_request_id;
  if not found then return false; end if;
  if v_existing.org_id=p_org_id and v_existing.target_user_id=p_target_user_id and v_existing.metadata=p_metadata then
    return true;
  end if;
  raise exception 'idempotency key reuse with different request' using errcode = '22023';
end;
$$;

create or replace function public.set_workspace_member_hierarchy_role_scope(
  p_org_id uuid,
  p_target_user_id uuid,
  p_reports_to_user_id uuid,
  p_role public.member_role,
  p_scope public.member_scope,
  p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_metadata jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if p_role is null or p_scope is null or p_role='owner' then
    raise exception 'non-owner role and scope required' using errcode = '22023';
  end if;
  perform public.member_hierarchy_authz_require_active_nonowner(p_org_id,p_target_user_id,v_actor);
  perform public.member_hierarchy_authz_validate_manager(p_org_id,p_target_user_id,p_reports_to_user_id);
  v_metadata := jsonb_build_object('reports_to_user_id',p_reports_to_user_id,'role',p_role,'scope',p_scope);
  if public.member_hierarchy_authz_replay('member_hierarchy_role_scope_set',p_request_id,p_org_id,p_target_user_id,v_metadata) then
    return jsonb_build_object('accepted',true,'replayed',true);
  end if;
  update public.org_members set role=p_role, scope=p_scope
   where org_id=p_org_id and user_id=p_target_user_id and status='active' and role <> 'owner';
  if not found then raise exception 'active non-owner member required' using errcode = '42501'; end if;
  insert into public.member_hierarchy_assignments(org_id,member_user_id,reports_to_user_id,updated_by)
  values(p_org_id,p_target_user_id,p_reports_to_user_id,v_actor)
  on conflict(org_id,member_user_id) do update set reports_to_user_id=excluded.reports_to_user_id,
    updated_by=excluded.updated_by,updated_at=now();
  insert into public.member_hierarchy_authz_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(p_org_id,v_actor,p_target_user_id,'member_hierarchy_role_scope_set',p_request_id,v_metadata);
  return jsonb_build_object('accepted',true,'replayed',false);
end;
$$;

create or replace function public.bind_workspace_lower_member_permission(
  p_org_id uuid,
  p_target_user_id uuid,
  p_scope_key text,
  p_decision text,
  p_access_level text,
  p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_scope text:=lower(btrim(p_scope_key)); v_decision text:=lower(btrim(p_decision));
  v_access text:=lower(btrim(p_access_level)); v_metadata jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  perform public.member_hierarchy_authz_require_active_nonowner(p_org_id,p_target_user_id,v_actor);
  if not exists (
    select 1 from public.org_members m
     where m.org_id=p_org_id and m.user_id=p_target_user_id
       and m.status='active' and m.role='member'
  ) then
    raise exception 'active member target required' using errcode = '42501';
  end if;
  if v_scope is null or v_scope !~ '^[a-z0-9][a-z0-9:_./-]{0,95}$'
     or v_decision not in ('allow','deny') or v_access not in ('viewer','editor') then
    raise exception 'valid scoped permission required' using errcode = '22023';
  end if;
  v_metadata:=jsonb_build_object('scope_key',v_scope,'decision',v_decision,'access_level',v_access);
  if public.member_hierarchy_authz_replay('member_scoped_permission_bound',p_request_id,p_org_id,p_target_user_id,v_metadata) then
    return jsonb_build_object('accepted',true,'replayed',true);
  end if;
  insert into public.member_scoped_permission_bindings(org_id,subject_user_id,scope_key,decision,access_level,updated_by)
  values(p_org_id,p_target_user_id,v_scope,v_decision,v_access,v_actor)
  on conflict(org_id,subject_user_id,scope_key) do update set decision=excluded.decision,
    access_level=excluded.access_level,updated_by=excluded.updated_by,updated_at=now();
  insert into public.member_hierarchy_authz_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(p_org_id,v_actor,p_target_user_id,'member_scoped_permission_bound',p_request_id,v_metadata);
  return jsonb_build_object('accepted',true,'replayed',false);
end;
$$;

revoke insert, update, delete on public.org_members from public, anon, authenticated;
revoke all on function public.member_hierarchy_authz_require_owner(uuid) from public, anon, authenticated;
revoke all on function public.member_hierarchy_authz_require_active_nonowner(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.member_hierarchy_authz_validate_manager(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.member_hierarchy_authz_replay(text,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.set_workspace_member_hierarchy_role_scope(uuid,uuid,uuid,public.member_role,public.member_scope,uuid) from public, anon;
revoke all on function public.bind_workspace_lower_member_permission(uuid,uuid,text,text,text,uuid) from public, anon;
grant execute on function public.set_workspace_member_hierarchy_role_scope(uuid,uuid,uuid,public.member_role,public.member_scope,uuid) to authenticated;
grant execute on function public.bind_workspace_lower_member_permission(uuid,uuid,text,text,text,uuid) to authenticated;

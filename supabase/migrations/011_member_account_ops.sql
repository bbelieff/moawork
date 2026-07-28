-- FUNCTIONAL-MVP-CLOSE-WAVE3-DATA2-011
-- Account/member operations are RPC-only.  This migration neither creates a
-- membership nor derives tenant authority from the platform control plane.

create table if not exists public.member_account_ops_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  target_user_id uuid references public.users(id) on delete set null,
  operation text not null,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, operation, request_id)
);

create table if not exists public.member_account_profiles (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  team_key text,
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id),
  check (title is null or char_length(title) between 1 and 80),
  check (team_key is null or team_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);

create table if not exists public.member_account_sessions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete set null,
  check (absolute_expires_at <= created_at + interval '30 days')
);

create table if not exists public.privacy_export_requests (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  org_id uuid references public.orgs(id) on delete set null,
  status text not null default 'requested' check (status in ('requested', 'ready', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table if not exists public.support_access_requests (
  id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  requester_user_id uuid not null references public.users(id) on delete restrict,
  purpose text not null check (char_length(btrim(purpose)) between 1 and 240),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.users(id) on delete set null
);

create table if not exists public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.support_access_requests(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  support_user_id uuid not null references public.users(id) on delete restrict,
  approved_by uuid not null references public.users(id) on delete restrict,
  purpose text not null,
  read_only boolean not null default true check (read_only),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);

alter table public.member_account_ops_audit enable row level security;
alter table public.member_account_profiles enable row level security;
alter table public.member_account_sessions enable row level security;
alter table public.privacy_export_requests enable row level security;
alter table public.support_access_requests enable row level security;
alter table public.support_access_grants enable row level security;

-- Direct DML is deliberately unavailable: all mutation is scoped by auth.uid()
-- in the RPCs below, and no support grant is an impersonation capability.
revoke all on table public.member_account_ops_audit, public.member_account_profiles,
  public.member_account_sessions, public.privacy_export_requests,
  public.support_access_requests, public.support_access_grants from public, anon, authenticated;

create or replace function public.member_account_require_owner(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected owner required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.save_member_account_profile(
  p_org_id uuid, p_target_user_id uuid, p_title text, p_team_key text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_existing jsonb;
begin
  v_actor := public.member_account_require_owner(p_org_id);
  if p_request_id is null or p_target_user_id is null then
    raise exception 'request and target required' using errcode = '22023';
  end if;
  select metadata into v_existing from public.member_account_ops_audit
    where org_id=p_org_id and operation='member_profile_saved' and request_id=p_request_id;
  if found then return jsonb_build_object('accepted', true, 'replayed', true); end if;
  if not exists (
    select 1 from public.org_members m join public.orgs o on o.id=m.org_id
    where m.org_id=p_org_id and m.user_id=p_target_user_id and m.status='active'
      and o.status='active' and m.role <> 'owner'
  ) then raise exception 'active non-owner member required' using errcode = '42501'; end if;
  insert into public.member_account_profiles(org_id,user_id,title,team_key,updated_by)
  values(p_org_id,p_target_user_id,nullif(btrim(p_title),''),nullif(lower(btrim(p_team_key)),''),v_actor)
  on conflict (org_id,user_id) do update set title=excluded.title,team_key=excluded.team_key,
    updated_by=excluded.updated_by,updated_at=now();
  insert into public.member_account_ops_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(p_org_id,v_actor,p_target_user_id,'member_profile_saved',p_request_id,jsonb_build_object('fields','title_team'));
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

create or replace function public.list_my_member_account_sessions(p_org_id uuid, p_current_session_id uuid)
returns table(id uuid, created_at timestamptz, last_seen_at timestamptz, current_session boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id,s.created_at,s.last_seen_at,(s.id=p_current_session_id)
  from public.member_account_sessions s
  where s.user_id=auth.uid() and (p_org_id is null or s.org_id=p_org_id)
    and s.revoked_at is null and s.absolute_expires_at > now()
    and s.last_seen_at > now() - interval '7 days'
  order by s.last_seen_at desc, s.id;
$$;

create or replace function public.get_member_account_profile(p_org_id uuid, p_target_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_org_member(p_org_id) then
    raise exception 'active membership required' using errcode='42501';
  end if;
  if not exists (select 1 from public.org_members m join public.orgs o on o.id=m.org_id
    where m.org_id=p_org_id and m.user_id=p_target_user_id and m.status='active' and o.status='active') then
    raise exception 'member unavailable' using errcode='42501';
  end if;
  return (select jsonb_build_object('id',u.id,'name',u.name,'title',p.title,'team_key',p.team_key)
    from public.users u left join public.member_account_profiles p on p.org_id=p_org_id and p.user_id=u.id
    where u.id=p_target_user_id);
end;
$$;

create or replace function public.register_my_member_account_session(p_session_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_session_id is null then raise exception 'authentication and session required' using errcode='42501'; end if;
  if p_org_id is not null and not public.is_org_member(p_org_id) then raise exception 'active membership required' using errcode='42501'; end if;
  insert into public.member_account_sessions(id,user_id,org_id) values(p_session_id,v_actor,p_org_id)
  on conflict (id) do update set last_seen_at=now()
    where public.member_account_sessions.user_id=v_actor and public.member_account_sessions.revoked_at is null;
  if not found then raise exception 'session id belongs to another account or is revoked' using errcode='42501'; end if;
  return jsonb_build_object('accepted',true);
end;
$$;

create or replace function public.revoke_my_member_account_sessions(
  p_session_id uuid, p_all boolean, p_external_auth_revoked boolean
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid(); v_count integer;
begin
  if v_actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  -- The caller may invoke this only after its server-side Auth revocation has succeeded.
  if p_external_auth_revoked is not true then raise exception 'external auth revocation required' using errcode='55000'; end if;
  if p_all then
    update public.member_account_sessions set revoked_at=now(),revoked_by=v_actor
      where user_id=v_actor and revoked_at is null;
  else
    if p_session_id is null then raise exception 'session id required' using errcode='22023'; end if;
    update public.member_account_sessions set revoked_at=now(),revoked_by=v_actor
      where id=p_session_id and user_id=v_actor and revoked_at is null;
  end if;
  get diagnostics v_count=row_count;
  insert into public.member_account_ops_audit(actor_user_id,operation,metadata)
  values(v_actor,case when p_all then 'session_revoke_all' else 'session_revoke_current' end,jsonb_build_object('count',v_count));
  return jsonb_build_object('accepted',true,'revoked',v_count);
end;
$$;

create or replace function public.revoke_current_member_account_session(p_session_id uuid, p_external_auth_revoked boolean)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.revoke_my_member_account_sessions(p_session_id,false,p_external_auth_revoked);
$$;

create or replace function public.revoke_all_member_account_sessions(p_external_auth_revoked boolean)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.revoke_my_member_account_sessions(null,true,p_external_auth_revoked);
$$;

create or replace function public.get_my_privacy_account_data(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_org_id is not null and not public.is_org_member(p_org_id) then raise exception 'active membership required' using errcode='42501'; end if;
  return jsonb_build_object(
    'identity',(select jsonb_build_object('id',u.id,'email',u.email,'name',u.name,'avatar_url',u.avatar_url) from public.users u where u.id=v_actor),
    'workspace_profile',case when p_org_id is null then null else (select jsonb_build_object('role',m.role,'scope',m.scope,'title',p.title,'team_key',p.team_key) from public.org_members m left join public.member_account_profiles p on p.org_id=m.org_id and p.user_id=m.user_id where m.org_id=p_org_id and m.user_id=v_actor and m.status='active') end
  );
end;
$$;

create or replace function public.request_my_privacy_export(p_request_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_request_id is null then raise exception 'authentication and request required' using errcode='42501'; end if;
  if p_org_id is not null and not public.is_org_member(p_org_id) then raise exception 'active membership required' using errcode='42501'; end if;
  insert into public.privacy_export_requests(id,user_id,org_id) values(p_request_id,v_actor,p_org_id)
  on conflict (id) do nothing;
  if exists(select 1 from public.privacy_export_requests where id=p_request_id and user_id<>v_actor) then raise exception 'request id reuse denied' using errcode='42501'; end if;
  return jsonb_build_object('accepted',true);
end;
$$;

create or replace function public.request_support_read_access(p_request_id uuid, p_org_id uuid, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_platform_admin() then raise exception 'platform support required' using errcode='42501'; end if;
  insert into public.support_access_requests(id,org_id,requester_user_id,purpose)
  values(p_request_id,p_org_id,v_actor,btrim(p_purpose)) on conflict (id) do nothing;
  if exists(select 1 from public.support_access_requests where id=p_request_id and requester_user_id<>v_actor) then raise exception 'request id reuse denied' using errcode='42501'; end if;
  return jsonb_build_object('accepted',true);
end;
$$;

create or replace function public.approve_support_read_access(p_request_id uuid, p_ttl_minutes integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_request public.support_access_requests%rowtype;
begin
  select * into v_request from public.support_access_requests where id=p_request_id for update;
  if not found then raise exception 'request not found' using errcode='42501'; end if;
  v_actor := public.member_account_require_owner(v_request.org_id);
  if v_request.status <> 'pending' or p_ttl_minutes not between 1 and 1440 then raise exception 'pending request and ttl required' using errcode='22023'; end if;
  update public.support_access_requests set status='approved',decided_at=now(),decided_by=v_actor where id=p_request_id;
  insert into public.support_access_grants(request_id,org_id,support_user_id,approved_by,purpose,expires_at)
  values(p_request_id,v_request.org_id,v_request.requester_user_id,v_actor,v_request.purpose,now()+make_interval(mins=>p_ttl_minutes));
  insert into public.member_account_ops_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(v_request.org_id,v_actor,v_request.requester_user_id,'support_read_approved',p_request_id,jsonb_build_object('read_only',true));
  return jsonb_build_object('accepted',true);
end;
$$;

create or replace function public.get_my_support_read_scope()
returns table(org_id uuid, purpose text, expires_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.org_id,g.purpose,g.expires_at from public.support_access_grants g
  where g.support_user_id=auth.uid() and g.read_only and g.revoked_at is null and g.expires_at>now()
  order by g.expires_at,g.id;
$$;

revoke all on function public.member_account_require_owner(uuid) from public, anon, authenticated;
revoke all on function public.save_member_account_profile(uuid,uuid,text,text,uuid) from public, anon;
revoke all on function public.list_my_member_account_sessions(uuid,uuid) from public, anon;
revoke all on function public.get_member_account_profile(uuid,uuid) from public, anon;
revoke all on function public.register_my_member_account_session(uuid,uuid) from public, anon;
revoke all on function public.revoke_my_member_account_sessions(uuid,boolean,boolean) from public, anon;
revoke all on function public.revoke_current_member_account_session(uuid,boolean) from public, anon;
revoke all on function public.revoke_all_member_account_sessions(boolean) from public, anon;
revoke all on function public.get_my_privacy_account_data(uuid) from public, anon;
revoke all on function public.request_my_privacy_export(uuid,uuid) from public, anon;
revoke all on function public.request_support_read_access(uuid,uuid,text) from public, anon;
revoke all on function public.approve_support_read_access(uuid,integer) from public, anon;
revoke all on function public.get_my_support_read_scope() from public, anon;
grant execute on function public.save_member_account_profile(uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.list_my_member_account_sessions(uuid,uuid) to authenticated;
grant execute on function public.get_member_account_profile(uuid,uuid) to authenticated;
grant execute on function public.register_my_member_account_session(uuid,uuid) to authenticated;
grant execute on function public.revoke_current_member_account_session(uuid,boolean) to authenticated;
grant execute on function public.revoke_all_member_account_sessions(boolean) to authenticated;
grant execute on function public.get_my_privacy_account_data(uuid) to authenticated;
grant execute on function public.request_my_privacy_export(uuid,uuid) to authenticated;
grant execute on function public.request_support_read_access(uuid,uuid,text) to authenticated;
grant execute on function public.approve_support_read_access(uuid,integer) to authenticated;
grant execute on function public.get_my_support_read_scope() to authenticated;

-- ---------------------------------------------------------------------------
-- T10 R1: session cutoff is server-trusted and gates existing tenant access.
-- A signed JWT session identifier is read only from the request claim; callers
-- never provide an "external revocation succeeded" boolean.
-- ---------------------------------------------------------------------------

create unique index if not exists member_account_ops_actor_request_unique_idx
  on public.member_account_ops_audit(actor_user_id, operation, request_id)
  where request_id is not null;

create or replace function public.member_account_session_valid()
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_session_text text := nullif(current_setting('request.jwt.claim.session_id', true), '');
begin
  if v_session_text is null then return false; end if;
  return exists (
    select 1 from public.member_account_sessions s
    where s.id = v_session_text::uuid and s.user_id = auth.uid()
      and s.revoked_at is null and s.absolute_expires_at > now()
      and s.last_seen_at > now() - interval '7 days'
  );
exception when invalid_text_representation then
  return false;
end;
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.member_account_session_valid() and exists (
    select 1 from public.org_members membership join public.orgs organization on organization.id=membership.org_id
    where membership.org_id=p_org and membership.user_id=auth.uid()
      and membership.status='active' and organization.status='active'
  );
$$;

create or replace function public.org_role(p_org uuid)
returns public.member_role language sql stable security definer set search_path = public, pg_temp as $$
  select membership.role from public.org_members membership join public.orgs organization on organization.id=membership.org_id
  where public.member_account_session_valid() and membership.org_id=p_org and membership.user_id=auth.uid()
    and membership.status='active' and organization.status='active';
$$;

create or replace function public.org_scope(p_org uuid)
returns public.member_scope language sql stable security definer set search_path = public, pg_temp as $$
  select membership.scope from public.org_members membership join public.orgs organization on organization.id=membership.org_id
  where public.member_account_session_valid() and membership.org_id=p_org and membership.user_id=auth.uid()
    and membership.status='active' and organization.status='active';
$$;

create or replace function public.is_protected_workspace_owner(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.member_account_session_valid() and exists (
    select 1 from public.org_members membership join public.orgs organization on organization.id=membership.org_id
    where membership.org_id=p_org_id and membership.user_id=auth.uid() and membership.role='owner'
      and membership.scope='all' and membership.status='active' and organization.status='active'
  );
$$;

create or replace function public.member_account_replay(
  p_operation text, p_request_id uuid, p_org_id uuid, p_target_user_id uuid, p_metadata jsonb
) returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_existing public.member_account_ops_audit%rowtype;
begin
  if p_request_id is null then raise exception 'request id required' using errcode='22023'; end if;
  select * into v_existing from public.member_account_ops_audit
    where actor_user_id=auth.uid() and operation=p_operation and request_id=p_request_id;
  if not found then return false; end if;
  if v_existing.org_id is not distinct from p_org_id
     and v_existing.target_user_id is not distinct from p_target_user_id
     and v_existing.metadata = p_metadata then return true; end if;
  raise exception 'idempotency key reuse with different request' using errcode='22023';
end;
$$;

create or replace function public.save_member_account_profile(
  p_org_id uuid, p_target_user_id uuid, p_title text, p_team_key text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_title text := nullif(btrim(p_title),''); v_team text := nullif(lower(btrim(p_team_key)), '');
  v_metadata jsonb;
begin
  v_actor := public.member_account_require_owner(p_org_id);
  if p_target_user_id is null then raise exception 'target required' using errcode='22023'; end if;
  v_metadata := jsonb_build_object('title',v_title,'team_key',v_team);
  if public.member_account_replay('member_profile_saved',p_request_id,p_org_id,p_target_user_id,v_metadata) then
    return jsonb_build_object('accepted',true,'replayed',true);
  end if;
  if not exists (select 1 from public.org_members m join public.orgs o on o.id=m.org_id
    where m.org_id=p_org_id and m.user_id=p_target_user_id and m.status='active' and o.status='active' and m.role<>'owner') then
    raise exception 'active non-owner member required' using errcode='42501';
  end if;
  insert into public.member_account_profiles(org_id,user_id,title,team_key,updated_by) values(p_org_id,p_target_user_id,v_title,v_team,v_actor)
  on conflict(org_id,user_id) do update set title=excluded.title,team_key=excluded.team_key,updated_by=excluded.updated_by,updated_at=now();
  insert into public.member_account_ops_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(p_org_id,v_actor,p_target_user_id,'member_profile_saved',p_request_id,v_metadata);
  return jsonb_build_object('accepted',true,'replayed',false);
end;
$$;

create or replace function public.register_my_member_account_session(p_request_id uuid, p_session_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=auth.uid(); v_claim uuid; v_metadata jsonb;
begin
  begin v_claim := nullif(current_setting('request.jwt.claim.session_id',true),'')::uuid; exception when invalid_text_representation then raise exception 'valid signed session claim required' using errcode='42501'; end;
  if v_actor is null or p_session_id is null or v_claim is distinct from p_session_id then raise exception 'valid signed session claim required' using errcode='42501'; end if;
  if p_org_id is not null and not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active') then raise exception 'active membership required' using errcode='42501'; end if;
  v_metadata:=jsonb_build_object('session_id',p_session_id,'org_id',p_org_id);
  if public.member_account_replay('session_registered',p_request_id,p_org_id,v_actor,v_metadata) then return jsonb_build_object('accepted',true,'replayed',true); end if;
  insert into public.member_account_sessions(id,user_id,org_id) values(p_session_id,v_actor,p_org_id)
  on conflict(id) do update set last_seen_at=now() where public.member_account_sessions.user_id=v_actor and public.member_account_sessions.org_id is not distinct from p_org_id and public.member_account_sessions.revoked_at is null;
  if not found then raise exception 'session unavailable' using errcode='42501'; end if;
  insert into public.member_account_ops_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata) values(p_org_id,v_actor,v_actor,'session_registered',p_request_id,v_metadata);
  return jsonb_build_object('accepted',true,'replayed',false);
end;
$$;

create or replace function public.request_member_account_session_cutoff(p_request_id uuid, p_session_id uuid, p_all boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=auth.uid(); v_count integer; v_org_id uuid; v_operation text:=case when p_all then 'session_cutoff_all' else 'session_cutoff_current' end; v_metadata jsonb;
begin
  if v_actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  if not p_all and p_session_id is null then raise exception 'session id required' using errcode='22023'; end if;
  v_metadata:=jsonb_build_object('all',p_all,'session_id',p_session_id);
  if public.member_account_replay(v_operation,p_request_id,null,null,v_metadata) then return jsonb_build_object('accepted',true,'replayed',true); end if;
  if p_all then update public.member_account_sessions set revoked_at=now(),revoked_by=v_actor where user_id=v_actor and revoked_at is null;
  else update public.member_account_sessions set revoked_at=now(),revoked_by=v_actor where id=p_session_id and user_id=v_actor and revoked_at is null; end if;
  get diagnostics v_count=row_count;
  insert into public.member_account_ops_audit(actor_user_id,operation,request_id,metadata) values(v_actor,v_operation,p_request_id,v_metadata);
  return jsonb_build_object('accepted',true,'replayed',false,'revoked',v_count);
end;
$$;

create or replace function public.revoke_current_member_account_session(p_request_id uuid, p_session_id uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$ select public.request_member_account_session_cutoff(p_request_id,p_session_id,false); $$;
create or replace function public.revoke_all_member_account_sessions(p_request_id uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$ select public.request_member_account_session_cutoff(p_request_id,null,true); $$;

create or replace function public.acknowledge_external_member_session_cutoff(p_request_id uuid, p_external_reference text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_request_id is null or nullif(btrim(p_external_reference),'') is null then raise exception 'server provenance required' using errcode='42501'; end if;
  if not exists (select 1 from public.member_account_ops_audit a where a.request_id=p_request_id and a.operation in ('session_cutoff_current','session_cutoff_all')) then
    raise exception 'cutoff request required' using errcode='42501';
  end if;
  -- This function is service_role-only. It records an acknowledgement after DB
  -- cutoff; an external failure cannot restore a revoked session.
  return jsonb_build_object('accepted',true);
end;
$$;

create or replace function public.request_my_privacy_export(p_request_id uuid, p_org_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.privacy_export_requests%rowtype;
begin
  if v_actor is null or p_request_id is null then raise exception 'authentication and request required' using errcode='42501'; end if;
  if p_org_id is not null and not public.is_org_member(p_org_id) then raise exception 'active membership required' using errcode='42501'; end if;
  select * into v_existing from public.privacy_export_requests where id=p_request_id;
  if found then
    if v_existing.user_id=v_actor and v_existing.org_id is not distinct from p_org_id then return jsonb_build_object('accepted',true,'replayed',true); end if;
    raise exception 'idempotency key reuse with different request' using errcode='22023';
  end if;
  insert into public.privacy_export_requests(id,user_id,org_id) values(p_request_id,v_actor,p_org_id);
  insert into public.member_account_ops_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(p_org_id,v_actor,v_actor,'privacy_export_requested',p_request_id,jsonb_build_object('org_id',p_org_id));
  return jsonb_build_object('accepted',true,'replayed',false);
end;
$$;

create or replace function public.request_support_read_access(p_request_id uuid, p_org_id uuid, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid:=auth.uid(); v_purpose text:=btrim(p_purpose); v_existing public.support_access_requests%rowtype;
begin
  if v_actor is null or not public.is_platform_admin() then raise exception 'platform support required' using errcode='42501'; end if;
  select * into v_existing from public.support_access_requests where id=p_request_id;
  if found then
    if v_existing.org_id=p_org_id and v_existing.requester_user_id=v_actor and v_existing.purpose=v_purpose then return jsonb_build_object('accepted',true,'replayed',true); end if;
    raise exception 'idempotency key reuse with different request' using errcode='22023';
  end if;
  insert into public.support_access_requests(id,org_id,requester_user_id,purpose) values(p_request_id,p_org_id,v_actor,v_purpose);
  insert into public.member_account_ops_audit(org_id,actor_user_id,target_user_id,operation,request_id,metadata)
  values(p_org_id,v_actor,v_actor,'support_read_requested',p_request_id,jsonb_build_object('purpose',v_purpose));
  return jsonb_build_object('accepted',true,'replayed',false);
end;
$$;

revoke all on function public.register_my_member_account_session(uuid,uuid) from public, anon, authenticated;
revoke all on function public.revoke_my_member_account_sessions(uuid,boolean,boolean) from public, anon, authenticated;
revoke all on function public.revoke_current_member_account_session(uuid,boolean) from public, anon, authenticated;
revoke all on function public.revoke_all_member_account_sessions(boolean) from public, anon, authenticated;
drop function if exists public.revoke_current_member_account_session(uuid,boolean);
drop function if exists public.revoke_all_member_account_sessions(boolean);
drop function if exists public.revoke_my_member_account_sessions(uuid,boolean,boolean);
revoke all on function public.member_account_session_valid() from public, anon, authenticated;
revoke all on function public.member_account_replay(text,uuid,uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.request_member_account_session_cutoff(uuid,uuid,boolean) from public, anon;
revoke all on function public.request_member_account_session_cutoff(uuid,uuid,boolean) from authenticated;
revoke all on function public.acknowledge_external_member_session_cutoff(uuid,text) from public, anon, authenticated;
grant execute on function public.register_my_member_account_session(uuid,uuid,uuid) to authenticated;
grant execute on function public.revoke_current_member_account_session(uuid,uuid) to authenticated;
grant execute on function public.revoke_all_member_account_sessions(uuid) to authenticated;
grant execute on function public.request_member_account_session_cutoff(uuid,uuid,boolean) to authenticated;
grant execute on function public.acknowledge_external_member_session_cutoff(uuid,text) to service_role;

-- 010 helper is an internal SECURITY DEFINER guard, never a client capability.
revoke execute on function public.workspace_ops_require_owner(uuid) from public, anon, authenticated;

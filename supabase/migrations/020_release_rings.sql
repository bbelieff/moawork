-- 020_release_rings.sql
-- Release-ring controls are platform-plane metadata. They never grant tenant
-- membership and never bypass workspace RLS.

create table if not exists public.workspace_release_profiles (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  release_ring text not null default 'stable'
    check (release_ring in ('canary', 'stable')),
  is_internal boolean not null default false,
  internal_source text,
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (is_internal is false and internal_source is null)
    or
    (is_internal is true and internal_source = 'platform_reviewed_demo')
  )
);

create table if not exists public.feature_release_controls (
  feature_key text not null
    check (feature_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  release_ring text not null
    check (release_ring in ('canary', 'stable')),
  enabled boolean not null default false,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  primary key (feature_key, release_ring)
);

create table if not exists public.release_ring_audit (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  operation text not null
    check (operation in ('workspace_profile_set', 'feature_release_set')),
  actor_user_id uuid not null,
  org_id uuid,
  feature_key text,
  reason_code text not null
    check (reason_code in ('release_validation', 'internal_demo_review', 'rollback')),
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  unique (operation, request_id)
);

comment on table public.release_ring_audit is
  'Metadata-only platform audit. Stores UUIDs and release configuration, never names, emails, or free-text reasons.';

alter table public.workspace_release_profiles enable row level security;
alter table public.feature_release_controls enable row level security;
alter table public.release_ring_audit enable row level security;

revoke all on table public.workspace_release_profiles from public, anon, authenticated;
revoke all on table public.feature_release_controls from public, anon, authenticated;
revoke all on table public.release_ring_audit from public, anon, authenticated;

create or replace function public.release_rings_require_operator()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform operator required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public.release_rings_require_operator() from public, anon, authenticated;

create or replace function public.platform_set_workspace_release_profile(
  p_request_id uuid,
  p_org_id uuid,
  p_release_ring text,
  p_is_internal boolean,
  p_internal_source text,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_before jsonb;
  v_after jsonb;
  v_replay jsonb;
begin
  v_actor := public.release_rings_require_operator();

  if p_request_id is null or p_org_id is null then
    raise exception 'request and workspace required' using errcode = '22023';
  end if;
  if p_release_ring is null or p_release_ring not in ('canary', 'stable') then
    raise exception 'release ring invalid' using errcode = '22023';
  end if;
  if p_is_internal is null then
    raise exception 'internal classification required' using errcode = '22023';
  end if;
  if (p_is_internal and p_internal_source is distinct from 'platform_reviewed_demo')
     or (not p_is_internal and p_internal_source is not null) then
    raise exception 'internal source invalid' using errcode = '22023';
  end if;
  if p_reason_code is null
     or p_reason_code not in ('release_validation', 'internal_demo_review', 'rollback') then
    raise exception 'reason code invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.orgs workspace where workspace.id = p_org_id) then
    raise exception 'release target unavailable' using errcode = '42501';
  end if;

  v_after := jsonb_build_object(
    'org_id', p_org_id,
    'release_ring', p_release_ring,
    'is_internal', p_is_internal,
    'internal_source', p_internal_source
  );

  perform pg_advisory_xact_lock(
    hashtextextended('release-profile:' || p_request_id::text, 0)
  );

  select audit.after_state
    into v_replay
    from public.release_ring_audit audit
   where audit.operation = 'workspace_profile_set'
     and audit.request_id = p_request_id;

  if found then
    if v_replay <> v_after then
      raise exception 'idempotency key reuse with different release profile'
        using errcode = '22023';
    end if;
    return v_replay;
  end if;

  select jsonb_build_object(
           'org_id', profile.org_id,
           'release_ring', profile.release_ring,
           'is_internal', profile.is_internal,
           'internal_source', profile.internal_source
         )
    into v_before
    from public.workspace_release_profiles profile
   where profile.org_id = p_org_id;

  if v_before is null then
    v_before := jsonb_build_object(
      'org_id', p_org_id,
      'release_ring', 'stable',
      'is_internal', false,
      'internal_source', null
    );
  end if;

  insert into public.workspace_release_profiles (
    org_id, release_ring, is_internal, internal_source,
    reviewed_by, reviewed_at, updated_at
  ) values (
    p_org_id, p_release_ring, p_is_internal, p_internal_source,
    v_actor, now(), now()
  )
  on conflict (org_id) do update
    set release_ring = excluded.release_ring,
        is_internal = excluded.is_internal,
        internal_source = excluded.internal_source,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        updated_at = excluded.updated_at;

  insert into public.release_ring_audit (
    request_id, operation, actor_user_id, org_id, reason_code,
    before_state, after_state
  ) values (
    p_request_id, 'workspace_profile_set', v_actor, p_org_id, p_reason_code,
    v_before, v_after
  );

  return v_after;
end;
$$;

create or replace function public.platform_set_feature_release(
  p_request_id uuid,
  p_feature_key text,
  p_release_ring text,
  p_enabled boolean,
  p_reason_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_before jsonb;
  v_after jsonb;
  v_replay jsonb;
begin
  v_actor := public.release_rings_require_operator();

  if p_request_id is null then
    raise exception 'request required' using errcode = '22023';
  end if;
  if p_feature_key is null or p_feature_key !~ '^[a-z][a-z0-9_.-]{0,79}$' then
    raise exception 'feature key invalid' using errcode = '22023';
  end if;
  if p_release_ring is null or p_release_ring not in ('canary', 'stable') then
    raise exception 'release ring invalid' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'feature release state required' using errcode = '22023';
  end if;
  if p_reason_code is null
     or p_reason_code not in ('release_validation', 'internal_demo_review', 'rollback') then
    raise exception 'reason code invalid' using errcode = '22023';
  end if;

  v_after := jsonb_build_object(
    'feature_key', p_feature_key,
    'release_ring', p_release_ring,
    'enabled', p_enabled
  );

  perform pg_advisory_xact_lock(
    hashtextextended('feature-release:' || p_request_id::text, 0)
  );

  select audit.after_state
    into v_replay
    from public.release_ring_audit audit
   where audit.operation = 'feature_release_set'
     and audit.request_id = p_request_id;

  if found then
    if v_replay <> v_after then
      raise exception 'idempotency key reuse with different feature release'
        using errcode = '22023';
    end if;
    return v_replay;
  end if;

  select jsonb_build_object(
           'feature_key', control.feature_key,
           'release_ring', control.release_ring,
           'enabled', control.enabled
         )
    into v_before
    from public.feature_release_controls control
   where control.feature_key = p_feature_key
     and control.release_ring = p_release_ring;

  if v_before is null then
    v_before := jsonb_build_object(
      'feature_key', p_feature_key,
      'release_ring', p_release_ring,
      'enabled', false
    );
  end if;

  insert into public.feature_release_controls (
    feature_key, release_ring, enabled, updated_by, updated_at
  ) values (
    p_feature_key, p_release_ring, p_enabled, v_actor, now()
  )
  on conflict (feature_key, release_ring) do update
    set enabled = excluded.enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.release_ring_audit (
    request_id, operation, actor_user_id, feature_key, reason_code,
    before_state, after_state
  ) values (
    p_request_id, 'feature_release_set', v_actor, p_feature_key, p_reason_code,
    v_before, v_after
  );

  return v_after;
end;
$$;

create or replace function public.resolve_workspace_release_selector(p_org_id uuid)
returns table (
  org_id uuid,
  route_path text,
  route_authorization text,
  release_ring text,
  is_internal boolean,
  internal_source text,
  feature_releases jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_ring text;
  v_is_internal boolean;
  v_internal_source text;
  v_active_member boolean;
  v_reviewed_internal boolean;
  v_features jsonb;
begin
  if auth.uid() is null or p_org_id is null then
    raise exception 'release selector unavailable' using errcode = '42501';
  end if;

  select
    workspace.slug,
    case when profile.release_ring in ('canary', 'stable')
         then profile.release_ring else 'stable' end,
    coalesce(profile.is_internal, false),
    case when profile.is_internal is true
              and profile.internal_source = 'platform_reviewed_demo'
         then profile.internal_source else null end
    into v_slug, v_ring, v_is_internal, v_internal_source
    from public.orgs workspace
    left join public.workspace_release_profiles profile on profile.org_id = workspace.id
   where workspace.id = p_org_id
     and workspace.status = 'active'
     and workspace.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$';

  if not found then
    raise exception 'release selector unavailable' using errcode = '42501';
  end if;

  v_active_member := public.is_org_member(p_org_id);
  v_reviewed_internal := (
    not v_active_member
    and v_ring = 'canary'
    and v_is_internal
    and v_internal_source = 'platform_reviewed_demo'
    and public.is_platform_admin()
  );

  if not v_active_member and not v_reviewed_internal then
    raise exception 'release selector unavailable' using errcode = '42501';
  end if;

  select coalesce(
           jsonb_object_agg(control.feature_key, control.enabled order by control.feature_key),
           '{}'::jsonb
         )
    into v_features
    from public.feature_release_controls control
   where control.release_ring = v_ring;

  return query
  select
    p_org_id,
    '/w/' || v_slug,
    case when v_active_member then 'active_membership'
         else 'reviewed_internal_demo' end,
    v_ring,
    v_is_internal,
    v_internal_source,
    v_features;
end;
$$;

create or replace function public.list_reviewed_internal_demo_release_options()
returns table (
  org_id uuid,
  route_path text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.release_rings_require_operator();

  return query
  select
    workspace.id,
    '/w/' || workspace.slug
    from public.workspace_release_profiles profile
    join public.orgs workspace on workspace.id = profile.org_id
   where workspace.status = 'active'
     and workspace.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     and profile.release_ring = 'canary'
     and profile.is_internal is true
     and profile.internal_source = 'platform_reviewed_demo'
   order by workspace.id;
end;
$$;

revoke all on function public.platform_set_workspace_release_profile(uuid, uuid, text, boolean, text, text)
  from public, anon;
revoke all on function public.platform_set_feature_release(uuid, text, text, boolean, text)
  from public, anon;
revoke all on function public.resolve_workspace_release_selector(uuid)
  from public, anon;
revoke all on function public.list_reviewed_internal_demo_release_options()
  from public, anon;

grant execute on function public.platform_set_workspace_release_profile(uuid, uuid, text, boolean, text, text)
  to authenticated;
grant execute on function public.platform_set_feature_release(uuid, text, text, boolean, text)
  to authenticated;
grant execute on function public.resolve_workspace_release_selector(uuid)
  to authenticated;
grant execute on function public.list_reviewed_internal_demo_release_options()
  to authenticated;

comment on function public.resolve_workspace_release_selector(uuid) is
  'Read-only release selector. Returns a stored /w/{slug} only for active membership or reviewed internal-demo routing; never grants tenant access.';

comment on function public.list_reviewed_internal_demo_release_options() is
  'Platform-only discovery of active reviewed canary demos. Returns UUID and stored route only; never tenant or member data.';

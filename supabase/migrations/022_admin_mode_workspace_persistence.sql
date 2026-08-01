-- Admin-mode workspace selection is platform-plane preference state only.
-- It never creates membership and never grants access to tenant tables.

create table if not exists public.admin_mode_workspace_selections (
  actor_user_id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  authorization_kind text not null
    check (authorization_kind in ('active_membership', 'reviewed_internal_demo')),
  authorization_version timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (authorization_kind = 'active_membership' and authorization_version is null)
    or
    (authorization_kind = 'reviewed_internal_demo' and authorization_version is not null)
  )
);

create table if not exists public.admin_mode_workspace_selection_audit (
  request_id uuid primary key,
  actor_user_id uuid not null,
  org_id uuid not null,
  authorization_kind text not null
    check (authorization_kind in ('active_membership', 'reviewed_internal_demo')),
  previous_org_id uuid,
  previous_authorization_kind text
    check (
      previous_authorization_kind is null
      or previous_authorization_kind in ('active_membership', 'reviewed_internal_demo')
    ),
  created_at timestamptz not null default now()
);

comment on table public.admin_mode_workspace_selections is
  'Per-platform-actor presentation preference. Tenant access still requires current membership RLS.';
comment on table public.admin_mode_workspace_selection_audit is
  'UUID-only audit for admin-mode workspace selection; no names, emails, or tenant records.';

alter table public.admin_mode_workspace_selections enable row level security;
alter table public.admin_mode_workspace_selection_audit enable row level security;

revoke all on table public.admin_mode_workspace_selections from public, anon, authenticated;
revoke all on table public.admin_mode_workspace_selection_audit from public, anon, authenticated;

create or replace function public.platform_set_admin_mode_workspace_selection(
  p_request_id uuid,
  p_org_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_slug text;
  v_ring text;
  v_is_internal boolean;
  v_internal_source text;
  v_profile_updated_at timestamptz;
  v_authorization text;
  v_authorization_version timestamptz;
  v_previous_org_id uuid;
  v_previous_authorization text;
  v_replay_actor uuid;
  v_replay_org_id uuid;
  v_replay_authorization text;
  v_result jsonb;
begin
  v_actor := public.release_rings_require_operator();

  if p_request_id is null or p_org_id is null then
    raise exception 'request and workspace required' using errcode = '22023';
  end if;

  select
    workspace.slug,
    case when profile.release_ring in ('canary', 'stable')
         then profile.release_ring else 'stable' end,
    coalesce(profile.is_internal, false),
    case when profile.is_internal is true
              and profile.internal_source = 'platform_reviewed_demo'
         then profile.internal_source else null end,
    profile.updated_at
    into v_slug, v_ring, v_is_internal, v_internal_source, v_profile_updated_at
    from public.orgs workspace
    left join public.workspace_release_profiles profile on profile.org_id = workspace.id
   where workspace.id = p_org_id
     and workspace.status = 'active'
     and workspace.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     and char_length(workspace.slug) between 3 and 40;

  if not found then
    raise exception 'admin mode workspace unavailable' using errcode = '42501';
  end if;

  if public.is_org_member(p_org_id) then
    v_authorization := 'active_membership';
    v_authorization_version := null;
  elsif v_ring = 'canary'
    and v_is_internal
    and v_internal_source = 'platform_reviewed_demo'
    and v_profile_updated_at is not null then
    v_authorization := 'reviewed_internal_demo';
    v_authorization_version := v_profile_updated_at;
  else
    raise exception 'admin mode workspace unavailable' using errcode = '42501';
  end if;

  v_result := jsonb_build_object(
    'org_id', p_org_id,
    'route_path', '/w/' || v_slug,
    'route_authorization', v_authorization,
    'release_ring', v_ring
  );

  perform pg_advisory_xact_lock(
    hashtextextended('admin-mode-workspace:' || p_request_id::text, 0)
  );

  select audit.actor_user_id, audit.org_id, audit.authorization_kind
    into v_replay_actor, v_replay_org_id, v_replay_authorization
    from public.admin_mode_workspace_selection_audit audit
   where audit.request_id = p_request_id;

  if found then
    if v_replay_actor is distinct from v_actor
       or v_replay_org_id is distinct from p_org_id
       or v_replay_authorization is distinct from v_authorization then
      raise exception 'idempotency key reuse with different admin mode selection'
        using errcode = '22023';
    end if;
    return v_result;
  end if;

  select selection.org_id, selection.authorization_kind
    into v_previous_org_id, v_previous_authorization
    from public.admin_mode_workspace_selections selection
   where selection.actor_user_id = v_actor;

  insert into public.admin_mode_workspace_selections (
    actor_user_id, org_id, authorization_kind, authorization_version, updated_at
  ) values (
    v_actor, p_org_id, v_authorization, v_authorization_version, now()
  )
  on conflict (actor_user_id) do update
    set org_id = excluded.org_id,
        authorization_kind = excluded.authorization_kind,
        authorization_version = excluded.authorization_version,
        updated_at = excluded.updated_at;

  insert into public.admin_mode_workspace_selection_audit (
    request_id, actor_user_id, org_id, authorization_kind,
    previous_org_id, previous_authorization_kind
  ) values (
    p_request_id, v_actor, p_org_id, v_authorization,
    v_previous_org_id, v_previous_authorization
  );

  return v_result;
end;
$$;

create or replace function public.get_my_admin_mode_workspace_selection()
returns table (
  org_id uuid,
  route_path text,
  route_authorization text,
  release_ring text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.release_rings_require_operator();

  return query
  select
    selection.org_id,
    '/w/' || workspace.slug,
    selection.authorization_kind,
    case when profile.release_ring in ('canary', 'stable')
         then profile.release_ring else 'stable' end
    from public.admin_mode_workspace_selections selection
    join public.orgs workspace on workspace.id = selection.org_id
    left join public.workspace_release_profiles profile on profile.org_id = selection.org_id
   where selection.actor_user_id = v_actor
     and workspace.status = 'active'
     and workspace.slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     and char_length(workspace.slug) between 3 and 40
     and (
       (
         selection.authorization_kind = 'active_membership'
         and selection.authorization_version is null
         and public.is_org_member(selection.org_id)
       )
       or
       (
         selection.authorization_kind = 'reviewed_internal_demo'
         and profile.release_ring = 'canary'
         and profile.is_internal is true
         and profile.internal_source = 'platform_reviewed_demo'
         and profile.updated_at = selection.authorization_version
       )
     );
end;
$$;

revoke all on function public.platform_set_admin_mode_workspace_selection(uuid, uuid)
  from public, anon;
revoke all on function public.get_my_admin_mode_workspace_selection()
  from public, anon;

grant execute on function public.platform_set_admin_mode_workspace_selection(uuid, uuid)
  to authenticated;
grant execute on function public.get_my_admin_mode_workspace_selection()
  to authenticated;

comment on function public.platform_set_admin_mode_workspace_selection(uuid, uuid) is
  'Persists a platform presentation choice only after current membership or reviewed-demo recheck; grants no tenant access.';
comment on function public.get_my_admin_mode_workspace_selection() is
  'Returns the caller selection only while the stored authorization kind remains currently valid.';

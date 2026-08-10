-- BBE-9: additive lifecycle controls for the release-ring foundation in 020.
-- Feature access remains default OFF unless an explicit ring control is true.

create table if not exists public.feature_flag_registry (
  feature_key text primary key
    check (feature_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  owner_key text not null
    check (owner_key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  removal_due_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check (removal_due_at > created_at),
  check (retired_at is null or retired_at >= created_at)
);

comment on table public.feature_flag_registry is
  'Platform-only feature flag ownership and removal debt; identifiers only, no tenant or customer data.';

alter table public.feature_flag_registry enable row level security;
revoke all on table public.feature_flag_registry from public, anon, authenticated;

alter table public.release_ring_audit
  drop constraint if exists release_ring_audit_operation_check;
alter table public.release_ring_audit
  add constraint release_ring_audit_operation_check check (operation in (
    'workspace_profile_set',
    'feature_release_set',
    'feature_registered',
    'feature_rollout_advanced',
    'feature_emergency_off',
    'feature_retired'
  ));

alter table public.release_ring_audit
  drop constraint if exists release_ring_audit_reason_code_check;
alter table public.release_ring_audit
  add constraint release_ring_audit_reason_code_check check (reason_code in (
    'release_validation', 'internal_demo_review', 'rollback', 'debt_retirement'
  ));

create or replace function public.platform_register_feature_flag(
  p_request_id uuid,
  p_feature_key text,
  p_owner_key text,
  p_removal_due_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.release_rings_require_operator();
  v_after jsonb;
  v_replay jsonb;
begin
  if p_request_id is null
     or p_feature_key is null or p_feature_key !~ '^[a-z][a-z0-9_.-]{0,79}$'
     or p_owner_key is null or p_owner_key !~ '^[a-z][a-z0-9_.-]{0,79}$'
     or p_removal_due_at is null or p_removal_due_at <= now() then
    raise exception 'feature flag registration invalid' using errcode = '22023';
  end if;

  v_after := jsonb_build_object(
    'feature_key', p_feature_key,
    'owner_key', p_owner_key,
    'removal_due_at', p_removal_due_at
  );
  perform pg_advisory_xact_lock(hashtextextended('feature-register:' || p_request_id::text, 0));
  select audit.after_state into v_replay
    from public.release_ring_audit audit
   where audit.operation = 'feature_registered' and audit.request_id = p_request_id;
  if found then
    if v_replay <> v_after then
      raise exception 'idempotency key reuse with different feature registration' using errcode = '22023';
    end if;
    return v_replay;
  end if;

  insert into public.feature_flag_registry (
    feature_key, owner_key, removal_due_at, created_by
  ) values (p_feature_key, p_owner_key, p_removal_due_at, v_actor)
  on conflict (feature_key) do update
    set owner_key = excluded.owner_key,
        removal_due_at = excluded.removal_due_at,
        retired_at = null;

  -- Explicit rows make the initial OFF state observable and auditable.
  insert into public.feature_release_controls(feature_key, release_ring, enabled, updated_by)
  values (p_feature_key, 'canary', false, v_actor), (p_feature_key, 'stable', false, v_actor)
  on conflict (feature_key, release_ring) do nothing;

  insert into public.release_ring_audit(
    request_id, operation, actor_user_id, feature_key, reason_code, before_state, after_state
  ) values (
    p_request_id, 'feature_registered', v_actor, p_feature_key, 'release_validation',
    '{}'::jsonb, v_after
  );
  return v_after;
end;
$$;

create or replace function public.platform_advance_feature_flag(
  p_request_id uuid,
  p_feature_key text,
  p_target_ring text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.release_rings_require_operator();
  v_canary boolean;
  v_stable boolean;
  v_after jsonb;
  v_replay jsonb;
begin
  if p_request_id is null or p_target_ring not in ('canary', 'stable') then
    raise exception 'feature rollout target invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.feature_flag_registry registry
     where registry.feature_key = p_feature_key and registry.retired_at is null
  ) then
    raise exception 'active feature flag required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('feature-rollout:' || p_feature_key, 0));
  select audit.after_state into v_replay
    from public.release_ring_audit audit
   where audit.operation = 'feature_rollout_advanced' and audit.request_id = p_request_id;
  if found then
    if v_replay->>'feature_key' is distinct from p_feature_key
       or (p_target_ring = 'canary' and (v_replay->>'stable')::boolean)
       or (p_target_ring = 'stable' and not (v_replay->>'stable')::boolean) then
      raise exception 'idempotency key reuse with different rollout' using errcode = '22023';
    end if;
    return v_replay;
  end if;

  select coalesce(bool_or(enabled) filter (where release_ring = 'canary'), false),
         coalesce(bool_or(enabled) filter (where release_ring = 'stable'), false)
    into v_canary, v_stable
    from public.feature_release_controls where feature_key = p_feature_key;
  if p_target_ring = 'stable' and not v_canary then
    raise exception 'feature rollout must pass canary before stable' using errcode = '22023';
  end if;

  v_after := jsonb_build_object(
    'feature_key', p_feature_key,
    'canary', true,
    'stable', p_target_ring = 'stable' or v_stable
  );
  update public.feature_release_controls
     set enabled = true, updated_by = v_actor, updated_at = now()
   where feature_key = p_feature_key and release_ring = p_target_ring;
  insert into public.release_ring_audit(
    request_id, operation, actor_user_id, feature_key, reason_code, before_state, after_state
  ) values (
    p_request_id, 'feature_rollout_advanced', v_actor, p_feature_key, 'release_validation',
    jsonb_build_object('feature_key', p_feature_key, 'canary', v_canary, 'stable', v_stable),
    v_after
  );
  return v_after;
end;
$$;

create or replace function public.platform_retire_feature_flag(
  p_request_id uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.release_rings_require_operator();
  v_enabled boolean;
  v_after jsonb := jsonb_build_object('feature_key', p_feature_key, 'retired', true);
  v_replay jsonb;
begin
  if p_request_id is null or p_feature_key is null then
    raise exception 'retirement target invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feature-rollout:' || p_feature_key, 0));
  select audit.after_state into v_replay
    from public.release_ring_audit audit
   where audit.operation = 'feature_retired' and audit.request_id = p_request_id;
  if found then
    if v_replay <> v_after then
      raise exception 'idempotency key reuse with different retirement' using errcode = '22023';
    end if;
    return v_replay;
  end if;

  select coalesce(bool_or(control.enabled), false) into v_enabled
    from public.feature_release_controls control where control.feature_key = p_feature_key;
  if v_enabled then
    raise exception 'feature flag must be off before retirement' using errcode = '22023';
  end if;

  update public.feature_flag_registry
     set retired_at = now()
   where feature_key = p_feature_key and retired_at is null;
  if not found then
    raise exception 'active feature flag required' using errcode = '22023';
  end if;
  insert into public.release_ring_audit(
    request_id, operation, actor_user_id, feature_key, reason_code, before_state, after_state
  ) values (
    p_request_id, 'feature_retired', v_actor, p_feature_key, 'debt_retirement',
    jsonb_build_object('feature_key', p_feature_key, 'retired', false), v_after
  );
  return v_after;
end;
$$;

create or replace function public.platform_emergency_disable_feature(
  p_request_id uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.release_rings_require_operator();
  v_before jsonb;
  v_after jsonb := jsonb_build_object('feature_key', p_feature_key, 'canary', false, 'stable', false);
  v_replay jsonb;
begin
  if p_request_id is null or p_feature_key is null then
    raise exception 'rollback target invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feature-rollout:' || p_feature_key, 0));
  select audit.after_state into v_replay
    from public.release_ring_audit audit
   where audit.operation = 'feature_emergency_off' and audit.request_id = p_request_id;
  if found then
    if v_replay <> v_after then
      raise exception 'idempotency key reuse with different rollback' using errcode = '22023';
    end if;
    return v_replay;
  end if;

  select jsonb_build_object(
    'feature_key', p_feature_key,
    'canary', coalesce(bool_or(enabled) filter (where release_ring = 'canary'), false),
    'stable', coalesce(bool_or(enabled) filter (where release_ring = 'stable'), false)
  ) into v_before from public.feature_release_controls where feature_key = p_feature_key;

  update public.feature_release_controls
     set enabled = false, updated_by = v_actor, updated_at = now()
   where feature_key = p_feature_key and release_ring in ('canary', 'stable');
  if not found then
    raise exception 'feature flag unavailable' using errcode = '22023';
  end if;

  insert into public.release_ring_audit(
    request_id, operation, actor_user_id, feature_key, reason_code, before_state, after_state
  ) values (
    p_request_id, 'feature_emergency_off', v_actor, p_feature_key, 'rollback', v_before, v_after
  );
  return v_after;
end;
$$;

create or replace function public.list_feature_flag_debt()
returns table (
  feature_key text,
  owner_key text,
  removal_due_at timestamptz,
  overdue boolean,
  canary_enabled boolean,
  stable_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.release_rings_require_operator();
  return query
  select registry.feature_key,
         registry.owner_key,
         registry.removal_due_at,
         registry.removal_due_at <= now(),
         coalesce(bool_or(control.enabled) filter (where control.release_ring = 'canary'), false),
         coalesce(bool_or(control.enabled) filter (where control.release_ring = 'stable'), false)
    from public.feature_flag_registry registry
    left join public.feature_release_controls control on control.feature_key = registry.feature_key
   where registry.retired_at is null
   group by registry.feature_key, registry.owner_key, registry.removal_due_at
   order by registry.removal_due_at, registry.feature_key;
end;
$$;

revoke all on function public.platform_register_feature_flag(uuid, text, text, timestamptz) from public, anon;
revoke all on function public.platform_advance_feature_flag(uuid, text, text) from public, anon;
revoke all on function public.platform_emergency_disable_feature(uuid, text) from public, anon;
revoke all on function public.platform_retire_feature_flag(uuid, text) from public, anon;
revoke all on function public.list_feature_flag_debt() from public, anon;
grant execute on function public.platform_register_feature_flag(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.platform_advance_feature_flag(uuid, text, text) to authenticated;
grant execute on function public.platform_emergency_disable_feature(uuid, text) to authenticated;
grant execute on function public.platform_retire_feature_flag(uuid, text) to authenticated;
grant execute on function public.list_feature_flag_debt() to authenticated;

-- =====================================================================
-- 006_workspace_bootstrap.sql
-- 로그인 직후 owner 조직을 실제 사용 가능한 최소 워크스페이스로 만든다.
-- 기존 001~005 및 기존 조직 데이터는 수정하지 않는 additive migration.
-- =====================================================================

-- 기존 조직도 현재 plan_tier에 선언된 기능을 즉시 사용할 수 있게 한다.
-- manual/addon/trial은 보존하고, plan 캐시는 현재 plan_features로 다시 맞춘다.
insert into public.org_entitlements as current_entitlement (
  org_id,
  feature_key,
  enabled,
  limit_value,
  source
)
select
  o.id,
  pf.feature_key,
  true,
  pf.limit_value,
  'plan'::public.entitlement_source
from public.orgs o
join public.plans p on p.tier = o.plan_tier
join public.plan_features pf on pf.plan_id = p.id
on conflict (org_id, feature_key) do update
set
  enabled = excluded.enabled,
  limit_value = excluded.limit_value,
  expires_at = null
where current_entitlement.source = 'plan'::public.entitlement_source;

create or replace function public.bootstrap_workspace(p_org_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_pipeline_id uuid;
  v_entitlement_count integer := 0;
  v_stage_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if public.org_role(p_org_id) is distinct from 'owner'::public.member_role then
    raise exception 'workspace owner required'
      using errcode = '42501';
  end if;

  -- 같은 조직에 대한 동시 OAuth callback/RPC를 transaction 단위로 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  insert into public.org_entitlements as current_entitlement (
    org_id,
    feature_key,
    enabled,
    limit_value,
    source
  )
  select
    o.id,
    pf.feature_key,
    true,
    pf.limit_value,
    'plan'::public.entitlement_source
  from public.orgs o
  join public.plans p on p.tier = o.plan_tier
  join public.plan_features pf on pf.plan_id = p.id
  where o.id = p_org_id
  on conflict (org_id, feature_key) do update
  set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    expires_at = null
  where current_entitlement.source = 'plan'::public.entitlement_source;
  get diagnostics v_entitlement_count = row_count;

  select id
    into v_pipeline_id
  from public.pipelines
  where org_id = p_org_id
    and name = '기본 파이프라인'
  order by id
  limit 1;

  if v_pipeline_id is null then
    insert into public.pipelines (org_id, name)
    values (p_org_id, '기본 파이프라인')
    returning id into v_pipeline_id;
  end if;

  insert into public.stages (pipeline_id, name, sort_order, kind)
  select
    v_pipeline_id,
    defaults.name,
    defaults.sort_order,
    defaults.kind
  from (
    values
      ('마케팅', 0, 'marketing'::public.stage_kind),
      ('미팅', 1, 'meeting'::public.stage_kind),
      ('계약', 2, 'contract'::public.stage_kind),
      ('업무', 3, 'work'::public.stage_kind),
      ('정산', 4, 'settle'::public.stage_kind),
      ('사후관리', 5, 'post'::public.stage_kind)
  ) as defaults(name, sort_order, kind)
  where not exists (
    select 1
    from public.stages existing
    where existing.pipeline_id = v_pipeline_id
      and existing.kind = defaults.kind
  );
  get diagnostics v_stage_count = row_count;

  return jsonb_build_object(
    'org_id', p_org_id,
    'pipeline_id', v_pipeline_id,
    'entitlements_created', v_entitlement_count,
    'stages_created', v_stage_count
  );
end;
$$;

-- SECURITY DEFINER 진입점은 authenticated owner만 호출한다.
revoke all on function public.bootstrap_workspace(uuid) from public;
revoke all on function public.bootstrap_workspace(uuid) from anon;
grant execute on function public.bootstrap_workspace(uuid) to authenticated;

comment on function public.bootstrap_workspace(uuid) is
  'Owner-only idempotent workspace bootstrap: plan entitlements, one default pipeline, six stage kinds.';

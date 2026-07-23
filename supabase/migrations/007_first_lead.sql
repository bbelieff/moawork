-- =====================================================================
-- 007_first_lead.sql
-- 인증된 조직 멤버가 첫 업체와 marketing 단계 딜을 원자적·멱등 생성한다.
-- 기존 001~006 및 기존 업무 데이터는 수정하지 않는 additive migration.
-- =====================================================================

create or replace function public.create_first_lead(
  p_org_id uuid,
  p_request_id uuid,
  p_company_name text,
  p_deal_title text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_company_name text := btrim(coalesce(p_company_name, ''));
  v_deal_title text := btrim(coalesce(p_deal_title, ''));
  v_pipeline_id uuid;
  v_stage_id uuid;
  v_company_id uuid;
  v_deal_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if p_org_id is null or not exists (
    select 1
    from public.org_members member
    where member.org_id = p_org_id
      and member.user_id = v_user_id
  ) then
    raise exception 'workspace membership required'
      using errcode = '42501';
  end if;

  if p_request_id is null then
    raise exception 'request id required'
      using errcode = '22023';
  end if;

  if v_company_name = '' then
    raise exception 'company name required'
      using errcode = '22023';
  end if;

  if char_length(v_company_name) > 160 then
    raise exception 'company name too long'
      using errcode = '22023';
  end if;

  if v_deal_title = '' then
    v_deal_title := v_company_name || ' 업무';
  end if;

  if char_length(v_deal_title) > 200 then
    raise exception 'deal title too long'
      using errcode = '22023';
  end if;

  -- 같은 조직·요청의 동시 submit을 transaction 종료까지 직렬화한다.
  perform pg_advisory_xact_lock(
    hashtextextended(p_org_id::text || ':' || p_request_id::text, 0)
  );

  -- 완료된 요청이면 원래 결과를 돌려준다. 예약 키에는 UUID만 저장하며
  -- 업체명·업무명 같은 고객 원문은 넣지 않는다.
  select deal.id, deal.company_id
    into v_deal_id, v_company_id
  from public.deals deal
  where deal.org_id = p_org_id
    and deal.custom ->> '_first_lead_request_id' = p_request_id::text
  order by deal.created_at, deal.id
  limit 1;

  if v_deal_id is not null then
    if v_company_id is null then
      raise exception 'existing first lead result is incomplete'
        using errcode = 'P0001';
    end if;

    return jsonb_build_object(
      'org_id', p_org_id,
      'company_id', v_company_id,
      'deal_id', v_deal_id,
      'created', false
    );
  end if;

  select pipeline.id
    into v_pipeline_id
  from public.pipelines pipeline
  where pipeline.org_id = p_org_id
    and pipeline.name = '기본 파이프라인'
  order by pipeline.id
  limit 1;

  if v_pipeline_id is null then
    raise exception 'default pipeline required'
      using errcode = 'P0001';
  end if;

  select stage.id
    into v_stage_id
  from public.stages stage
  where stage.pipeline_id = v_pipeline_id
    and stage.kind = 'marketing'::public.stage_kind
  order by stage.sort_order, stage.id
  limit 1;

  if v_stage_id is null then
    raise exception 'marketing stage required'
      using errcode = 'P0001';
  end if;

  insert into public.companies (
    org_id,
    name,
    assigned_to
  )
  values (
    p_org_id,
    v_company_name,
    v_user_id
  )
  returning id into v_company_id;

  insert into public.deals (
    org_id,
    company_id,
    pipeline_id,
    stage_id,
    assigned_to,
    title,
    custom
  )
  values (
    p_org_id,
    v_company_id,
    v_pipeline_id,
    v_stage_id,
    v_user_id,
    v_deal_title,
    jsonb_build_object('_first_lead_request_id', p_request_id::text)
  )
  returning id into v_deal_id;

  return jsonb_build_object(
    'org_id', p_org_id,
    'company_id', v_company_id,
    'deal_id', v_deal_id,
    'created', true
  );
end;
$$;

revoke all on function public.create_first_lead(uuid, uuid, text, text) from public;
revoke all on function public.create_first_lead(uuid, uuid, text, text) from anon;
grant execute on function public.create_first_lead(uuid, uuid, text, text) to authenticated;

comment on function public.create_first_lead(uuid, uuid, text, text) is
  'Member-only idempotent first lead creation: one company and one marketing-stage deal in a single transaction.';

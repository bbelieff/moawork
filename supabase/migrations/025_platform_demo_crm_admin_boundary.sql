-- Platform-admin CRM surface for the currently selected reviewed demo.
-- This is a narrow control-plane exception: it does not create membership or
-- relax tenant-table RLS for ordinary workspace routes.

create table if not exists public.platform_demo_crm_imports (
  actor_user_id uuid not null,
  request_id uuid not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_kind public.stage_kind not null,
  rows_payload jsonb not null,
  deal_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (actor_user_id, request_id)
);

alter table public.platform_demo_crm_imports enable row level security;
revoke all on table public.platform_demo_crm_imports from public, anon, authenticated;

create or replace function public.platform_get_selected_demo_crm(p_board_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_kind public.stage_kind;
  v_stages jsonb;
  v_deals jsonb;
  v_companies jsonb;
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform support required' using errcode = '42501';
  end if;

  begin
    v_kind := p_board_kind::public.stage_kind;
  exception when invalid_text_representation then
    raise exception 'board kind invalid' using errcode = '22023';
  end;

  select selection.org_id
    into v_org_id
    from public.admin_mode_workspace_selections selection
    join public.workspace_release_profiles profile on profile.org_id = selection.org_id
    join public.feature_release_controls feature
      on feature.feature_key = 'platform_reviewed_demo'
     and feature.release_ring = 'canary'
     and feature.enabled is true
   where selection.actor_user_id = v_actor
     and profile.release_ring = 'canary'
     and profile.is_internal is true
     and profile.internal_source = 'platform_reviewed_demo'
     and (
       (selection.authorization_kind = 'active_membership'
        and selection.authorization_version is null
        and public.is_org_member(selection.org_id))
       or
       (selection.authorization_kind = 'reviewed_internal_demo'
        and selection.authorization_version = profile.updated_at)
     );

  if v_org_id is null then
    raise exception 'selected demo unavailable' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.sort_order, s.id), '[]'::jsonb)
    into v_stages
    from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = v_org_id and s.kind = v_kind;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at, d.id), '[]'::jsonb)
    into v_deals
    from public.deals d
    join public.stages s on s.id = d.stage_id
    join public.pipelines p on p.id = s.pipeline_id
   where d.org_id = v_org_id and p.org_id = v_org_id and s.kind = v_kind;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb)
    into v_companies
    from public.companies c
   where c.org_id = v_org_id
     and exists (
       select 1
         from public.deals d
         join public.stages s on s.id = d.stage_id
         join public.pipelines p on p.id = s.pipeline_id
        where d.org_id = v_org_id
          and d.company_id = c.id
          and p.org_id = v_org_id
          and s.kind = v_kind
     );

  return jsonb_build_object(
    'org_id', v_org_id,
    'stages', v_stages,
    'deals', v_deals,
    'companies', v_companies
  );
end;
$$;

create or replace function public.platform_import_selected_demo_crm_csv(
  p_request_id uuid,
  p_board_kind text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_kind public.stage_kind;
  v_stage public.stages%rowtype;
  v_pipeline_id uuid;
  v_row jsonb;
  v_values jsonb;
  v_key text;
  v_value jsonb;
  v_title text;
  v_deal_id uuid;
  v_deal_ids uuid[] := '{}';
  v_existing public.platform_demo_crm_imports%rowtype;
begin
  if v_actor is null or not public.is_platform_admin() then
    raise exception 'platform support required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request required' using errcode = '22023';
  end if;
  begin
    v_kind := p_board_kind::public.stage_kind;
  exception when invalid_text_representation then
    raise exception 'board kind invalid' using errcode = '22023';
  end;
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 500
     or octet_length(p_rows::text) > 1048576 then
    raise exception 'CSV rows invalid' using errcode = '22023';
  end if;

  select selection.org_id
    into v_org_id
    from public.admin_mode_workspace_selections selection
    join public.workspace_release_profiles profile on profile.org_id = selection.org_id
    join public.feature_release_controls feature
      on feature.feature_key = 'platform_reviewed_demo'
     and feature.release_ring = 'canary'
     and feature.enabled is true
   where selection.actor_user_id = v_actor
     and profile.release_ring = 'canary'
     and profile.is_internal is true
     and profile.internal_source = 'platform_reviewed_demo'
     and (
       (selection.authorization_kind = 'active_membership'
        and selection.authorization_version is null
        and public.is_org_member(selection.org_id))
       or
       (selection.authorization_kind = 'reviewed_internal_demo'
        and selection.authorization_version = profile.updated_at)
     );

  if v_org_id is null then
    raise exception 'selected demo unavailable' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform-demo-crm:' || v_actor::text || ':' || p_request_id::text, 0));
  select * into v_existing
    from public.platform_demo_crm_imports receipt
   where receipt.actor_user_id = v_actor and receipt.request_id = p_request_id;
  if found then
    if v_existing.org_id is distinct from v_org_id
       or v_existing.board_kind is distinct from v_kind
       or v_existing.rows_payload is distinct from p_rows then
      raise exception 'idempotency key reused with different CSV' using errcode = '22023';
    end if;
    return jsonb_build_object('accepted', true, 'replayed', true, 'row_count', cardinality(v_existing.deal_ids));
  end if;

  -- Different requests and platform actors must share one initial stage for
  -- the same demo board.
  perform pg_advisory_xact_lock(
    hashtextextended('platform-demo-crm-stage:' || v_org_id::text || ':' || v_kind::text, 0)
  );

  select s.* into v_stage
    from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = v_org_id and s.kind = v_kind
   order by s.sort_order, s.id
   limit 1;
  if v_stage.id is null then
    select p.id into v_pipeline_id
      from public.pipelines p
     where p.org_id = v_org_id
     order by p.id
     limit 1;
    if v_pipeline_id is null then
      insert into public.pipelines (org_id, name)
      values (v_org_id, '데모 CRM')
      returning id into v_pipeline_id;
    end if;
    insert into public.stages (pipeline_id, name, sort_order, kind)
    values (
      v_pipeline_id,
      case v_kind
        when 'marketing' then '새 문의'
        when 'meeting' then '상담 예정'
        when 'contract' then '계약 준비'
        when 'work' then '업무 시작'
        when 'settle' then '정산 대기'
        when 'post' then '사후 관리'
      end,
      0,
      v_kind
    ) returning * into v_stage;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or jsonb_typeof(v_row->'title') <> 'string'
       or jsonb_typeof(v_row->'values') <> 'object' then
      raise exception 'CSV row invalid' using errcode = '22023';
    end if;
    v_title := btrim(v_row->>'title');
    v_values := v_row->'values';
    if v_title = '' or char_length(v_title) > 200
       or (select count(*) from jsonb_object_keys(v_values)) > 50 then
      raise exception 'CSV row invalid' using errcode = '22023';
    end if;
    for v_key, v_value in select key, value from jsonb_each(v_values) loop
      if v_key = '' or char_length(v_key) > 80
         or v_key in ('__proto__', 'constructor', 'prototype')
         or jsonb_typeof(v_value) <> 'string'
         or char_length(v_value #>> '{}') > 2000 then
        raise exception 'CSV value invalid' using errcode = '22023';
      end if;
    end loop;

    v_deal_id := gen_random_uuid();
    insert into public.deals (id, org_id, pipeline_id, stage_id, assigned_to, title, custom)
    values (v_deal_id, v_org_id, v_stage.pipeline_id, v_stage.id, v_actor, v_title, v_values);
    insert into public.activities (org_id, deal_id, type, content, actor)
    values (v_org_id, v_deal_id, 'status', '→ ' || v_stage.name, v_actor);
    v_deal_ids := array_append(v_deal_ids, v_deal_id);
  end loop;

  insert into public.platform_demo_crm_imports (
    actor_user_id, request_id, org_id, board_kind, rows_payload, deal_ids
  ) values (v_actor, p_request_id, v_org_id, v_kind, p_rows, v_deal_ids);

  return jsonb_build_object('accepted', true, 'replayed', false, 'row_count', cardinality(v_deal_ids));
end;
$$;

revoke all on function public.platform_get_selected_demo_crm(text) from public, anon;
revoke all on function public.platform_import_selected_demo_crm_csv(uuid, text, jsonb) from public, anon;
grant execute on function public.platform_get_selected_demo_crm(text) to authenticated;
grant execute on function public.platform_import_selected_demo_crm_csv(uuid, text, jsonb) to authenticated;

comment on function public.platform_get_selected_demo_crm(text) is
  'Reads CRM data only for the caller-selected, reviewed internal demo after platform-admin revalidation.';
comment on function public.platform_import_selected_demo_crm_csv(uuid, text, jsonb) is
  'Atomically and idempotently creates demo CRM deals plus their initial status activities for a reviewed internal demo.';

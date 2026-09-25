-- moa-migration-guard: logical_key=150_issue700_detail_event_edit predecessor=149_platform_customer_session_repair digest=4573b9e61b3d6441b3411f62a93d767c87bc18db140f11dab4a85a93af9701ca foundation=false

select public.begin_guarded_migration(
  p_logical_key => '150_issue700_detail_event_edit',
  p_file_name => '150_issue700_detail_event_edit.sql',
  p_file_digest => '4573b9e61b3d6441b3411f62a93d767c87bc18db140f11dab4a85a93af9701ca',
  p_expected_predecessor => '149_platform_customer_session_repair',
  p_executor => 'DG',
  p_thread_id => 'moawork-v17-detail-20260925',
  p_foundation => false
);

-- 히스토리 메모 고치기 수리 (v17-detail-repair, PGlite 실측 4건 + 창업연월 원자화).
--
-- ## 왜 (독립 검토가 PGlite에서 재현한 결함)
--
-- ① 범위(scope assigned) 멤버가 아이템 재배정 뒤에도 자기 옛 메모를 고쳤다.
--    원인은 SECURITY DEFINER가 활성 멤버 여부만 보고 현재 가시성
--    (owner/admin/all 또는 current assignee)을 안 봤기 때문이다.
-- ② actor_id NULL 메모를 비소유자가 고쳤다.
--    `IF NOT (owner OR actor=v_actor)` 에서 NULL 비교가 NULL이라 거짓이 안 됐다.
--    자동 생성(field_change)은 누구도 못 고쳐야 한다.
-- ③ requestA 쓰기 -> 소유자B 편집 -> replayA가 B를 옛 본문으로 덮었다(edit_count 3).
--    metadata.last_edit_request_id만으로는 다른 요청의 낡은 초안을 못 막는다.
-- ④ 25번 고치면 history 20으로 잘라 원본을 잃었다. 조용한 파기가 감사 원장을 깬다.
-- ⑤ 창업연월을 create RPC 뒤에 별도 setCells로 썼다. 검증 실패면 회사는 이미 생기고,
--    두 번째 쓰기는 컬럼 부재를 조용히 넘기거나 새 값을 덮을 수 있다.
--
-- ## 무엇을 더한다 (기존 적용 마이그레이션은 손대지 않는다)
--
--   · board_item_detail_event_revisions (append-only, 무절단) + board_item_detail_edit_requests (내구 요청 원장)
--   · update_board_item_detail_event 8인자 정본 + 6인자 호환 전달 (둘 다 가시성·권한·시스템보드·NULL-safe·원장·버전 검사)
--   · create_new_lead_with_founded_month (기존 create는 그대로, 새 wrapper만 추가)
--   · 기존 행의 body는 손대지 않는다. 넓은 테이블 GRANT는 없다.

alter table public.board_item_detail_events
  add column if not exists edited_at timestamptz,
  add column if not exists edit_count integer not null default 0;

-- 개정 이력: 한 번 쓴 옛 본문은 여기서만 늘어난다. UPDATE/DELETE 없음.
create table if not exists public.board_item_detail_event_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_id uuid not null references public.board_item_detail_events(id) on delete cascade,
  edit_number integer not null check (edit_number >= 1),
  body text not null check (length(btrim(body)) between 1 and 4000),
  editor uuid references public.users(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (event_id, edit_number)
);
create index if not exists board_item_detail_event_revisions_lookup_idx
  on public.board_item_detail_event_revisions(org_id, event_id, edit_number);
alter table public.board_item_detail_event_revisions enable row level security;
alter table public.board_item_detail_event_revisions force row level security;
revoke all on public.board_item_detail_event_revisions from public, anon, authenticated, service_role;

-- 고치기 요청 원장: (org, request) 하나로 actor/event/action/payload와 결과를 묶는다.
create table if not exists public.board_item_detail_edit_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  event_id uuid not null references public.board_item_detail_events(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  action text not null default 'edit' check (action = 'edit'),
  payload jsonb not null,
  result_body text not null,
  result_edit_count integer not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id)
);
create index if not exists board_item_detail_edit_requests_event_idx
  on public.board_item_detail_edit_requests(org_id, event_id);
alter table public.board_item_detail_edit_requests enable row level security;
alter table public.board_item_detail_edit_requests force row level security;
revoke all on public.board_item_detail_edit_requests from public, anon, authenticated, service_role;

-- ## 고치기 정본 (8인자). 순서가 곧 보안이다:
--  actor -> 권한(effective_permission) -> 현재 가시성+시스템보드 -> 행 잠금 ->
--  성격/삭제 -> NULL-safe 소유 -> 원장 replay(인증 뒤) -> 버전/기준선 -> 저장.
--  넓은 GRANT 없음. 기존 body를 마이그레이션이 고치지 않는다.
create or replace function public.update_board_item_detail_event(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_event_id uuid,
  p_body text, p_request_id uuid,
  p_expected_edit_count integer,
  p_base_body text
) returns public.board_item_detail_events
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_row public.board_item_detail_events;
  v_role text;
  v_assigned_to uuid;
  v_is_system boolean;
  v_history jsonb;
  v_payload jsonb;
  v_ledger public.board_item_detail_edit_requests%rowtype;
  v_new_body text := btrim(coalesce(p_body, ''));
  v_base text := nullif(btrim(coalesce(p_base_body, '')), '');
begin
  if v_actor is null then raise exception 'permission_denied' using errcode = '42501'; end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null then raise exception 'invalid_detail_event_edit' using errcode = '22023'; end if;
  if length(v_new_body) not between 1 and 4000 then
    raise exception 'invalid_detail_event' using errcode = '22023';
  end if;
  if p_expected_edit_count is null or p_expected_edit_count < 0 or v_base is null then
    raise exception 'invalid_detail_event_edit' using errcode = '22023';
  end if;

  -- 같은 트랜잭션 안에서 같은 열쇠가 두 번 들어오면 하나로 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended('detail-event-edit:' || p_event_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));

  -- 현재 가시성: 활성 멤버 + (owner/admin/all 또는 현재 담당자). 재배정 뒤 옛 담당자는 여기서 떨어진다.
  -- 시스템 보드는 고치지 않는다. 보드 org까지 함께 묶어 cross-org 튜플을 막는다.
  select i.assigned_to, m.role, b.is_system into v_assigned_to, v_role, v_is_system
    from public.items i
    join public.boards b on b.id = i.board_id and b.org_id = i.org_id
    join public.org_members m on m.org_id = i.org_id and m.user_id = v_actor and m.status = 'active'
   where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id and i.deleted_at is null
     and (m.role in ('owner', 'admin') or m.scope = 'all' or i.assigned_to = v_actor);
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;
  if coalesce(v_is_system, false) then raise exception 'permission_denied' using errcode = '42501'; end if;

  -- 행 잠금: 가시성·인증·replay·저장을 한 트랜잭션의 같은 행 잠금 안에서 묶는다.
  select * into v_row from public.board_item_detail_events
   where id = p_event_id and org_id = p_org_id and board_id = p_board_id and item_id = p_item_id
   for update;
  if not found then raise exception 'detail_event_not_found' using errcode = 'P0002'; end if;

  -- 자동 생성은 누구도 못 고친다. 사람이 고를 수 있는 넷만 받는다.
  if v_row.kind not in ('memo', 'call', 'admin', 'meeting') then
    raise exception 'invalid_detail_event_edit' using errcode = '22023';
  end if;
  if v_row.kind = 'field_change' then
    raise exception 'invalid_detail_event_edit' using errcode = '22023';
  end if;
  if v_row.deleted_at is not null then
    raise exception 'detail_event_removed' using errcode = '22023';
  end if;

  -- NULL-safe 소유: actor NULL은 내 것이 아니다. 대표는 사람이 쓴 줄만 고친다.
  if not (v_role = 'owner' or (v_row.actor_id is not null and v_row.actor_id = v_actor)) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'action', 'edit',
    'body', v_new_body,
    'expected_edit_count', p_expected_edit_count,
    'base_body', v_base
  );

  -- 내구 원장: 인증을 통과한 뒤에만 읽고 돌려준다. 인증 전 replay 반환은 누설이다.
  select * into v_ledger from public.board_item_detail_edit_requests
   where org_id = p_org_id and request_id = p_request_id;
  if found then
    if v_ledger.event_id <> p_event_id
       or v_ledger.actor_id <> v_actor
       or v_ledger.payload <> v_payload then
      raise exception 'request_replay_conflict' using errcode = '23505';
    end if;
    -- 같은 요청·같은 내용이라도 뒤에 다른 편집이 끼었으면 옛글로 되돌리지 않는다.
    if v_row.body <> v_ledger.result_body or v_row.edit_count <> v_ledger.result_edit_count then
      raise exception 'request_replay_conflict' using errcode = '23505';
    end if;
    return v_row;
  end if;

  -- 버전/기준선: 다른 요청의 낡은 초안은 여기서 떨어진다. 첫 고침(0)은 기준선 없이도 된다.
  if v_row.edit_count > 0 and p_expected_edit_count is null and v_base is null then
    raise exception 'stale_detail_event_edit' using errcode = '23505';
  end if;
  if p_expected_edit_count is not null and p_expected_edit_count <> v_row.edit_count then
    raise exception 'stale_detail_event_edit' using errcode = '23505';
  end if;
  if v_base is not null and v_row.body <> v_base then
    raise exception 'stale_detail_event_edit' using errcode = '23505';
  end if;

  -- 동일 본문도 요청은 소비하되 수정 이력은 늘리지 않는다.
  if v_row.body = v_new_body then
    insert into public.board_item_detail_edit_requests(
      org_id, request_id, event_id, actor_id, action, payload, result_body, result_edit_count
    ) values (
      p_org_id, p_request_id, p_event_id, v_actor, 'edit', v_payload, v_row.body, v_row.edit_count
    );
    return v_row;
  end if;

  -- 개정은 잘라내지 않는다. 옛 본문은 revision 테이블에 한 줄로 남긴다.
  insert into public.board_item_detail_event_revisions(org_id, event_id, edit_number, body, editor, request_id)
  values (p_org_id, p_event_id, v_row.edit_count + 1, v_row.body, v_actor, p_request_id);

  v_history := coalesce(v_row.metadata -> 'edit_history', '[]'::jsonb);
  if jsonb_typeof(v_history) <> 'array' then v_history := '[]'::jsonb; end if;
  v_history := v_history || jsonb_build_array(jsonb_build_object(
    'body', v_row.body, 'edited_at', now(), 'editor', v_actor
  ));

  update public.board_item_detail_events
     set body = v_new_body,
         edited_at = now(),
         edit_count = v_row.edit_count + 1,
         metadata = coalesce(v_row.metadata, '{}'::jsonb)
           || jsonb_build_object(
             'edit_history', v_history,
             'last_edit_request_id', p_request_id::text
           )
   where id = p_event_id
  returning * into v_row;

  insert into public.board_item_detail_edit_requests(
    org_id, request_id, event_id, actor_id, action, payload, result_body, result_edit_count
  ) values (
    p_org_id, p_request_id, p_event_id, v_actor, 'edit', v_payload, v_row.body, v_row.edit_count
  );

  return v_row;
end $$;

-- 최초 추가 함수이므로 무버전 호환 호출을 만들지 않는다.
revoke all on function public.update_board_item_detail_event(uuid, uuid, uuid, uuid, text, uuid, integer, text) from public, anon;
grant execute on function public.update_board_item_detail_event(uuid, uuid, uuid, uuid, text, uuid, integer, text) to authenticated;

-- ## 창업연월 원자 생성 (신규 wrapper, 기존 create_new_lead는 그대로).
--
-- 결함: 접수 액션이 create 뒤에 parse→setCells를 따로 썼다. 월이 틀리면 회사는 이미 생기고,
-- 두 번째 쓰기는 컬럼 부재를 조용히 넘기거나 새 값을 덮을 수 있다.
-- 정본: 월 형식·컬럼 존재를 어떤 INSERT보다 먼저 판정하고, 월을 같은 트랜잭션·같은
-- 요청 payload에 넣어 한 번에 기록한다. 실패하면 deal/item/value가 하나도 안 남는다.
-- 같은 request로 월이 다르면 22023, 뒤에 월이 바뀌었는데 옛 요청을 replay하면 덮지 않고 돌려준다.
drop function if exists public.create_new_lead_with_founded_month(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[],text
);
create function public.create_new_lead_with_founded_month(
  p_org_id uuid, p_board_id uuid, p_group_id uuid, p_request_id uuid, p_title text,
  p_representative_name text default null, p_phone text default null, p_email text default null,
  p_business_registration_type text default null, p_industry text default null,
  p_industry_code text default null, p_revenue_band text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_acquisition_source text default null, p_source_external_id text default null,
  p_assigned_to uuid default null, p_address_detail text default null,
  p_collaborator_ids uuid[] default '{}'::uuid[],
  p_founded_month text default null
) returns table(deal_id uuid, item_id uuid, replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid(); v_role text; v_scope text; v_assignee uuid;
  v_stage uuid; v_pipeline uuid; v_deal uuid; v_item uuid;
  v_payload jsonb; v_prior public.new_lead_requests%rowtype;
  v_phone text := nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
  v_applied_on date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_collaborators uuid[];
  v_founded text := nullif(btrim(coalesce(p_founded_month,'')),'');
  v_founded_ok boolean;
begin
  -- 어떤 INSERT보다 먼저: 월 형식 판정. 여기서 떨어지면 회사가 생기지 않는다.
  if v_founded is not null then
    v_founded_ok :=
      v_founded ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or (v_founded ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          and (v_founded::date)::text = v_founded);
    if not coalesce(v_founded_ok, false) then
      raise exception 'founded_month invalid: %', v_founded using errcode='22023';
    end if;
    -- 실제 컬럼이 없으면 성공을 돌려주지 않는다. 조용한 누락을 성공이라 부르지 않는다.
    if not exists(
      select 1 from public.board_columns
       where org_id=p_org_id and board_id=p_board_id and key='founded_month' and archived_at is null
    ) then
      raise exception 'founded_month column missing' using errcode='22023';
    end if;
  end if;

  if v_actor is null or p_request_id is null or nullif(btrim(coalesce(p_title,'')),'') is null then
    raise exception 'new lead input required' using errcode='22023';
  end if;
  select m.role::text,m.scope::text into v_role,v_scope
    from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if not found or not public.effective_permission(p_org_id,'work.item_upsert') then
    raise exception 'new lead permission denied' using errcode='42501';
  end if;
  v_assignee := coalesce(p_assigned_to,v_actor);
  if v_assignee<>v_actor and not (v_role in ('owner','admin') or v_scope='all') then
    raise exception 'new lead assignee denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=v_assignee and m.status='active') then
    raise exception 'new lead assignee unavailable' using errcode='42501';
  end if;
  select coalesce(array_agg(distinct x.user_id order by x.user_id),'{}'::uuid[])
    into v_collaborators from unnest(coalesce(p_collaborator_ids,'{}'::uuid[])) x(user_id);
  if exists(
    select 1 from unnest(v_collaborators) x(user_id)
    where not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=x.user_id and m.status='active')
  ) then
    raise exception 'new lead collaborator unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and b.source='core.default-tab/new-lead')
     or not exists(select 1 from public.board_groups g where g.id=p_group_id and g.board_id=p_board_id and g.org_id=p_org_id) then
    raise exception 'new lead projection target unavailable' using errcode='22023';
  end if;

  v_payload := jsonb_build_object(
    'title',btrim(p_title),'representative_name',p_representative_name,'phone',v_phone,'email',v_email,
    'business_registration_type',p_business_registration_type,'industry',p_industry,'industry_code',p_industry_code,
    'revenue_band',p_revenue_band,'region_sido',p_region_sido,'region_sigungu',p_region_sigungu,
    'address_detail',p_address_detail,'acquisition_source',p_acquisition_source,'source_external_id',p_source_external_id,
    'assigned_to',v_assignee,'collaborator_ids',to_jsonb(v_collaborators),'board_id',p_board_id,'group_id',p_group_id,
    'founded_month',v_founded
  );
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation<>'create' or v_prior.payload<>v_payload or v_prior.actor_id<>v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023';
    end if;
    -- 뒤에 월이 바뀌었어도 옛 요청 replay가 새 값을 덮지 않는다. 그대로 돌려준다.
    return query select v_prior.deal_id,v_prior.item_id,true; return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bbe272:new-lead-stage:'||p_org_id::text,0));
  select s.id,s.pipeline_id into v_stage,v_pipeline
    from public.stages s join public.pipelines p on p.id=s.pipeline_id
   where p.org_id=p_org_id and s.kind::text='marketing'
   order by p.id,s.sort_order,s.id limit 1;
  if v_stage is null then
    select p.id into v_pipeline from public.pipelines p where p.org_id=p_org_id order by p.id limit 1;
    if v_pipeline is null then
      insert into public.pipelines(org_id,name) values(p_org_id,'기본 파이프라인') returning id into v_pipeline;
    end if;
    insert into public.stages(pipeline_id,name,sort_order,kind)
      select v_pipeline,'신규고객',coalesce(max(s.sort_order)+1,0),'marketing'::public.stage_kind
        from public.stages s where s.pipeline_id=v_pipeline returning id into v_stage;
  end if;

  insert into public.deals(org_id,company_id,pipeline_id,stage_id,assigned_to,title,applied_on)
    values(p_org_id,null,v_pipeline,v_stage,v_assignee,btrim(p_title),v_applied_on) returning id into v_deal;
  insert into public.deal_intake(
    deal_id,org_id,representative_name,phone_normalized,phone_display,email_normalized,
    business_registration_type,industry,industry_code,revenue_band,region_sido,region_sigungu,
    address_detail,acquisition_source,source_external_id
  ) values(
    v_deal,p_org_id,nullif(btrim(coalesce(p_representative_name,'')),''),v_phone,nullif(btrim(coalesce(p_phone,'')),''),v_email,
    nullif(btrim(coalesce(p_business_registration_type,'')),''),nullif(btrim(coalesce(p_industry,'')),'' ),
    nullif(btrim(coalesce(p_industry_code,'')),''),nullif(btrim(coalesce(p_revenue_band,'')),'' ),
    nullif(btrim(coalesce(p_region_sido,'')),''),nullif(btrim(coalesce(p_region_sigungu,'')),'' ),
    nullif(btrim(coalesce(p_address_detail,'')),''),nullif(btrim(coalesce(p_acquisition_source,'')),'' ),
    nullif(btrim(coalesce(p_source_external_id,'')),'' )
  );
  insert into public.items(org_id,board_id,group_id,title,assigned_to,deal_id)
    values(p_org_id,p_board_id,p_group_id,btrim(p_title),v_assignee,v_deal) returning id into v_item;

  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select p_org_id,v_item,x.key,x.value
    from jsonb_each(jsonb_build_object(
      'owner',to_jsonb(v_assignee),'collaborators',to_jsonb(v_collaborators),'applied_on',to_jsonb(v_applied_on),
      'phone',to_jsonb(nullif(btrim(coalesce(p_phone,'')),'')),'rep_name',to_jsonb(nullif(btrim(coalesce(p_representative_name,'')),'')),
      'biz_reg_type',to_jsonb(nullif(btrim(coalesce(p_business_registration_type,'')),'')),
      'industry',to_jsonb(nullif(btrim(coalesce(p_industry,'')),'')),'revenue_band',to_jsonb(nullif(btrim(coalesce(p_revenue_band,'')),'')),
      'sido',to_jsonb(nullif(btrim(coalesce(p_region_sido,'')),'')),'sigungu',to_jsonb(nullif(btrim(coalesce(p_region_sigungu,'')),'')),
      'email',to_jsonb(v_email),'ad_name',to_jsonb(nullif(btrim(coalesce(p_acquisition_source,'')),'')),
      'business_registration_type',to_jsonb(nullif(btrim(coalesce(p_business_registration_type,'')),'')),
      'region_sido',to_jsonb(nullif(btrim(coalesce(p_region_sido,'')),'')),
      'region_sigungu',to_jsonb(nullif(btrim(coalesce(p_region_sigungu,'')),'')),
      'acquisition_source',to_jsonb(nullif(btrim(coalesce(p_acquisition_source,'')),'')),
      'founded_month',to_jsonb(v_founded),
      'absence_notice',to_jsonb('해당 없음'::text),'consult1_notice',to_jsonb('해당 없음'::text),
      'confirm2_notice',to_jsonb('해당 없음'::text),'feedback_status',to_jsonb('미입력'::text),
      'consult_status',to_jsonb('상담 전'::text),'contact_move',to_jsonb('컨택 대기'::text)
    )) x
    join public.board_columns c on c.org_id=p_org_id and c.board_id=p_board_id and c.key=x.key
   where x.value <> 'null'::jsonb;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
    values(p_org_id,v_item,'address_detail',to_jsonb(nullif(btrim(coalesce(p_address_detail,'')),'')))
  on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;

  -- 월을 달라고 했으면 같은 트랜잭션 안에서 반드시 남아 있어야 한다. 없으면 전체를 되돌린다.
  if v_founded is not null and not exists(
    select 1 from public.item_values iv where iv.item_id=v_item and iv.column_key='founded_month' and iv.value_jsonb=to_jsonb(v_founded)
  ) then
    raise exception 'founded_month persist failed' using errcode='22023';
  end if;

  insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
  select p_org_id,v_deal,x.key,null,x.value,
         case
           when x.key='owner' and p_assigned_to is not null then 'manual'
           when x.key=any(array['applied_on','owner','contact_move','consult_status','absence_notice','consult1_notice','confirm2_notice','feedback_status']) then 'system'
           else 'manual'
         end,
         v_actor,p_request_id
    from jsonb_each(jsonb_build_object(
      'title',to_jsonb(btrim(p_title)),'representative_name',to_jsonb(nullif(btrim(coalesce(p_representative_name,'')),'')),
      'phone',to_jsonb(nullif(btrim(coalesce(p_phone,'')),'')),'email',to_jsonb(v_email),
      'business_registration_type',to_jsonb(nullif(btrim(coalesce(p_business_registration_type,'')),'')),
      'industry',to_jsonb(nullif(btrim(coalesce(p_industry,'')),'')),'revenue_band',to_jsonb(nullif(btrim(coalesce(p_revenue_band,'')),'')),
      'region_sido',to_jsonb(nullif(btrim(coalesce(p_region_sido,'')),'')),'region_sigungu',to_jsonb(nullif(btrim(coalesce(p_region_sigungu,'')),'')),
      'address_detail',to_jsonb(nullif(btrim(coalesce(p_address_detail,'')),'')),
      'acquisition_source',to_jsonb(nullif(btrim(coalesce(p_acquisition_source,'')),'')),
      'applied_on',to_jsonb(v_applied_on),'owner',to_jsonb(v_assignee),'collaborators',to_jsonb(v_collaborators),
      'contact_move',to_jsonb('컨택 대기'::text),'consult_status',to_jsonb('상담 전'::text),
      'absence_notice',to_jsonb('해당 없음'::text),'consult1_notice',to_jsonb('해당 없음'::text),
      'confirm2_notice',to_jsonb('해당 없음'::text),'feedback_status',to_jsonb('미입력'::text),
      'founded_month',to_jsonb(v_founded)
    )) x;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'create',v_deal,v_item,v_actor,v_payload);
  return query select v_deal,v_item,false;
end $$;

revoke all on function public.create_new_lead_with_founded_month(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[],text
) from public,anon,service_role;
grant execute on function public.create_new_lead_with_founded_month(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[],text
) to authenticated;

-- ## 적용 뒤 사실 확인: 더한 것만 있고, 기존 행은 그대로다.
do $$
declare
  v_allowed text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'board_item_detail_events' and column_name = 'edited_at'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'board_item_detail_events' and column_name = 'edit_count'
  ) then
    raise exception '고침 표시 컬럼이 안 생겼습니다' using errcode = '22023';
  end if;
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'board_item_detail_event_revisions'
  ) or not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'board_item_detail_edit_requests'
  ) then
    raise exception '개정·원장 테이블이 안 생겼습니다' using errcode = '22023';
  end if;
  select pg_get_constraintdef(oid) into v_allowed
  from pg_constraint
  where conrelid = 'public.board_item_detail_events'::regclass
    and conname = 'board_item_detail_events_kind_check';
  if v_allowed is null or v_allowed not like '%memo%' or v_allowed not like '%field_change%' then
    raise exception '기존 성격 허용 목록이 바뀌었습니다: %', coalesce(v_allowed, '(제약 없음)') using errcode = '22023';
  end if;
end $$;

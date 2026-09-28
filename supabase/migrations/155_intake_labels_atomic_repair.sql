-- moa-migration-guard: logical_key=155_intake_labels_atomic_repair predecessor=154_document_ocr_metadata digest=7a16619cc73e33cd038946492c2e70ed8be9e455a32d80e9143dc8cd39d1da28 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '155_intake_labels_atomic_repair',
  p_file_name => '155_intake_labels_atomic_repair.sql',
  p_file_digest => '7a16619cc73e33cd038946492c2e70ed8be9e455a32d80e9143dc8cd39d1da28',
  p_expected_predecessor => '154_document_ocr_metadata',
  p_executor => 'DG',
  p_thread_id => 'moawork-v17-intake-labels-repair-20260926',
  p_foundation => false
);

-- v17-intake-labels-repair: 읽기-합치기-쓰기 경합 수리 (draft, 미적용).
--
-- ## 왜 (부모 리뷰 P1 두 건)
--
-- 1 라벨 읽기-합치기-쓰기 + 저장뒤 재조회는 동시 추가를 지키지 못한다.
--   A쓰기 -> A읽기(성공), B쓰기(낡은 스냅샷) -> B읽기(성공) 뒤 A가 사라진다.
--   requestId는 검사만 하고 원장에 묶지 않았다. 재시도 고리는 «성공 보고 뒤»
--   다시 쓸 수 있어 덮어쓰기를 넓힌다.
-- 2 새 회사 만들기 + 업무 시작이 원자적이지 않다. 같은 틱 이중 제출이 둘 다
--   중복 검사를 통과하면 회사가 둘 생기고, 응답만 잃으면 재시도가 후보를
--   돌려줘 성공이 아니다. companyRequestId는 아무 데도 묶이지 않았다.
--
-- ## 무엇을 더한다 (150 이하는 손대지 않는다)
--
--   · board_label_append_requests (요청 원장: actor/request/payload <-> 결과)
--   · append_board_column_label_option (컬럼 잠금 아래 원자 추가)
--   · company_intake_requests (요청 원장: 회사+딜+아이템 묶음)
--   · create_company_and_start_work (회사 등록 + 업무 시작 한 트랜잭션)
--
-- 151/152 consult, 153 items, 154 OCR 예약 — 이 파일은 155를 쓴다.
-- 기존 행의 options_jsonb·회사·딜은 이 마이그레이션이 고치지 않는다.

-- 라벨 추가 요청 원장: (org, request) 하나로 actor/payload와 결과를 묶는다.
create table if not exists public.board_label_append_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  column_id uuid not null references public.board_columns(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  payload jsonb not null,
  option_id text not null,
  created boolean not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id)
);
create index if not exists board_label_append_requests_column_idx
  on public.board_label_append_requests(org_id, column_id);
alter table public.board_label_append_requests enable row level security;
alter table public.board_label_append_requests force row level security;
revoke all on public.board_label_append_requests from public, anon, authenticated, service_role;
drop policy if exists board_label_append_requests_read on public.board_label_append_requests;
create policy board_label_append_requests_read on public.board_label_append_requests
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- 회사 등록+업무 시작 요청 원장: 같은 열쇠+같은 내용이면 같은 회사·딜을 돌려준다.
create table if not exists public.company_intake_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  deal_id uuid not null references public.deals(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id),
  unique (org_id, deal_id),
  unique (org_id, item_id)
);
alter table public.company_intake_requests enable row level security;
alter table public.company_intake_requests force row level security;
revoke all on public.company_intake_requests from public, anon, authenticated, service_role;
drop policy if exists company_intake_requests_read on public.company_intake_requests;
create policy company_intake_requests_read on public.company_intake_requests
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    and public.is_org_member(org_id)
  );

-- ## 라벨 원자 추가 정본.
-- 순서가 곧 동시성이다: actor -> 권한 -> 요청 원장 잠금·replay ->
-- 컬럼 직렬화 잠금 -> 행 잠금 -> 정책 가드 -> 중복 판정 -> 추가.
-- 호출자가 읽은 스냅샷은 쓰기 경로에 쓰지 않는다 — 서버가 잠금 아래 다시 읽는다.
create or replace function public.append_board_column_label_option(
  p_org_id uuid,
  p_board_id uuid,
  p_column_id uuid,
  p_request_id uuid,
  p_label text
) returns table(option_id text, created boolean, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_display text := nullif(regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g'), '');
  v_wanted text := lower(v_display);
  v_role text;
  v_scope text;
  v_ctype text;
  v_ckey text;
  v_csource text;
  v_readonly boolean;
  v_move_rule jsonb;
  v_full jsonb;
  v_optkey text;
  v_opt jsonb;
  v_dup_id text := null;
  v_max_order integer := -1;
  v_ord integer;
  v_new_arr jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_prior public.board_label_append_requests%rowtype;
begin
  if v_actor is null or p_request_id is null or p_org_id is null
     or p_board_id is null or p_column_id is null or v_display is null then
    raise exception 'label append input required' using errcode = '22023';
  end if;

  -- 어떤 컬럼 읽기보다 먼저: 만들기 문턱은 «컬럼 관리»다.
  select m.role::text, m.scope::text
    into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id
     and m.user_id = v_actor
     and m.status = 'active'
     and o.status = 'active';
  if not found or not public.effective_permission(p_org_id, 'structure.column_manage') then
    raise exception 'label append permission denied' using errcode = '42501';
  end if;

  -- 요청 원장: 같은 열쇠+같은 내용이면 저장 없이 같은 답, 다른 내용이면 거절.
  v_payload := jsonb_build_object(
    'board_id', p_board_id, 'column_id', p_column_id, 'label', v_display);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select r.* into v_prior
    from public.board_label_append_requests r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.payload <> v_payload then
      raise exception 'label append idempotency key reuse' using errcode = '22023';
    end if;
    return query select v_prior.option_id, v_prior.created, true;
    return;
  end if;

  -- 같은 컬럼의 추가는 한 번에 하나씩 — 잠금 아래 다시 읽으므로 낡은 스냅샷이 없다.
  perform pg_advisory_xact_lock(hashtextextended('label-col:' || p_column_id::text, 0));
  select c.type::text, c.key, c.source::text, c.is_readonly, c.move_rule_jsonb, c.options_jsonb
    into v_ctype, v_ckey, v_csource, v_readonly, v_move_rule, v_full
    from public.board_columns c
    join public.boards b on b.id = c.board_id
   where c.id = p_column_id
     and c.org_id = p_org_id
     and c.board_id = p_board_id
     and b.org_id = p_org_id
     and not coalesce(b.is_system, false)
   for update of c;
  if not found then
    raise exception 'label append column unavailable' using errcode = '22023';
  end if;

  -- DB 경계의 정책 가드 (앱 label-options.ts와 같은 눈 — 서버가 마지막으로 본다).
  if v_ctype not in ('select', 'status', 'multiselect') then
    raise exception 'label append not creatable here' using errcode = '22023';
  end if;
  if v_ckey in ('contact_move', 'work_move', 'consult_status', 'contract_status',
                'progress_status', 'sido', 'sigungu')
     or v_ckey like 'seal\_%' escape '\' then
    raise exception 'label append protected column' using errcode = '22023';
  end if;
  if coalesce(v_readonly, false) or v_csource in ('calc', 'lk') then
    raise exception 'label append protected column' using errcode = '22023';
  end if;
  if v_move_rule is not null and v_move_rule <> '{}'::jsonb then
    raise exception 'label append protected column' using errcode = '22023';
  end if;

  -- 기존 배열은 어느 키(options/labels)에 있든 그 자리에서 읽고, 그 키에 쓴다.
  -- 최상위의 다른 키(메타데이터)는 jsonb_set이 그대로 둔다.
  if v_full is not null and v_full ? 'options' then
    v_optkey := 'options';
  elsif v_full is not null and v_full ? 'labels' then
    v_optkey := 'labels';
  else
    v_optkey := 'options';
  end if;
  v_new_arr := '[]'::jsonb;
  for v_opt in select * from jsonb_array_elements(coalesce(v_full -> v_optkey, '[]'::jsonb)) loop
    v_new_arr := v_new_arr || jsonb_build_array(v_opt);
    if (v_opt ->> 'id') = v_display
       or lower(regexp_replace(btrim(coalesce(v_opt ->> 'label', '')), '\s+', ' ', 'g')) = v_wanted then
      v_dup_id := v_opt ->> 'id';
    end if;
    if (v_opt ->> 'order') ~ '^-?[0-9]+$' then
      v_ord := (v_opt ->> 'order')::integer;
      if v_ord > v_max_order then v_max_order := v_ord; end if;
    end if;
  end loop;

  -- 중복이면 쓰지 않고 기존 id를 원장에 묶어 돌려준다 (자동 병합 없음).
  if v_dup_id is not null then
    insert into public.board_label_append_requests
      (org_id, request_id, column_id, actor_id, payload, option_id, created)
    values
      (p_org_id, p_request_id, p_column_id, v_actor, v_payload, v_dup_id, false);
    return query select v_dup_id, false, false;
    return;
  end if;

  -- 새 항목은 맨 뒤에 덧붙인다. 기존 항목의 id·label·color·order는 손대지 않는다.
  v_new_arr := v_new_arr || jsonb_build_object(
    'id', v_display, 'label', v_display, 'order', v_max_order + 1);
  update public.board_columns
     set options_jsonb = jsonb_set(coalesce(v_full, '{}'::jsonb), array[v_optkey], v_new_arr)
   where id = p_column_id;
  insert into public.board_label_append_requests
    (org_id, request_id, column_id, actor_id, payload, option_id, created)
  values
    (p_org_id, p_request_id, p_column_id, v_actor, v_payload, v_display, true);
  return query select v_display, true, false;
end;
$$;

revoke all on function public.append_board_column_label_option(uuid, uuid, uuid, uuid, text) from public, anon, service_role;
grant execute on function public.append_board_column_label_option(uuid, uuid, uuid, uuid, text) to authenticated;

comment on function public.append_board_column_label_option(uuid, uuid, uuid, uuid, text) is
  'v17-intake-labels-repair: locked atomic label append. Callers pass no snapshot; the server re-reads under lock.';

-- ## 새 회사 등록 + 업무 시작 원자 정본.
-- 순서가 곧 안전이다: actor -> 권한(회사 만들기 바탕+업무 시작) ->
-- 목표(보드·그룹) 실재 확인 -> 입력 검증 -> 요청 원장 잠금·replay ->
-- 영수증 인식 후보 확인(보이는 범위, 같은 이름) -> 회사·딜·아이템·원장 한 트랜잭션.
-- 목표가 가짜거나 권한이 없으면 회사를 만들지 않는다. 실패는 전체를 되돌린다.
-- replay는 후보 차단보다 먼저다: 잃어버린 응답의 같은 열쇠+같은 내용은
-- 자신이 막 만든 회사여도 같은 회사·딜로 돌려준다. genuinely new 열쇠만
-- 후보를 본다. 후보 차단은 막기만 하고 고객 데이터는 돌려주지 않는다 —
-- 목록은 앱이 보이는 범위에서 따로 읽는다. 155 배포가 앱보다 먼저다.
create or replace function public.create_company_and_start_work(
  p_org_id uuid,
  p_board_id uuid,
  p_group_id uuid,
  p_request_id uuid,
  p_name text,
  p_biz_type text default null,
  p_founded_on text default null,
  p_region text default null,
  p_phone text default null,
  p_owner_name text default null
) returns table(company_id uuid, deal_id uuid, item_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_founded text := nullif(btrim(coalesce(p_founded_on, '')), '');
  v_founded_ok boolean;
  v_board uuid;
  v_group uuid;
  v_pipeline uuid;
  v_stage uuid;
  v_company uuid;
  v_deal uuid;
  v_item uuid;
  v_payload jsonb;
  v_prior public.company_intake_requests%rowtype;
  v_normalized text;
begin
  if v_actor is null or p_request_id is null or p_org_id is null
     or p_board_id is null or v_name is null then
    raise exception 'company intake input required' using errcode = '22023';
  end if;

  -- 어떤 INSERT보다 먼저: 활성 멤버 + 업무 시작 권한. 회사 만들기는
  -- 활성 멤버 바탕(companies_rw와 같은 눈) + 아래 목표 확인 뒤에 잇는다.
  select m.role::text, m.scope::text
    into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id
     and m.user_id = v_actor
     and m.status = 'active'
     and o.status = 'active';
  if not found or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'company intake permission denied' using errcode = '42501';
  end if;

  -- 목표 실재 확인: 이 조직의 계약 실무 보드 + 그 안의 그룹이어야 한다.
  select b.id into v_board
    from public.boards b
   where b.id = p_board_id
     and b.org_id = p_org_id
     and b.source = 'core.default-tab/contract-work';
  if v_board is null then
    raise exception 'company intake target unavailable' using errcode = '22023';
  end if;
  if p_group_id is null then
    select g.id into v_group
      from public.board_groups g
     where g.org_id = p_org_id and g.board_id = v_board
     order by g.sort_order, g.id limit 1;
  else
    select g.id into v_group
      from public.board_groups g
     where g.id = p_group_id and g.org_id = p_org_id and g.board_id = v_board;
  end if;
  if v_group is null then
    raise exception 'company intake target unavailable' using errcode = '22023';
  end if;

  -- 창업연월-일자 검증도 INSERT보다 먼저: 여기서 떨어지면 회사가 생기지 않는다.
  if v_founded is not null then
    v_founded_ok := v_founded ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and (v_founded::date)::text = v_founded;
    if not coalesce(v_founded_ok, false) then
      raise exception 'company intake founded invalid: %', v_founded using errcode = '22023';
    end if;
  end if;

  -- 요청 원장: 같은 열쇠+같은 내용이면 같은 회사·딜을 돌려준다.
  v_payload := jsonb_build_object(
    'board_id', v_board, 'group_id', v_group, 'name', v_name,
    'biz_type', p_biz_type, 'founded_on', v_founded, 'region', p_region,
    'phone', p_phone, 'owner_name', p_owner_name);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select r.* into v_prior
    from public.company_intake_requests r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.payload <> v_payload then
      raise exception 'company intake idempotency key reuse' using errcode = '22023';
    end if;
    -- A receipt is not permanent access: assignment may have changed since creation.
    if not exists (select 1 from public.companies c
      where c.id = v_prior.company_id and c.org_id = p_org_id
        and c.merged_into is null
        and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor)) then
      raise exception 'company intake permission denied' using errcode = '42501';
    end if;
    return query select v_prior.company_id, v_prior.deal_id, v_prior.item_id, true;
    return;
  end if;

  -- 영수증 인식 후보 확인: replay를 지나온 genuinely new 열쇠만 본다.
  -- 같은 정규화 이름의 보이는 회사가 이미 있으면 막고 끝낸다 — 쓰기 없음.
  -- race를 막도록 정규화 이름에 자물쇠를 걸고 트랜잭션 안에서 다시 본다.
  -- 고객 데이터는 돌려주지 않는다 — 목록은 앱이 보이는 범위에서 따로 읽는다.
  -- 안 보이는 회사는 막지 않는다 (RLS 기존 동작: 만들 수 있다).
  v_normalized := lower(regexp_replace(btrim(v_name), '\s+', ' ', 'g'));
  perform pg_advisory_xact_lock(hashtextextended('company-name:' || p_org_id::text || ':' || v_normalized, 0));
  if exists(select 1 from public.companies c
     where c.org_id = p_org_id
       and lower(regexp_replace(btrim(c.name), '\s+', ' ', 'g')) = v_normalized
       and c.merged_into is null
       and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor)) then
    raise exception 'company intake duplicate candidate' using errcode = '22023';
  end if;

  insert into public.companies(org_id, name, biz_type, region, owner_name, phone, founded_on, assigned_to)
  values (p_org_id, v_name,
    nullif(btrim(coalesce(p_biz_type, '')), ''),
    nullif(btrim(coalesce(p_region, '')), ''),
    nullif(btrim(coalesce(p_owner_name, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    v_founded::date, v_actor)
  returning id into v_company;

  select s.pipeline_id, s.id into v_pipeline, v_stage
    from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = p_org_id
   order by p.id, s.sort_order, s.id
   limit 1;
  if v_stage is null then
    raise exception 'deal pipeline unavailable' using errcode = '22023';
  end if;

  insert into public.deals(org_id, company_id, pipeline_id, stage_id, assigned_to, title)
  values (p_org_id, v_company, v_pipeline, v_stage, v_actor, v_name)
  returning id into v_deal;

  insert into public.items(org_id, board_id, group_id, title, assigned_to, deal_id)
  values (p_org_id, v_board, v_group, v_name, v_actor, v_deal)
  returning id into v_item;

  -- 기존 시작 원장에도 같은 열쇠로 묶는다: 옛 경로 replay가 같은 답을 본다.
  insert into public.company_work_start_requests(org_id, request_id, company_id, actor_id, deal_id, item_id, payload)
  values (p_org_id, p_request_id, v_company, v_actor, v_deal, v_item,
    jsonb_build_object('company_id', v_company));
  insert into public.company_intake_requests(org_id, request_id, company_id, actor_id, deal_id, item_id, payload)
  values (p_org_id, p_request_id, v_company, v_actor, v_deal, v_item, v_payload);
  insert into public.audit_logs(org_id, actor, action, target_type, target_id, meta)
  values (p_org_id, v_actor, 'company.intake_started', 'deal', v_deal,
    jsonb_build_object('request_id', p_request_id, 'company_id', v_company, 'item_id', v_item));

  return query select v_company, v_deal, v_item, false;
end;
$$;

revoke all on function public.create_company_and_start_work(uuid, uuid, uuid, uuid, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.create_company_and_start_work(uuid, uuid, uuid, uuid, text, text, text, text, text, text) to authenticated;

comment on function public.create_company_and_start_work(uuid, uuid, uuid, uuid, text, text, text, text, text, text) is
  'v17-intake-labels-repair: atomic company intake. Target and permission are validated before any insert; one transaction or full rollback.';

do $$
begin
  if to_regprocedure('public.append_board_column_label_option(uuid, uuid, uuid, uuid, text)') is null then
    raise exception '155: label append function is missing';
  end if;
  if to_regprocedure('public.create_company_and_start_work(uuid, uuid, uuid, uuid, text, text, text, text, text, text)') is null then
    raise exception '155: company intake function is missing';
  end if;
  if to_regprocedure('public.start_company_work_v2(uuid, uuid, uuid, uuid)') is null then
    raise exception '155: existing 141 v2 function must survive';
  end if;
  if to_regprocedure('public.create_new_lead_with_founded_month(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[],text)') is null then
    raise exception '155: existing 150 wrapper must survive';
  end if;
end
$$;

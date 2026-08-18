-- moa-migration-guard: logical_key=098_bbe215_today_kpi_definitions predecessor=097_bbe201_new_lead_field_write_restore digest=574e35fae8acd5bbec27a0ed43dfceb0aa833843c291249c392179503b194a61 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '098_bbe215_today_kpi_definitions',
  p_file_name => '098_bbe215_today_kpi_definitions.sql',
  p_file_digest => '574e35fae8acd5bbec27a0ed43dfceb0aa833843c291249c392179503b194a61',
  p_expected_predecessor => '097_bbe201_new_lead_field_write_restore',
  p_executor => 'DC-12',
  p_thread_id => '019fe8b1-4c2a-7d31-9f60-2a7c51d4e8c1',
  p_foundation => false
);

-- BBE-215 — 홈 「오늘」 KPI 의 «정의» 를 총괄 확정대로 바꾼다.
--
-- 총괄 지적: 「그외 대시보드 정보 이상함(목업대조 요망)」(2026-08-18)
-- 목업(UI목업_워크스페이스_최종_v6.html:1528-1570)과 항목 단위로 대조한 결과,
-- KPI 다섯 중 «계산 가능한 둘» 의 정의가 목업과 코드에서 서로 달랐다.
--   목업: 상담 상황(상태)으로 센다        코드(086:78-95): 미팅/재통화 «날짜» 로 센다
--
-- 총괄 확정(2026-08-18):
--   · 「오늘 상담할 곳」을 «전화예정 / 미팅예정» 으로 «행동의 종류» 로 가른다
--   · 「재통화 대기」는 상담 상황 「1차 부재」 전부
--   · 「계약 대기」는 «계약서가 오가는 중인 것만» — 취소·보류는 빼라
--   · 계약금·수수료는 «수납» 기준 그대로 (086 정의 유지)
--
-- ★ 왜 «상태» 로 세도 되는가 — 이름이 바뀌었기 때문이다.
--   「오늘 상담할 곳」이었으면 상태로 세는 순간 «오늘» 이 의미를 잃는다(날짜와 무관해지니까).
--   그런데 총괄이 「전화예정 / 미팅예정」으로 개명했고, 「예정」은 날짜가 아니라
--   **해야 할 일의 종류**를 말한다. 개명이 정의를 정리했다.
--
-- ★★ 겹침이 «구조적으로» 불가능하다.
--   전화예정·재통화 대기·미팅예정을 상담 상황의 «서로 다른 값» 하나씩에 붙였다.
--   한 항목의 상담 상황은 값 하나뿐이므로 **같은 건이 두 칸에서 세어질 수 없다.**
--   규칙이 지키는 것이 아니라 데이터 모양이 보장한다.
--   (남는 값 「2차 상담완료」·「보류」·「거절」은 오늘 할 행동이 없는 상태라 어느 칸에도 안 든다.)
--
-- ═══ ★ 이 마이그레이션이 «가정» 하는 것 — 값 표기 ═══════════════════════════
--   아래 문자열이 `item_values.value_jsonb` 에 «글자 단위로» 그렇게 들어 있다고 가정한다.
--
--   근거(운영 조회가 아니라 «제품 코드» 다 — 그 컬럼을 만드는 것이 기본 탭 프리셋이다):
--     app/src/lib/default-tabs/new-lead.ts:212  key "consult_status"
--       options: 상담 전 · 1차 부재 · 2차 상담예약 · 2차 상담완료 · 보류 · 거절
--     app/src/lib/default-tabs/contact.ts:90    key "contract_status"
--       options: 계약 전 · 계약서 요청 · 계약서 작성완료 · 계약 보류 · 계약고민 ·
--                연결안됨 · 다시전화 · 진행했다함 · 미팅보류 · 미팅취소 · 계약취소
--     그리고 옵션의 id 가 label 이다(new-lead.ts:58 · contact.ts:14-18) —
--     즉 저장되는 값이 «라벨 문자열 그 자체» 다.
--
--   ★ 남는 위험: 사용자가 옵션을 «개명» 했거나, 프리셋이 바뀌기 «전» 에 만든 오래된
--     워크스페이스. 그건 코드로 확인할 수 없다. 그 경우 이 KPI 는 «조용히 0» 이 된다 —
--     쿼리는 성공하고 숫자만 0 이라 초록으로 실패한다.
--     → 그래서 아래 ③ 「미입력 신호」를 함께 넣는다. 그리고 값 분포를 세는 읽기 전용
--       SQL 을 별도로 전달한다(운영에서 총괄이 확인).
-- ═════════════════════════════════════════════════════════════════════════════
--
-- ★ 함께 넣는 것 ③ — 「0」과 「아직 안 채워졌다」를 가른다.
--   지금 086 은 `partial`(탭이 없다)과 `empty`(전부 0)만 가른다.
--   그런데 «탭은 있는데 그 컬럼을 아무도 안 채운» 워크스페이스도 전부 0 이 되고,
--   화면은 「오늘 처리할 업무가 없습니다」를 띄운다 — **있는 데이터를 없다고 하는 것**이다.
--   `missingSources` 가 「탭이 없다」를 이름으로 말하듯, `unfilledColumns` 가
--   「이 컬럼이 통째로 비었다」를 이름으로 말한다. 사용자가 무엇을 채워야 할지 알 수 있게.
--
-- ★ 함께 넣는 것 ④ — 온보딩 진행률(목업 :1565 「온보딩 이어하기 (3/8)」).
--   048_onboarding.sql 의 quest_defs(분모)·quest_progress(분자)로 «실제로» 셀 수 있다.
--   셀 근거가 없었으면 넣지 않았을 것이다 — 없는 숫자를 지어내지 않는다.
--
-- ※ 알림 「직속/계통 N단계」 배지는 이 마이그레이션에 «없다».
--   목업은 depth 를 목 데이터에 값으로 박아 두었을 뿐(:1556·:1575) «구하는 규칙» 이 없고,
--   스키마에도 depth 개념이 없다. 필드 추가가 아니라 규칙 설계라 별건으로 뺐다.

create or replace function public.read_today_dashboard(
  p_org_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_today date := (p_as_of at time zone 'Asia/Seoul')::date;
  v_month_start date := date_trunc('month', p_as_of at time zone 'Asia/Seoul')::date;
  v_month_end date := (date_trunc('month', p_as_of at time zone 'Asia/Seoul') + interval '1 month')::date;
  v_missing text[] := array[]::text[];
  v_unfilled text[] := array[]::text[];
  v_kpis jsonb;
  v_tasks jsonb;
  v_notifications jsonb;
  v_onboarding jsonb;
  v_action_count integer;
  v_lead_items integer;
  v_lead_filled integer;
  v_contact_items integer;
  v_contact_filled integer;
  v_work_items integer;
  v_fee_paid_filled integer;
  v_deposit_paid_filled integer;
begin
  if v_actor is null or p_org_id is null or p_as_of is null then
    raise exception 'authenticated dashboard request required' using errcode = '42501';
  end if;

  select membership.role::text, membership.scope::text
    into v_role, v_scope
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
   where membership.org_id = p_org_id
     and membership.user_id = v_actor
     and membership.status = 'active'
     and organization.status = 'active';
  if not found then
    raise exception 'org membership required' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'dashboard read permission required' using errcode = '42501';
  end if;

  if not exists (select 1 from public.boards where org_id = p_org_id and source = 'core.default-tab/new-lead') then
    v_missing := array_append(v_missing, 'new-lead');
  end if;
  if not exists (select 1 from public.boards where org_id = p_org_id and source = 'core.default-tab/contact') then
    v_missing := array_append(v_missing, 'contact');
  end if;
  if not exists (select 1 from public.boards where org_id = p_org_id and source = 'core.default-tab/contract-work') then
    v_missing := array_append(v_missing, 'work');
  end if;

  with visible_items as (
    select item.*, board.source
      from public.items item
      join public.boards board on board.id = item.board_id and board.org_id = item.org_id
     where item.org_id = p_org_id
       and board.source in ('core.default-tab/new-lead','core.default-tab/contact','core.default-tab/contract-work')
       and (v_role in ('owner','admin') or v_scope = 'all' or item.assigned_to = v_actor)
  ), values_typed as (
    select visible.id, visible.source, visible.assigned_to,
      -- ★ BBE-215: 상담 상황이 전화예정·재통화 대기·미팅예정 세 KPI 의 축이다.
      max(case when value.column_key = 'consult_status' then value.value_jsonb #>> '{}' end) as consult_status,
      max(case when value.column_key = 'contract_status' then value.value_jsonb #>> '{}' end) as contract_status,
      max(case when value.column_key = 'work_move' then value.value_jsonb #>> '{}' end) as work_move,
      max(case when value.column_key = 'contract_deposit' then value.value_jsonb #>> '{}' end) as deposit,
      max(case when value.column_key = 'contract_deposit_paid_on' then value.value_jsonb #>> '{}' end) as deposit_paid_on,
      max(case when value.column_key = 'fee_amount' then value.value_jsonb #>> '{}' end) as fee,
      max(case when value.column_key = 'fee_paid_on' then value.value_jsonb #>> '{}' end) as fee_paid_on
    from visible_items visible
    left join public.item_values value on value.item_id = visible.id and value.org_id = visible.org_id
    group by visible.id, visible.source, visible.assigned_to
  )
  select jsonb_build_object(
    -- ── 세 KPI 는 상담 상황의 «서로 다른 값» 하나씩이다. 겹칠 수 없다. ──
    'calls', count(*) filter (
      where source in ('core.default-tab/new-lead','core.default-tab/contact')
        and consult_status = '상담 전'
    ),
    'callbacks', count(*) filter (
      where source in ('core.default-tab/new-lead','core.default-tab/contact')
        and consult_status = '1차 부재'
    ),
    'meetings', count(*) filter (
      where source in ('core.default-tab/new-lead','core.default-tab/contact')
        and consult_status = '2차 상담예약'
    ),
    -- ★ 계약 대기 — «계약서가 오가는 중인 것만». 종전에는 계약상황이 «있기만 하면» 셌고,
    --   그래서 계약취소·연결안됨·미팅취소까지 「대기」로 들어가 숫자가 부풀어 있었다.
    'contractsWaiting', count(*) filter (
      where source = 'core.default-tab/contact'
        and contract_status in ('계약서 요청', '계약서 작성완료')
        and coalesce(work_move, '') = ''
    ),
    -- 금액 둘은 086 정의 그대로 — 「돈이 들어온 달」 기준(총괄 확정).
    'contractDeposits', coalesce(sum(
      case when source = 'core.default-tab/contract-work'
             and deposit_paid_on ~ '^\d{4}-\d{2}-\d{2}$'
             and deposit_paid_on::date >= v_month_start and deposit_paid_on::date < v_month_end
             and deposit ~ '^-?\d+(\.\d+)?$' then deposit::numeric else 0 end
    ), 0),
    'fees', coalesce(sum(
      case when source = 'core.default-tab/contract-work'
             and fee_paid_on ~ '^\d{4}-\d{2}-\d{2}$'
             and fee_paid_on::date >= v_month_start and fee_paid_on::date < v_month_end
             and fee ~ '^-?\d+(\.\d+)?$' then fee::numeric else 0 end
    ), 0)
  ),
  -- ★ 「0」과 「아직 안 채워졌다」를 가르기 위한 재료.
  --   항목이 «있는데» 그 컬럼이 하나도 안 채워졌다면 그건 「없음」이 아니라 「미입력」이다.
  count(*) filter (where source in ('core.default-tab/new-lead','core.default-tab/contact')),
  count(*) filter (
    where source in ('core.default-tab/new-lead','core.default-tab/contact')
      and coalesce(consult_status, '') <> ''
  ),
  count(*) filter (where source = 'core.default-tab/contact'),
  count(*) filter (
    where source = 'core.default-tab/contact'
      and coalesce(contract_status, '') <> ''
  ),
  -- ★ 금액 두 축의 «입력 여부» — 월 조건을 «뺀» 개수다(DC-18 요청).
  --   (A) 안으로 회사 현황 위젯이 이 RPC 값을 그대로 받아 쓰는데, 그때 0 이
  --   「이번 달 수납이 없다」인지 「아무도 입금일을 안 채웠다」인지 갈라야 한다.
  count(*) filter (where source = 'core.default-tab/contract-work'),
  count(*) filter (
    where source = 'core.default-tab/contract-work'
      and fee_paid_on ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  count(*) filter (
    where source = 'core.default-tab/contract-work'
      and deposit_paid_on ~ '^\d{4}-\d{2}-\d{2}$'
  )
  into v_kpis, v_lead_items, v_lead_filled, v_contact_items, v_contact_filled,
       v_work_items, v_fee_paid_filled, v_deposit_paid_filled
  from values_typed;

  if v_lead_items > 0 and v_lead_filled = 0 then
    v_unfilled := array_append(v_unfilled, 'consult_status');
  end if;
  if v_contact_items > 0 and v_contact_filled = 0 then
    v_unfilled := array_append(v_unfilled, 'contract_status');
  end if;
  -- ★ 금액 축도 같은 신호로 말한다. «새 필드» 를 따로 만들지 않는다 —
  --   같은 것을 두 가지 방법으로 말하면 둘 다 맞게 유지하는 일이 영원히 남는다.
  --   소비자(회사 현황 위젯)는 unfilledColumns 에 이 이름이 있는지만 보면 된다.
  if v_work_items > 0 and v_deposit_paid_filled = 0 then
    v_unfilled := array_append(v_unfilled, 'contract_deposit_paid_on');
  end if;
  if v_work_items > 0 and v_fee_paid_filled = 0 then
    v_unfilled := array_append(v_unfilled, 'fee_paid_on');
  end if;

  select coalesce(jsonb_agg(row order by rank, due_on, item_id), '[]'::jsonb)
    into v_tasks
    from (
      select jsonb_build_object(
        'kind', 'work_due', 'itemId', item.id, 'title', item.title,
        'dueOn', version.due_date, 'status', version.workflow_status,
        'href', '/work?notification=' || item.id::text
      ) row,
      case when version.due_date < v_today then 10 else 20 end rank,
      version.due_date due_on, item.id item_id
      from public.items item
      join public.boards board on board.id = item.board_id and board.org_id = item.org_id
      join public.work_item_versions version on version.item_id = item.id and version.org_id = item.org_id
      where item.org_id = p_org_id and board.source = 'core.default-tab/contract-work'
        and version.workflow_status not in ('done') and version.due_date <= v_today
        and (v_role in ('owner','admin') or v_scope = 'all' or item.assigned_to = v_actor)
      order by rank, due_on, item_id
      limit 5
    ) ranked;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', notification.id, 'type', notification.type, 'title', notification.title,
      'body', notification.body, 'targetType', notification.target_type,
      'targetId', notification.target_id, 'isAction', notification.is_action,
      'readAt', notification.read_at, 'createdAt', notification.created_at,
      'href', '/settings/notifications?notification=' || notification.id::text
    ) order by notification.created_at desc, notification.id), '[]'::jsonb)
    into v_notifications
    from (select * from public.notifications
      where org_id = p_org_id and user_id = v_actor and resolved_at is null
      order by created_at desc, id limit 5) notification;

  -- ★ 온보딩 진행률 — 목업의 「온보딩 이어하기 (3/8)」.
  --   분모가 0 이면(정의가 아직 안 심어짐) 화면이 「(0/0)」을 그리지 않도록 null 을 준다.
  select jsonb_build_object(
      'completed', (select count(*) from public.onboarding_quest_progress where org_id = p_org_id),
      'total', (select count(*) from public.onboarding_quest_defs)
    ) into v_onboarding;
  if (v_onboarding->>'total')::int = 0 then
    v_onboarding := null;
  end if;

  v_action_count := jsonb_array_length(v_tasks) + jsonb_array_length(v_notifications);
  return jsonb_build_object(
    'version', 2,
    'orgId', p_org_id,
    'viewer', jsonb_build_object('userId', v_actor, 'role', v_role, 'scope', v_scope),
    'asOf', p_as_of,
    'timezone', 'Asia/Seoul',
    'period', jsonb_build_object('today', v_today, 'monthStart', v_month_start, 'monthEndExclusive', v_month_end),
    -- ★ 판정 순서가 중요하다: 탭 없음 > 컬럼 미입력 > 진짜 0.
    --   미입력을 empty 로 접으면 「있는 데이터를 없다고」 하는 것이고, 그것이 이 카드의 발단이다.
    'status', case
      when cardinality(v_missing) > 0 then 'partial'
      when cardinality(v_unfilled) > 0 then 'unfilled'
      when v_action_count = 0
        and (v_kpis->>'calls')::int = 0 and (v_kpis->>'callbacks')::int = 0
        and (v_kpis->>'meetings')::int = 0 and (v_kpis->>'contractsWaiting')::int = 0
        and (v_kpis->>'contractDeposits')::numeric = 0 and (v_kpis->>'fees')::numeric = 0
      then 'empty' else 'ready' end,
    'missingSources', to_jsonb(v_missing),
    'unfilledColumns', to_jsonb(v_unfilled),
    'kpis', v_kpis,
    'tasks', v_tasks,
    'notifications', v_notifications,
    'onboarding', v_onboarding
  );
end;
$$;

revoke all on function public.read_today_dashboard(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.read_today_dashboard(uuid, timestamptz) to authenticated;

-- 되돌리는 법 (096·097 과 같은 형식으로 남긴다):
--   086_dashboard_daily_read_model.sql 의 `create or replace function public.read_today_dashboard`
--   블록을 그대로 다시 실행하면 된다. 이 마이그레이션은 그 함수 «하나만» 바꾸므로
--   테이블·권한·정책은 되돌릴 것이 없다.
--   ★ 단, 되돌리면 앱이 기대하는 kpis 키(calls·meetings)와 payload(unfilledColumns·onboarding)가
--     사라진다. 앱을 함께 되돌리지 않으면 홈이 그 필드를 못 찾는다. 짝으로 되돌려라.

-- ③ 적용됐고 «동작하는지» 이 마이그레이션 안에서 스스로 확인한다.
--    「적용했다」와 「적용돼서 동작한다」는 다르다.
do $$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'read_today_dashboard';
  if v_src is null then
    raise exception 'read_today_dashboard is missing after this migration';
  end if;

  -- 새 정의가 실제로 들어갔는가 — 세 KPI 가 상담 상황 «값» 으로 갈리는지 본다.
  if position('''상담 전''' in v_src) = 0
     or position('''1차 부재''' in v_src) = 0
     or position('''2차 상담예약''' in v_src) = 0 then
    raise exception 'consult_status based KPIs did not land (전화예정/재통화/미팅예정)';
  end if;

  -- 계약 대기가 «좁혀졌는가». 종전처럼 「있기만 하면」 세는 형태가 남아 있으면 안 된다.
  if position('''계약서 요청''' in v_src) = 0 or position('''계약서 작성완료''' in v_src) = 0 then
    raise exception 'contractsWaiting was not narrowed to in-flight contract states';
  end if;

  -- 「0 vs 미입력」 신호가 실제로 payload 에 들어갔는가.
  if position('unfilledColumns' in v_src) = 0 then
    raise exception 'unfilledColumns signal is missing — 0 과 미입력이 다시 뭉개진다';
  end if;

  -- 실행 권한이 authenticated 에게만 있는가(086 과 같은 상태여야 한다).
  if not has_function_privilege('authenticated', 'public.read_today_dashboard(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on read_today_dashboard';
  end if;
  if has_function_privilege('anon', 'public.read_today_dashboard(uuid, timestamptz)', 'EXECUTE') then
    raise exception 'anon must not hold EXECUTE on read_today_dashboard';
  end if;
end $$;

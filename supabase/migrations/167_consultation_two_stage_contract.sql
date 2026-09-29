-- moa-migration-guard: logical_key=167_consultation_two_stage_contract predecessor=166_reserve_join_workspace_slug digest=1c869aa610d824a487fdafac77ef660352978093545d6cda81aa7c2a11f67daa foundation=false

select public.begin_guarded_migration(
  p_logical_key => '167_consultation_two_stage_contract',
  p_file_name => '167_consultation_two_stage_contract.sql',
  p_file_digest => '1c869aa610d824a487fdafac77ef660352978093545d6cda81aa7c2a11f67daa',
  p_expected_predecessor => '166_reserve_join_workspace_slug',
  p_executor => 'DC',
  p_thread_id => '63273a2d-03eb-493b-8869-1b9f92113379',
  p_foundation => false
);

-- 167_consultation_two_stage_contract — #830 계약 확인 4단계 → 2단계 (2026-09-29 오너 승인).
--
-- ★ 무엇이 바뀌나
--   · 계약 확인 = 1단계 «계약금 입금 확인» + 2단계 «직인». 1단계는 보드 칸
--     item_values.contract_fee_status = '계약금 완' 이 정본이다(4단계 체크리스트 대신).
--     2단계는 기존 직인 정본(보드 seal_status '완료' AND deals.custom 직인 '완료')을 그대로 쓴다.
--   · 직인 승인·실무 인계(161)와 인계 게이트(151 block reason)는 체크리스트 완료 대신
--     «계약금 완» 을 요구한다. 인계는 여전히 직인을 요구한다.
--   · 비대면 단계에 absent(부재)를 추가한다 — 어느 단계에서 부재로 왔는지
--     consultation_states.absent_from_phase 에 남기고, 부재를 떠나면 비운다. 일정 불필요.
--   · 대면 단계에 deliberating(미팅 후 고민 중)을 추가한다. 일정 불필요.
--   · 151 check(체크리스트 확인) 쓰기는 퇴역한다 — 래퍼가 22023 으로 거부하고 mode 는 그대로 위임한다.
--
-- ★ 그대로 두는 것
--   · checklist 컬럼·과거 consultation_events·step/kind CHECK·blank/complete/missing 헬퍼·
--     consultation_default_phase — 과거 기록을 읽고 되돌릴 수 있게 남긴다.
--   · 151/152 읽기 함수의 시그니처. v2 읽기만 뒤에 열을 덧붙인다(DROP+CREATE).
--
-- ★ 권한 차이(의도된 변경): contract_fee_status 는 일반 보드 칸이라 셀 쓰기 권한이 있으면
--   누구나 바꿀 수 있다. RPC 로만 쓰던 체크리스트보다 보호가 약하다. 직인(owner/admin 승인)과
--   인계 게이트(잠금 안 재확인)가 여전히 최종 관문이다.
--
-- ★ 데이터 이월: 입금 확인(deposit_confirmed)이 된 상담행은 계약금 칸을 '계약금 완' 으로
--   옮긴다. 활성 발송 규칙이 이 값에 걸려 있으면 고객 발송이 생길 수 있어 먼저 멈춘다.

-- 1) 단계 CHECK — absent / deliberating 추가 + 부재 출발 단계.
alter table public.consultation_states drop constraint consultation_phase_valid;
alter table public.consultation_states add constraint consultation_phase_valid check
 (phase in ('information','scheduled','consulting','absent','on_hold','rejected','follow_up',
   'meeting_scheduled','meeting_done','cancelled','deliberating','contract'));
alter table public.consultation_states add column absent_from_phase text;
-- ★ phase 가 null(보관 행)이어도 출발 단계만 남는 일이 없게 coalesce 로 막는다.
alter table public.consultation_states add constraint consultation_absent_from_valid check
 (absent_from_phase is null or (coalesce(phase,'')='absent' and absent_from_phase in
   ('information','scheduled','consulting','on_hold','rejected','follow_up',
    'meeting_scheduled','meeting_done','cancelled','deliberating','contract')));

-- 2) 내부 헬퍼 — 보드 «계약금 완료여부» 칸 판정. public 실행을 주지 않는다.
create or replace function public.consultation_contract_fee_ready(p_org_id uuid, p_item_id uuid)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.item_values iv
     where iv.org_id = p_org_id and iv.item_id = p_item_id
       and iv.column_key = 'contract_fee_status'
       and iv.value_jsonb #>> '{}' = '계약금 완'
  );
$$;
revoke all on function public.consultation_contract_fee_ready(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.consultation_contract_missing(p_org_id uuid, p_item_id uuid)
returns text[]
language sql stable set search_path = '' as $$
  select case when public.consultation_contract_fee_ready(p_org_id, p_item_id)
    then '{}'::text[] else array['계약금 입금 확인']::text[] end;
$$;
revoke all on function public.consultation_contract_missing(uuid, uuid) from public, anon, authenticated, service_role;

-- 3) 151 check 퇴역 — 본체를 _151 로 보존하고 같은 시그니처 래퍼로 감싼다(151 이 069 에 한 방식).
alter function public.execute_consultation_transition(uuid, uuid, uuid, text, text, boolean, text, timestamptz, uuid, bigint)
  rename to execute_consultation_transition_151;
revoke all on function public.execute_consultation_transition_151(uuid, uuid, uuid, text, text, boolean, text, timestamptz, uuid, bigint)
  from public, anon, authenticated, service_role;

create or replace function public.execute_consultation_transition(
  p_org_id uuid,
  p_item_id uuid,
  p_request_id uuid,
  p_action text,
  p_step text default null,
  p_confirmed boolean default null,
  p_mode text default null,
  p_meeting_at timestamptz default null,
  p_assignee uuid default null,
  p_expected_version bigint default null
)
returns table(item_id uuid, deal_id uuid, company_id uuid, mode text, version bigint, replayed boolean)
language plpgsql security definer set search_path = '' as $$
begin
  -- ★ 4단계 체크리스트 쓰기는 끝났다. 과거 영수증 replay 도 새 쓰기로 보지 않고 거부한다.
  if p_action = 'check' then
    raise exception 'consultation checklist retired' using errcode = '22023';
  end if;
  return query select * from public.execute_consultation_transition_151(
    p_org_id, p_item_id, p_request_id, p_action, p_step, p_confirmed,
    p_mode, p_meeting_at, p_assignee, p_expected_version);
end;
$$;
revoke all on function public.execute_consultation_transition(uuid, uuid, uuid, text, text, boolean, text, timestamptz, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.execute_consultation_transition(uuid, uuid, uuid, text, text, boolean, text, timestamptz, uuid, bigint)
  to authenticated;

-- 4) 151 스냅샷 — 준비도의 체크리스트 부분만 계약금 판정으로 바꾼다(★ 표시).
create or replace function public.read_consultation_snapshot(
  p_org_id uuid,
  p_item_id uuid
)
returns table(
  item_id uuid, deal_id uuid, company_id uuid, board_source text,
  mode text, version bigint, meeting_at timestamptz, checklist jsonb,
  ready boolean, missing jsonb, seal_approved boolean, seal_detail text,
  deal_stage_kind text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_item public.items%rowtype;
  v_board_source text;
  v_deal public.deals%rowtype;
  v_stage_kind text;
  v_state public.consultation_states%rowtype;
  v_has_state boolean := false;
  v_checklist jsonb;
  v_version bigint := 0;
  v_mode text;
  v_meeting timestamptz := null;
  v_seal text;
  v_move text;
  v_seal_custom text;
  v_ready boolean := false;
  v_missing text[] := '{}';
  v_seal_ok boolean := false;
  v_seal_detail text := '';
  v_deal_seal text := '대기';
begin
  if v_actor is null then
    raise exception 'consultation authentication required' using errcode = '42501';
  end if;
  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';
  -- F4: 076:792 계약을 재사용한다. view_tabs 없이 단일 스냅샷을 읽지 못한다.
  if not found or not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  select i.* into v_item
    from public.items i
   where i.id = p_item_id and i.org_id = p_org_id and i.deleted_at is null;
  if not found then
    raise exception 'consultation item unavailable' using errcode = '22023';
  end if;
  -- F5: 076:812-814 공유 헬퍼를 재사용한다.
  if v_role in ('owner', 'admin') or v_scope = 'all' or v_item.assigned_to = v_actor then
    null;
  elsif (v_role = 'team_lead' or v_scope = 'department')
    and public.consultation_actor_sees_assignee(p_org_id, v_item.assigned_to) then
    null;
  else
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  select b.source into v_board_source
    from public.boards b where b.id = v_item.board_id and b.org_id = p_org_id;
  if v_item.deal_id is not null then
    select d.* into v_deal from public.deals d
     where d.id = v_item.deal_id and d.org_id = p_org_id;
    if found then
      select s.kind::text into v_stage_kind from public.stages s where s.id = v_deal.stage_id;
      v_seal_custom := coalesce(v_deal.custom ->> 'seal_approval', v_deal.custom ->> 'seal_status');
    end if;
  end if;
  select iv.value_jsonb #>> '{}' into v_seal from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'seal_status';
  select iv.value_jsonb #>> '{}' into v_move from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'work_move';

  if v_board_source = 'core.default-tab/new-lead' then
    return query select p_item_id, v_deal.id, v_deal.company_id, v_board_source,
      'new_lead'::text, 0::bigint, null::timestamptz, public.consultation_blank_checklist(),
      false, to_jsonb(array['상담 단계']::text[]), false,
      '신규리드는 리드컨택으로 먼저 옮겨 주세요.'::text, v_stage_kind;
    return;
  end if;

  select s.* into v_state from public.consultation_states s
   where s.org_id = p_org_id and s.item_id = p_item_id;
  if found then
    v_has_state := true;
    v_checklist := v_state.checklist;
    v_version := v_state.version;
    v_mode := v_state.mode;
    v_meeting := v_state.meeting_at;
  else
    v_checklist := public.consultation_blank_checklist();
    v_mode := 'remote';
  end if;

  if v_board_source is distinct from 'core.default-tab/contact' then
    return query select p_item_id, v_deal.id, v_deal.company_id, v_board_source,
      v_mode, v_version, v_meeting, v_checklist,
      false, to_jsonb(array['상담 단계']::text[]), false,
      '상담 보드의 건이 아닙니다.'::text, v_stage_kind;
    return;
  end if;

  -- P1-real: 실제 069 deal-branch 는 deals.custom 직인(정본)을 읽는다.
  -- 보드 거울(item_values)만 보고 ready 를 주장하면 정식 인계에서 직인대기로
  -- 막히는 false-ready 가 된다. 정본 미승인을 UI 에 그대로 보여준다.
  -- ★ 167: 4단계 체크리스트 대신 보드 «계약금 완료여부» = 계약금 완.
  v_missing := public.consultation_contract_missing(p_org_id, p_item_id);
  v_deal_seal := coalesce(v_deal.custom ->> 'seal_approval', v_deal.custom ->> 'seal_status', '대기');
  if coalesce(v_move, '') <> '업무관리 이동' then
    v_seal_ok := false;
    v_seal_detail := '업무관리 이동을 먼저 선택해 주세요.';
  elsif coalesce(v_seal, '대기') <> '완료' then
    v_seal_ok := false;
    v_seal_detail := '대표 직인 승인이 필요합니다. 현재 직인(보드) = ' || coalesce(v_seal, '대기');
  elsif v_deal_seal <> '완료' then
    v_seal_ok := false;
    v_seal_detail := '대표 직인 승인이 필요합니다(계약 기준). 현재 = ' || v_deal_seal;
  else
    v_seal_ok := true;
    v_seal_detail := '대표 직인 승인 완료';
  end if;
  v_ready := v_missing = '{}'::text[]
    and v_seal_ok
    and v_stage_kind = 'meeting';
  if v_stage_kind is distinct from 'meeting' then
    v_missing := v_missing || array['상담 단계'];
  end if;
  return query select p_item_id, v_deal.id, v_deal.company_id, v_board_source,
    v_mode, v_version, v_meeting, v_checklist,
    v_ready, to_jsonb(v_missing), v_seal_ok, v_seal_detail, v_stage_kind;
end;
$$;

revoke all on function public.read_consultation_snapshot(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.read_consultation_snapshot(uuid, uuid) to authenticated;

-- 5) 151 인계 차단 사유 — 체크리스트 대신 계약금(★). 직인·이동·단계 순서는 그대로.
create or replace function public.consultation_handoff_block_reason(
  p_org_id uuid,
  p_item_id uuid,
  p_deal_id uuid
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_state public.consultation_states%rowtype;
  v_missing text[];
  v_deal_seal text;
  v_board_seal text;
  v_move text;
  v_stage_kind text;
begin
  if v_actor is null then
    raise exception 'consultation authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.org_members m
    join public.orgs o on o.id = m.org_id
    where m.org_id = p_org_id and m.user_id = v_actor
      and m.status = 'active' and o.status = 'active'
  ) then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  select s.* into v_state from public.consultation_states s
   where s.org_id = p_org_id and s.item_id = p_item_id;
  if not found then
    return null;
  end if;
  if v_state.deal_id is distinct from p_deal_id then
    return '상담 기록과 계약이 일치하지 않습니다.';
  end if;
  if v_state.mode not in ('remote', 'inperson') then
    return '상담 단계';
  end if;
  -- ★ 167: 4단계 체크리스트 대신 보드 «계약금 완료여부» = 계약금 완.
  v_missing := public.consultation_contract_missing(p_org_id, p_item_id);
  if v_missing <> '{}'::text[] then
    return '인계 조건이 남았습니다: ' || array_to_string(v_missing, ' · ');
  end if;
  -- P1-real/edge: 호출자가 잡은 잠금(item->deal->state) 안에서 정식 게이트를 재확인한다.
  -- 실제 069 deal-branch 는 deals.custom 직인(정본)을 강제하고, 스냅샷 ready 는
  -- 보드 거울(item_values.seal_status)까지 요구한다. 여기서 둘 중 하나라도
  -- 미승인이면 먼저 막아야 ready=false 뒤 첫 변이 커밋이라는 어긋남이 없다.
  -- 직인을 끄거나 우회하지 않고, 미승인 사유를 실제 값과 함께 돌려준다.
  -- 순서는 스냅샷과 같다: 업무관리 이동 -> 보드 직인 -> 계약 정본 직인.
  select coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기'),
         s.kind::text
    into v_deal_seal, v_stage_kind
    from public.deals d
    left join public.stages s on s.id = d.stage_id
   where d.id = p_deal_id and d.org_id = p_org_id;
  select iv.value_jsonb #>> '{}' into v_move from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'work_move';
  select iv.value_jsonb #>> '{}' into v_board_seal from public.item_values iv
   where iv.item_id = p_item_id and iv.column_key = 'seal_status';
  if coalesce(v_move, '') <> '업무관리 이동' then
    return '업무관리 이동을 먼저 선택해 주세요.';
  end if;
  if coalesce(v_board_seal, '대기') <> '완료' then
    return '대표 직인 승인이 필요합니다. 현재 직인(보드) = ' || coalesce(v_board_seal, '대기');
  end if;
  if v_deal_seal <> '완료' then
    return '대표 직인 승인이 필요합니다(계약 기준). 현재 = ' || v_deal_seal;
  end if;
  if v_stage_kind is distinct from 'meeting' then
    return '상담 단계에서는 인계할 수 없습니다.';
  end if;
  return null;
end;
$$;
revoke all on function public.consultation_handoff_block_reason(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- 6) 152 보드 일괄 조회 — 같은 시그니처, 준비도·누락만 계약금 판정(★).
create or replace function public.read_consultation_board_view(
  p_org_id uuid,
  p_board_id uuid,
  p_item_ids uuid[] default null,
  p_limit integer default 200,
  p_offset integer default 0
)
returns table(
  item_id uuid, deal_id uuid, company_id uuid,
  mode text, version bigint, meeting_at timestamptz, checklist jsonb,
  ready boolean, missing jsonb, seal_approved boolean, seal_detail text,
  deal_stage_kind text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_board_source text;
  v_limit integer;
  v_offset integer;
begin
  if v_actor is null then
    raise exception 'consultation authentication required' using errcode = '42501';
  end if;
  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';
  -- F4: 076:792 계약을 재사용한다. view_tabs 없이 일괄 조회를 허용하지 않는다.
  if not found or not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'consultation permission denied' using errcode = '42501';
  end if;
  -- F7: 입력 검증. 범위 밖 입력은 거부하고 조용히 넓히지 않는다.
  if p_limit is null then v_limit := 200;
  elsif p_limit < 1 or p_limit > 500 then
    raise exception 'consultation board view limit out of range' using errcode = '22023';
  else v_limit := p_limit;
  end if;
  if p_offset is null then v_offset := 0;
  elsif p_offset < 0 then
    raise exception 'consultation board view offset out of range' using errcode = '22023';
  else v_offset := p_offset;
  end if;
  if p_item_ids is not null and array_length(p_item_ids, 1) is not null
     and array_length(p_item_ids, 1) > 500 then
    raise exception 'consultation board view item batch too large' using errcode = '22023';
  end if;
  select b.source into v_board_source
    from public.boards b where b.id = p_board_id and b.org_id = p_org_id;
  if not found then
    raise exception 'consultation board unavailable' using errcode = '22023';
  end if;
  if v_board_source is distinct from 'core.default-tab/contact' then
    return;
  end if;
  -- F5+F7: 076:812-814 가시성을 재사용하고 요청 ID 를 권한 안에서만 돌려준다.
  -- 권한 밖 ID 는 제외한다(fail-closed). 안정 정렬+명시 limit/offset 으로 PostgREST 암묵 절단을 막는다.
  return query
  with recursive actor_departments as (
    select dm.dept_id from public.department_members dm
     where dm.org_id = p_org_id and dm.user_id = v_actor and dm.is_primary
    union all
    select d.id from public.departments d join actor_departments parent on d.parent_id = parent.dept_id
     where d.org_id = p_org_id and d.archived_at is null
  ), scoped_users as (
    select distinct dm.user_id from public.department_members dm
     join actor_departments ad on ad.dept_id = dm.dept_id
    where dm.org_id = p_org_id
  )
  select
    i.id,
    d.id,
    d.company_id,
    coalesce(s.mode, 'remote'),
    coalesce(s.version, 0::bigint),
    s.meeting_at,
    coalesce(s.checklist, public.consultation_blank_checklist()),
    (
      -- ★ 167: 4단계 체크리스트 대신 보드 «계약금 완료여부» = 계약금 완.
      public.consultation_contract_fee_ready(i.org_id, i.id)
      and coalesce(mv.value_jsonb #>> '{}', '') = '업무관리 이동'
      and coalesce(sv.value_jsonb #>> '{}', '대기') = '완료'
      and coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기') = '완료'
      and st.kind::text = 'meeting'
    ),
    to_jsonb(
      public.consultation_contract_missing(i.org_id, i.id)
      || case when st.kind::text is distinct from 'meeting' then array['상담 단계']::text[] else '{}'::text[] end
    ),
    (
      coalesce(mv.value_jsonb #>> '{}', '') = '업무관리 이동'
      and coalesce(sv.value_jsonb #>> '{}', '대기') = '완료'
      and coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기') = '완료'
    ),
    case
      when coalesce(mv.value_jsonb #>> '{}', '') <> '업무관리 이동' then '업무관리 이동을 먼저 선택해 주세요.'
      when coalesce(sv.value_jsonb #>> '{}', '대기') <> '완료'
        then '대표 직인 승인이 필요합니다. 현재 직인(보드) = ' || coalesce(sv.value_jsonb #>> '{}', '대기')
      when coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기') <> '완료'
        then '대표 직인 승인이 필요합니다(계약 기준). 현재 = '
          || coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기')
      else '대표 직인 승인 완료'
    end,
    st.kind::text
  from public.items i
  left join public.consultation_states s
    on s.org_id = i.org_id and s.item_id = i.id
  left join public.deals d
    on d.org_id = i.org_id and d.id = i.deal_id
  left join public.stages st
    on st.id = d.stage_id
  left join public.item_values mv
    on mv.item_id = i.id and mv.column_key = 'work_move'
  left join public.item_values sv
    on sv.item_id = i.id and sv.column_key = 'seal_status'
  where i.org_id = p_org_id
    and i.board_id = p_board_id
    and i.deleted_at is null
    and (p_item_ids is null or i.id = any (p_item_ids))
    and (
      v_role in ('owner', 'admin') or v_scope = 'all'
      or i.assigned_to = v_actor
      or ((v_role = 'team_lead' or v_scope = 'department')
        and i.assigned_to in (select user_id from scoped_users))
    )
  order by i.id
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.read_consultation_board_view(uuid, uuid, uuid[], integer, integer) from public, anon, service_role;
grant execute on function public.read_consultation_board_view(uuid, uuid, uuid[], integer, integer) to authenticated;

-- 7) 161 인계 버튼 판정 — 체크리스트 대신 계약금(★).
create or replace function public.read_consultation_handoff_controls(p_org_id uuid,p_item_id uuid)
returns table(can_approve_seal boolean,seal_approved boolean,ready boolean,version bigint,missing jsonb)
language plpgsql security definer set search_path='' as $$
declare v_snap record; v_seal boolean; v_edit boolean; v_role text; v_scope text; v_handoff boolean;
begin
 -- Active tenant/member/view-tabs and current row scope precede every read.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 if not exists(select 1 from public.items i where i.org_id=p_org_id and i.id=p_item_id
    and i.deleted_at is null and i.archived_at is null) then
   raise exception 'consultation item unavailable' using errcode='22023'; end if;
 select m.role::text,m.scope::text into v_role,v_scope from public.org_members m
  where m.org_id=p_org_id and m.user_id=auth.uid() and m.status='active';
 v_edit:=public.effective_permission(p_org_id,'work.item_upsert');
 select coalesce(d.custom->>'seal_approval',d.custom->>'seal_status','대기')='완료'
   and exists(select 1 from public.item_values iv where iv.org_id=p_org_id and iv.item_id=p_item_id
     and iv.column_key='seal_status' and iv.value_jsonb='"완료"'::jsonb)
 into v_seal from public.deals d where d.org_id=p_org_id and d.id=v_snap.deal_id;
 -- Match BOTH actual write gates: 151 item assignee and 069 deal assignee.
 -- Department visibility allows reading/progress, never handoff of another owner.
 select coalesce(v_role in ('owner','admin') or v_scope='all'
   or (i.assigned_to=auth.uid() and d.assigned_to=auth.uid()),false)
 into v_handoff from public.items i join public.deals d on d.id=i.deal_id and d.org_id=i.org_id
 where i.org_id=p_org_id and i.id=p_item_id;
 return query select
   v_edit and v_role in ('owner','admin') and v_snap.board_source='core.default-tab/contact' and v_snap.deal_stage_kind='meeting',
   coalesce(v_seal,false),
   -- ★ 167: 체크리스트 대신 계약금 완.
   v_edit and coalesce(v_handoff,false) and coalesce(v_seal,false) and public.consultation_contract_fee_ready(p_org_id,p_item_id)
     and v_snap.board_source='core.default-tab/contact' and v_snap.deal_stage_kind='meeting',
   v_snap.version, v_snap.missing || case when not coalesce(v_handoff,false) then '["인계 담당자 권한"]'::jsonb else '[]'::jsonb end;
end $$;
revoke all on function public.read_consultation_handoff_controls(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_consultation_handoff_controls(uuid,uuid) to authenticated;

-- 8) 161 직인 승인·인계 — 두 동작 모두 계약금 완을 요구한다(★). 나머지는 그대로.
create or replace function public.execute_consultation_seal_handoff(
 p_org_id uuid,p_item_id uuid,p_request_id uuid,p_expected_version bigint,p_operation text,p_company_name text default null
) returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid:=auth.uid(); v_role text; v_scope text; v_item public.items%rowtype;
 v_deal public.deals%rowtype; v_state public.consultation_states%rowtype;
 v_prior public.consultation_requests%rowtype; v_snap record; v_out record;
 v_payload jsonb; v_version bigint; v_now timestamptz:=clock_timestamp(); v_before jsonb;
begin
 if v_actor is null then raise exception 'consultation authentication required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0
   or p_operation is null or p_operation not in ('seal_approval','handoff') then
   raise exception 'consultation input required' using errcode='22023'; end if;
 select m.role::text,m.scope::text into v_role,v_scope from public.org_members m join public.orgs o on o.id=m.org_id
  where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
 if not found or not public.effective_permission(p_org_id,'work.view_tabs')
   or not public.effective_permission(p_org_id,'work.item_upsert') then
   raise exception 'consultation permission denied' using errcode='42501'; end if;
 -- Reuse precisely the approver role set from request_deal_seal_approval (070).
 if p_operation='seal_approval' and v_role not in ('owner','admin') then
   raise exception 'seal approval permission denied' using errcode='42501'; end if;
 v_payload:=jsonb_build_object('itemId',p_item_id,'operation',p_operation,'expectedVersion',p_expected_version,'companyName',p_company_name);
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
 select i.* into v_item from public.items i where i.org_id=p_org_id and i.id=p_item_id
   and i.deleted_at is null and i.archived_at is null for update;
 if not found then raise exception 'consultation item unavailable' using errcode='22023'; end if;
 -- Checks current row scope before receipt access, including after a handoff.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 select d.* into v_deal from public.deals d where d.org_id=p_org_id and d.id=v_item.deal_id for update;
 if not found or not exists(select 1 from public.pipelines p join public.stages st on st.pipeline_id=p.id
   where p.id=v_deal.pipeline_id and p.org_id=p_org_id and st.id=v_deal.stage_id) then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 -- The real 151/069 write scope also applies to committed request replay.
 if p_operation='handoff' and not coalesce(v_role in ('owner','admin') or v_scope='all'
   or (v_item.assigned_to=v_actor and v_deal.assigned_to=v_actor),false) then
   raise exception 'consultation permission denied' using errcode='42501'; end if;
 select s.* into v_state from public.consultation_states s where s.org_id=p_org_id and s.item_id=p_item_id for update;
 if not found or v_state.deal_id is distinct from v_deal.id then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 select r.* into v_prior from public.consultation_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
 if found then
   if v_prior.actor_id is distinct from v_actor or v_prior.item_id is distinct from p_item_id
      or v_prior.deal_id is distinct from v_deal.id or v_prior.action is distinct from p_operation
      or v_prior.payload is distinct from v_payload then
     raise exception 'consultation idempotency key reuse' using errcode='22023'; end if;
   return query select p_item_id,v_deal.id,(v_prior.result->>'companyId')::uuid,
     v_prior.result->>'mode',(v_prior.result->>'version')::bigint,true;
   return;
 end if;
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 if v_snap.board_source is distinct from 'core.default-tab/contact' or v_snap.deal_stage_kind is distinct from 'meeting' then
   raise exception 'consultation stage unavailable' using errcode='22023'; end if;
 if v_state.version<>p_expected_version then raise exception 'consultation version conflict' using errcode='40001'; end if;
 -- ★ 167: 직인 승인·인계 모두 1단계(계약금 입금 확인)를 먼저 요구한다.
 if not public.consultation_contract_fee_ready(p_org_id,p_item_id) then
   raise exception 'consultation contract fee required' using errcode='22023'; end if;
 v_version:=v_state.version;
 if p_operation='seal_approval' then
   v_before:=jsonb_build_object('deal',coalesce(v_deal.custom->>'seal_approval',v_deal.custom->>'seal_status'),
     'board',(select iv.value_jsonb from public.item_values iv where iv.org_id=p_org_id and iv.item_id=p_item_id and iv.column_key='seal_status'));
   update public.deals set custom=coalesce(custom,'{}'::jsonb)||jsonb_build_object('seal_approval','완료'),updated_at=v_now
    where id=v_deal.id and org_id=p_org_id;
   insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'seal_status','"완료"')
    on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb;
   v_version:=v_version+1;
   update public.consultation_states cs set version=v_version,updated_at=v_now,updated_by=v_actor
    where cs.org_id=p_org_id and cs.item_id=p_item_id;
   insert into public.consultation_events(org_id,item_id,deal_id,step,kind,before,after,actor_id,at,request_id,details)
    values(p_org_id,p_item_id,v_deal.id,'seal','seal_approved',false,true,v_actor,v_now,p_request_id,
      jsonb_build_object('before',v_before,'after',jsonb_build_object('deal','완료','board','완료')));
 else
   -- The click records intent in the SAME transaction as the established
   -- 154 -> 151 -> 087 -> 069 -> 065 pipeline. Never manufacture either approval.
   if coalesce(v_deal.custom->>'seal_approval',v_deal.custom->>'seal_status','대기')<>'완료'
      or not exists(select 1 from public.item_values iv where iv.org_id=p_org_id and iv.item_id=p_item_id
       and iv.column_key='seal_status' and iv.value_jsonb='"완료"'::jsonb) then
     raise exception '대표 직인 승인이 필요합니다.' using errcode='22023'; end if;
   insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'work_move','"업무관리 이동"')
    on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb;
   select * into v_out from public.execute_contact_pipeline_transition(
     p_org_id,v_deal.id,p_item_id,p_request_id,'contact_to_work',v_deal.company_id,coalesce(nullif(trim(p_company_name),''),v_item.title));
   if v_out.status is distinct from 'committed' or v_out.deal_id is distinct from v_deal.id then
     raise exception '%',coalesce(v_out.reason,'상담 인계를 완료하지 못했습니다.') using errcode='22023'; end if;
   v_deal.company_id:=v_out.company_id;
 end if;
 insert into public.consultation_requests(org_id,request_id,item_id,deal_id,action,payload,result,actor_id)
  values(p_org_id,p_request_id,p_item_id,v_deal.id,p_operation,v_payload,
    jsonb_build_object('version',v_version,'mode',v_state.mode,'companyId',v_deal.company_id),v_actor);
 return query select p_item_id,v_deal.id,v_deal.company_id,v_state.mode,v_version,false;
end $$;
revoke all on function public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text) from public,anon,service_role;
grant execute on function public.execute_consultation_seal_handoff(uuid,uuid,uuid,bigint,text,text) to authenticated;

-- 9) 156 호환 트리거 — 부재를 떠나면 출발 단계를 비운다(★).
create or replace function public.consultation_phase_compat() returns trigger language plpgsql set search_path='' as $$
begin
 if new.phase is null then new.phase := public.consultation_default_phase(new.mode,new.meeting_at,new.checklist);
 elsif tg_op='UPDATE' then
   if new.mode is distinct from old.mode and new.phase is not distinct from old.phase then
     new.phase := public.consultation_default_phase(new.mode,new.meeting_at,new.checklist);
   elsif new.checklist is distinct from old.checklist
     and public.consultation_default_phase(new.mode,new.meeting_at,new.checklist)='contract' then
     new.phase := 'contract';
   end if;
 end if;
 -- ★ 167: 부재가 아니면 출발 단계를 남기지 않는다(151 mode 전환 등 모든 경로 공통).
 if new.phase is distinct from 'absent' then new.absent_from_phase := null; end if;
 return new;
end $$;
revoke all on function public.consultation_phase_compat() from public,anon,authenticated,service_role;

-- 10) 156 단계 저장 — absent/deliberating 허용 + 부재 출발 단계 기록(★). 같은 시그니처.
create or replace function public.execute_consultation_workflow(
 p_org_id uuid,p_item_id uuid,p_request_id uuid,p_expected_version bigint,
 p_mode text,p_phase text,p_meeting_at timestamptz default null,p_assignee uuid default null,p_cancel boolean default false
) returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid := auth.uid(); v_item public.items%rowtype; v_snap record;
 v_state public.consultation_states%rowtype; v_prior public.consultation_requests%rowtype;
 v_payload jsonb; v_before jsonb; v_after jsonb; v_result jsonb; v_phase text;
 v_meeting timestamptz; v_version bigint; v_now timestamptz := clock_timestamp(); v_from text;
begin
 if v_actor is null then raise exception 'consultation authentication required' using errcode='42501'; end if;
 if p_request_id is null or p_expected_version is null or p_expected_version<0
    or p_mode is null or p_mode not in ('remote','inperson') or p_phase is null or p_cancel is null then
   raise exception 'consultation input required' using errcode='22023'; end if;
 if not public.effective_permission(p_org_id,'work.item_upsert') then
   raise exception 'consultation permission denied' using errcode='42501'; end if;
 v_payload:=jsonb_build_object('itemId',p_item_id,'mode',p_mode,'phase',p_phase,'meetingAt',p_meeting_at,
   'assignee',p_assignee,'cancel',p_cancel,'expectedVersion',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
 select i.* into v_item from public.items i where i.org_id=p_org_id and i.id=p_item_id and i.deleted_at is null for update;
 if not found then raise exception 'consultation item unavailable' using errcode='22023'; end if;
 -- Reuse 151 exact active-org/member/view-tabs/current-row department authorization BEFORE replay.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 select r.* into v_prior from public.consultation_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
 if found then
   if v_prior.actor_id is distinct from v_actor or v_prior.item_id is distinct from p_item_id
     or v_prior.action <> 'workflow' or v_prior.payload is distinct from v_payload then
     raise exception 'consultation idempotency key reuse' using errcode='22023'; end if;
   return query select p_item_id,v_prior.deal_id,v_snap.company_id,
     (v_prior.result->>'mode'),(v_prior.result->>'version')::bigint,true;
   return;
 end if;
 if v_snap.board_source is distinct from 'core.default-tab/contact' or v_snap.deal_id is null then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 perform 1 from public.deals d where d.org_id=p_org_id and d.id=v_snap.deal_id for update;
 -- Re-read under the same canonical lock order as 151 and the handoff pipeline.
 select * into v_snap from public.read_consultation_snapshot(p_org_id,p_item_id);
 if v_snap.deal_stage_kind is distinct from 'meeting' then
   raise exception 'consultation stage unavailable' using errcode='22023'; end if;
 select s.* into v_state from public.consultation_states s where s.org_id=p_org_id and s.item_id=p_item_id for update;
 if found and v_state.deal_id is distinct from v_snap.deal_id then
   raise exception 'consultation canonical association required' using errcode='22023'; end if;
 if v_snap.version <> p_expected_version then raise exception 'consultation version conflict' using errcode='40001'; end if;
 -- ★ 167: 비대면 absent(부재), 대면 deliberating(미팅 후 고민 중). 둘 다 일정 불필요.
 if (p_mode='remote' and p_phase not in ('information','scheduled','consulting','absent','on_hold','rejected','follow_up','contract'))
    or (p_mode='inperson' and p_phase not in ('meeting_scheduled','meeting_done','cancelled','deliberating','contract')) then
   raise exception 'consultation phase unsupported' using errcode='22023'; end if;
 if p_cancel and (p_mode<>v_snap.mode or p_phase<>case when p_mode='remote' then 'on_hold' else 'cancelled' end) then
   raise exception 'consultation cancel phase unsupported' using errcode='22023'; end if;
 v_meeting:=case when p_cancel or p_phase='cancelled' then null else p_meeting_at end;
 if (p_phase in ('scheduled','follow_up','meeting_scheduled') or p_mode<>v_snap.mode) and v_meeting is null then
   raise exception 'consultation schedule meeting required' using errcode='22023'; end if;
 if v_meeting is not null then
   if p_assignee is distinct from v_item.assigned_to then
     raise exception 'consultation assignee change requires lineage' using errcode='22023'; end if;
   if p_assignee is null then raise exception 'consultation schedule assignee required' using errcode='22023'; end if;
   if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=p_assignee and m.status='active') then
     raise exception 'consultation assignee unavailable' using errcode='42501'; end if;
 end if;
 v_phase:=coalesce(v_state.phase,public.consultation_default_phase(v_snap.mode,v_snap.meeting_at,v_snap.checklist));
 -- ★ 167: 부재로 들어갈 때 출발 단계를 남긴다. 이미 부재면 처음 출발 단계를 유지하고, 떠나면 비운다.
 v_from:=case when p_phase<>'absent' then null
   when v_phase='absent' then v_state.absent_from_phase else v_phase end;
 v_before:=jsonb_build_object('mode',v_snap.mode,'phase',v_phase,'meetingAt',v_snap.meeting_at,'assigneeId',v_item.assigned_to)
   || case when v_phase='absent' and v_state.absent_from_phase is not null
     then jsonb_build_object('absentFromPhase',v_state.absent_from_phase) else '{}'::jsonb end;
 v_after:=jsonb_build_object('mode',p_mode,'phase',p_phase,'meetingAt',v_meeting,'assigneeId',v_item.assigned_to)
   || case when v_from is not null then jsonb_build_object('absentFromPhase',v_from) else '{}'::jsonb end;
 v_version:=v_snap.version;
 if v_before is distinct from v_after then
   v_version:=v_version+1;
   insert into public.consultation_states(org_id,item_id,deal_id,mode,version,meeting_at,checklist,updated_at,updated_by,phase,absent_from_phase)
   values(p_org_id,p_item_id,v_snap.deal_id,p_mode,v_version,v_meeting,v_snap.checklist,v_now,v_actor,p_phase,v_from)
   on conflict on constraint consultation_states_pkey do update set mode=excluded.mode,version=excluded.version,
     meeting_at=excluded.meeting_at,phase=excluded.phase,absent_from_phase=excluded.absent_from_phase,
     updated_at=excluded.updated_at,updated_by=excluded.updated_by;
   insert into public.consultation_events(org_id,item_id,deal_id,step,kind,actor_id,at,request_id,details)
   values(p_org_id,p_item_id,v_snap.deal_id,'phase',
     case when p_cancel or p_phase='cancelled' then 'appointment_cancelled'
       when v_snap.meeting_at is distinct from v_meeting and v_phase=p_phase and v_snap.mode=p_mode then 'rescheduled'
       else 'phase_changed' end,v_actor,v_now,p_request_id,jsonb_build_object('before',v_before,'after',v_after));
 end if;
 v_result:=jsonb_build_object('version',v_version,'mode',p_mode);
 insert into public.consultation_requests(org_id,request_id,item_id,deal_id,action,payload,result,actor_id)
 values(p_org_id,p_request_id,p_item_id,v_snap.deal_id,'workflow',v_payload,v_result,v_actor);
 return query select p_item_id,v_snap.deal_id,v_snap.company_id,p_mode,v_version,false;
end $$;
revoke all on function public.execute_consultation_workflow(uuid,uuid,uuid,bigint,text,text,timestamptz,uuid,boolean) from public,anon,service_role;
grant execute on function public.execute_consultation_workflow(uuid,uuid,uuid,bigint,text,text,timestamptz,uuid,boolean) to authenticated;

-- 11) v2 읽기 — 뒤에 열을 덧붙인다(DROP+CREATE, 권한 재발급).
drop function public.read_consultation_snapshot_v2(uuid,uuid);
create function public.read_consultation_snapshot_v2(p_org_id uuid,p_item_id uuid)
returns table(item_id uuid,deal_id uuid,company_id uuid,board_source text,mode text,version bigint,meeting_at timestamptz,
 checklist jsonb,ready boolean,missing jsonb,seal_approved boolean,seal_detail text,deal_stage_kind text,
 phase text,assignee_id uuid,history jsonb,absent_from_phase text,contract_fee_status text,contract_fee_ready boolean)
language sql security definer set search_path='' as $$
 select b.*,coalesce(s.phase,public.consultation_default_phase(b.mode,b.meeting_at,b.checklist)),i.assigned_to,
   coalesce((select jsonb_agg(e.entry order by e.at desc,e.id desc) from
     (select ev.id,ev.at,jsonb_build_object('id',ev.id,'at',ev.at,'actorId',ev.actor_id,'kind',ev.kind,'details',ev.details) entry
      from public.consultation_events ev where ev.org_id=p_org_id and ev.item_id=b.item_id and ev.details is not null
      order by ev.at desc,ev.id desc limit 20) e),'[]'::jsonb),
   -- ★ 167: 부재 출발 단계 + 1단계(계약금) 원값·판정. 권한은 위 151 스냅샷이 이미 확인했다.
   s.absent_from_phase,
   (select fv.value_jsonb #>> '{}' from public.item_values fv
     where fv.org_id=p_org_id and fv.item_id=b.item_id and fv.column_key='contract_fee_status'),
   public.consultation_contract_fee_ready(p_org_id,b.item_id)
 from public.read_consultation_snapshot(p_org_id,p_item_id) b
 join public.items i on i.id=b.item_id and i.org_id=p_org_id
 left join public.consultation_states s on s.item_id=b.item_id and s.org_id=p_org_id
$$;
revoke all on function public.read_consultation_snapshot_v2(uuid,uuid) from public,anon,service_role;
grant execute on function public.read_consultation_snapshot_v2(uuid,uuid) to authenticated;

drop function public.read_consultation_board_view_v2(uuid,uuid,uuid[],integer,integer);
create function public.read_consultation_board_view_v2(p_org_id uuid,p_board_id uuid,p_item_ids uuid[] default null,p_limit integer default 200,p_offset integer default 0)
returns table(item_id uuid,deal_id uuid,company_id uuid,mode text,version bigint,meeting_at timestamptz,checklist jsonb,
 ready boolean,missing jsonb,seal_approved boolean,seal_detail text,deal_stage_kind text,phase text,
 absent_from_phase text,contract_fee_ready boolean,seal_done boolean)
language sql security definer set search_path='' as $$
 select b.*,coalesce(s.phase,public.consultation_default_phase(b.mode,b.meeting_at,b.checklist)),
   s.absent_from_phase,
   public.consultation_contract_fee_ready(p_org_id,b.item_id),
   -- ★ 2단계 직인 = 161 과 같은 눈(계약 정본 AND 보드 거울). 152 seal_approved 는 이동 선택까지 묶어 쓰지 않는다.
   coalesce((select coalesce(d.custom->>'seal_approval',d.custom->>'seal_status','대기')='완료'
     from public.deals d where d.org_id=p_org_id and d.id=b.deal_id),false)
   and exists(select 1 from public.item_values iv where iv.org_id=p_org_id and iv.item_id=b.item_id
     and iv.column_key='seal_status' and iv.value_jsonb='"완료"'::jsonb)
 from public.read_consultation_board_view(p_org_id,p_board_id,p_item_ids,p_limit,p_offset) b
 left join public.consultation_states s on s.item_id=b.item_id and s.org_id=p_org_id
$$;
revoke all on function public.read_consultation_board_view_v2(uuid,uuid,uuid[],integer,integer) from public,anon,service_role;
grant execute on function public.read_consultation_board_view_v2(uuid,uuid,uuid[],integer,integer) to authenticated;

-- 12) 데이터 이월 — 입금 확인된 상담행의 계약금 칸을 '계약금 완' 으로.
-- ★ 041 발송 트리거가 이 값에 활성 규칙을 갖고 있으면 고객에게 발송이 생길 수 있다. 먼저 멈춘다.
-- 041 이 없는 환경도 있으니 표 존재를 먼저 보고 동적 조회한다(정적 참조는 계획 단계에서 실패).
do $$
declare v_blocked boolean := false;
begin
  if to_regclass('public.messaging_trigger_rules') is not null then
    execute $q$select exists (select 1 from public.messaging_trigger_rules r
      where r.enabled and r.column_key = 'contract_fee_status' and r.trigger_value = '계약금 완')$q$
      into v_blocked;
  end if;
  if v_blocked then
    raise exception '167 carry-over blocked: enabled messaging rule on contract_fee_status' using errcode = '55000';
  end if;
end $$;

-- 보관·삭제 행과 리드컨택 밖 보드는 건드리지 않는다. version·checklist·events 는 그대로 둔다.
insert into public.item_values(org_id, item_id, column_key, value_jsonb)
select s.org_id, s.item_id, 'contract_fee_status', '"계약금 완"'::jsonb
  from public.consultation_states s
  join public.items i on i.org_id = s.org_id and i.id = s.item_id
   and i.deleted_at is null and i.archived_at is null
  join public.boards b on b.org_id = i.org_id and b.id = i.board_id
   and b.source = 'core.default-tab/contact'
 where coalesce((s.checklist -> 'deposit_confirmed' ->> 'confirmed')::boolean, false)
on conflict on constraint item_values_pkey do update set value_jsonb = excluded.value_jsonb
 where public.item_values.value_jsonb is distinct from excluded.value_jsonb;

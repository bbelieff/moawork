-- moa-migration-guard: logical_key=100_bbe235_work_board_projection predecessor=099_bbe215_today_kpi_definitions digest=bc26990446e84c642cbe3c1c39a79a393eeedf115090bb23836df586e36b5aac foundation=false

select public.begin_guarded_migration(
  p_logical_key => '100_bbe235_work_board_projection',
  p_file_name => '100_bbe235_work_board_projection.sql',
  p_file_digest => 'bc26990446e84c642cbe3c1c39a79a393eeedf115090bb23836df586e36b5aac',
  p_expected_predecessor => '099_bbe215_today_kpi_definitions',
  p_executor => 'DC-00',
  p_thread_id => '019fe9c2-5d3b-7e42-a071-3b8d62e5f9d2',
  p_foundation => false
);

-- 099 · BBE-235 · 「업무관리 이동」이 계약업체 실무 보드에 «행» 을 만든다 (WO-5)
--
-- 무엇이 없었나
--   execute_contact_pipeline_transition(069) 은 deals.stage_id 만 바꾸고
--   계약업체 실무 보드에 items 를 넣지 않았다. 그래서 수금 컬럼
--   (fee_percent·fee_amount·fee_paid_on·contract_deposit·contract_deposit_paid_on)이
--   있는 보드가 영원히 비었다. 098 의 실현액 집계는 그 보드의 item_values 를 읽으므로
--   «부품은 다 있는데 값이 들어올 자리가 없는» 상태였다.
--   policyfund-contact.ts:109 이 「구조만 심는다(WO-5)」라고 스스로 적어 뒀다.
--
-- ★ 왜 069 의 함수 본문을 고치지 않고 «트리거» 인가
--   069 의 contact_to_work 는 커밋 경로가 «둘» 이다.
--     ① p_deal_id is null + p_source_item_id 있음 (컨택 보드 항목에서 바로)
--     ② 기존 deal 을 가진 경로
--   함수 본문을 복제해 두 곳을 고치면 «한쪽만 고쳐지는» 형태가 된다 — 이 저장소가
--   반복해서 밟은 자리다(BBE-212 의 뷰 분기, BBE-216 의 형제 라우트).
--   두 경로 모두 마지막에 contact_pipeline_transitions 에 status='committed' 를 쓰므로
--   그 «한 자리» 에 트리거를 걸면 두 경로가 자동으로 덮인다.
--   새 커밋 경로가 생겨도 같은 테이블에 쓰는 한 자동으로 덮인다.
--
-- 되돌리기
--   drop trigger if exists bbe235_project_work_board_tg on public.contact_pipeline_transitions;
--   drop function if exists public.bbe235_project_work_board();
--   (이미 만들어진 items 행은 지우지 않는다 — 사용자 데이터다)

create or replace function public.bbe235_project_work_board()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board uuid;
  v_group uuid;
  v_title text;
  v_assigned uuid;
begin
  -- 커밋된 «업무관리 이동» 만 투영한다. blocked 는 아무것도 만들지 않는다.
  if new.status is distinct from 'committed'
     or new.kind is distinct from 'contact_to_work'
     or new.deal_id is null then
    return new;
  end if;

  -- 이미 살아 있는 투영이 있으면 두 번 만들지 않는다.
  -- 조건을 items_active_deal_projection_uq(087:32-35) 와 «글자 그대로» 맞춘다 —
  -- 다르면 인덱스가 막는 것과 여기가 막는 것이 갈린다.
  if exists (
    select 1 from public.items i
     where i.org_id = new.org_id
       and i.deal_id = new.deal_id
       and i.deleted_at is null
  ) then
    return new;
  end if;

  select b.id into v_board
    from public.boards b
   where b.org_id = new.org_id
     and b.source = 'core.default-tab/contract-work'
   order by b.id
   limit 1;

  -- ★ 보드가 없으면 «건너뛴다». 전이 자체를 실패시키지 않는다.
  --   전이는 사용자가 요청한 주된 동작이고, 투영은 그 부수 효과다.
  --   여기서 예외를 던지면 계약업체 실무 탭이 없는 조직은 업무관리 이동 자체를 못 하게 된다.
  if v_board is null then
    return new;
  end if;

  select d.title, d.assigned_to
    into v_title, v_assigned
    from public.deals d
   where d.id = new.deal_id and d.org_id = new.org_id;

  select g.id into v_group
    from public.board_groups g
   where g.org_id = new.org_id and g.board_id = v_board
   order by g.sort_order, g.id
   limit 1;

  insert into public.items(org_id, board_id, group_id, title, assigned_to, deal_id)
  values (
    new.org_id,
    v_board,
    v_group,
    coalesce(nullif(btrim(coalesce(v_title, '')), ''), '(제목 없음)'),
    v_assigned,
    new.deal_id
  )
  on conflict do nothing;

  return new;
end $$;

comment on function public.bbe235_project_work_board() is
  'BBE-235 · 업무관리 이동이 커밋되면 계약업체 실무 보드에 딜의 행을 만든다. 보드가 없으면 건너뛴다(전이를 실패시키지 않는다).';

drop trigger if exists bbe235_project_work_board_tg on public.contact_pipeline_transitions;
create trigger bbe235_project_work_board_tg
  after insert or update on public.contact_pipeline_transitions
  for each row execute function public.bbe235_project_work_board();

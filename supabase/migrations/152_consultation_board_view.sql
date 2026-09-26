-- moa-migration-guard: logical_key=152_consultation_board_view predecessor=151_consultation_protected_state digest=b5741a59d84427253c8002a65d790af606960a0e8547028aefe3592aeb6808b2 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '152_consultation_board_view',
  p_file_name => '152_consultation_board_view.sql',
  p_file_digest => 'b5741a59d84427253c8002a65d790af606960a0e8547028aefe3592aeb6808b2',
  p_expected_predecessor => '151_consultation_protected_state',
  p_executor => 'DG-03',
  p_thread_id => '02b13157-67b8-87d4-9c2c-19b82b8f668b',
  p_foundation => false
);

-- 152_consultation_board_view — 상담 단계 보기용 일괄 조회 RPC.
--
-- 왜: STEP2(비대면)·STEP3(대면) 탭은 같은 리드컨택 정본 보드의 단계 보기다.
--   행을 복제하지 않고 consultation_states.mode 로 걸러 보여준다. 행마다
--   read_consultation_snapshot 을 부르면 N+1 이 되므로, 보드 한 번 조회로
--   끝내는 읽기 전용 RPC 하나를 둔다. 쓰기는 없다 — 쓰기는 151 RPC뿐이다.
--
-- 무엇:
--   · read_consultation_board_view(p_org_id, p_board_id) — contact 보드 행을
--     한 번에 읽는다. 권한은 151 단일 스냅샷과 같은 눈이다
--     (owner/admin/all-scope 또는 assigned_to = actor). 권한 밖 행은
--     결과에 포함하지 않는다.
--   · 상담 기록이 없는 행(레거시)은 mode=remote, version=0, 빈 체크리스트로
--     읽힌다(읽기만 — backfill 쓰기 없음). new-lead 보드 등 contact 가 아닌
--     보드는 빈 집합을 돌려준다.
--   · 준비도·직인 판정은 read_consultation_snapshot 과 같은 식이다. EAV 거울을
--     손으로 채워도 보호 상태가 바뀌지 않으므로 위조된 확인이 섞이지 않는다.

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
      public.consultation_missing_labels(coalesce(s.checklist, public.consultation_blank_checklist())) = '{}'::text[]
      and public.consultation_checklist_complete(coalesce(s.checklist, public.consultation_blank_checklist()))
      and coalesce(mv.value_jsonb #>> '{}', '') = '업무관리 이동'
      and coalesce(sv.value_jsonb #>> '{}', '대기') = '완료'
      and coalesce(d.custom ->> 'seal_approval', d.custom ->> 'seal_status', '대기') = '완료'
      and st.kind::text = 'meeting'
    ),
    to_jsonb(
      public.consultation_missing_labels(coalesce(s.checklist, public.consultation_blank_checklist()))
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

-- moa-migration-guard: logical_key=140_issue588_company_work_group predecessor=139_issue602_atomic_board_row_move digest=5d763ef48a61a1eff5406d308fc81179c879f1908d2f98845b2b694845a188d3 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '140_issue588_company_work_group',
  p_file_name => '140_issue588_company_work_group.sql',
  p_file_digest => '5d763ef48a61a1eff5406d308fc81179c879f1908d2f98845b2b694845a188d3',
  p_expected_predecessor => '139_issue602_atomic_board_row_move',
  p_executor => 'DC',
  p_thread_id => '01a02046-56a7-76c3-8b1f-08a71a7e557b',
  p_foundation => false
);

-- 「＋ 업체 추가」를 «누른 그룹» 에 넣는다 (#588).
--
-- 지금까지는 어느 그룹에서 눌러도 «맨 위» 그룹에 행이 생겼다. RPC 가 그룹을 못박아 골랐다.
-- 사용자는 「2026 2분기」에서 눌렀는데 행이 「준비단계」에 나타난다 — 누른 자리와 생기는
-- 자리가 다르다. 이 자리를 대체하기 전의 이름 입력칸(AddItemForm)은 groupId 를 지켰으므로
-- 기능이 뒤로 간 것이다.
--
-- ★ 이 파일은 117 의 함수 본문을 «그대로» 두고 그룹 선택 한 곳만 바꿨다.
--   권한 검사·멱등·파이프라인 조회·감사 로그는 한 글자도 다르지 않다.
--   손으로 옮겨 적으면 권한 판정이 조금씩 달라지고, 그건 권한 하향이 될 수 있다.
--
-- ★ 4번째 인자는 «선택» 이다. 안 넘기면 종전과 똑같이 첫 그룹이다.
--   회사 상세의 「업무 시작」은 그룹을 모르는 자리라 계속 안 넘긴다.

create or replace function public.start_company_work(
  p_org_id uuid,
  p_company_id uuid,
  p_request_id uuid,
  p_group_id uuid default null
) returns table(deal_id uuid, item_id uuid, replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_company public.companies%rowtype;
  v_pipeline uuid;
  v_stage uuid;
  v_board uuid;
  v_group uuid;
  v_deal uuid;
  v_item uuid;
  v_payload jsonb;
  v_prior public.company_work_start_requests%rowtype;
begin
  if v_actor is null or p_request_id is null or p_company_id is null then
    raise exception 'company work start input required' using errcode = '22023';
  end if;

  select m.role::text, m.scope::text
    into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id
     and m.user_id = v_actor
     and m.status = 'active'
     and o.status = 'active';
  if not found or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'company work start permission denied' using errcode = '42501';
  end if;

  select c.* into v_company
    from public.companies c
   where c.id = p_company_id
     and c.org_id = p_org_id
     and c.merged_into is null
     and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor);
  if not found then
    raise exception 'company unavailable' using errcode = '42501';
  end if;

  v_payload := jsonb_build_object('company_id', p_company_id);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select r.* into v_prior
    from public.company_work_start_requests r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.company_id <> p_company_id or v_prior.payload <> v_payload then
      raise exception 'company work start idempotency key reuse' using errcode = '22023';
    end if;
    return query select v_prior.deal_id, v_prior.item_id, true;
    return;
  end if;

  select s.pipeline_id, s.id into v_pipeline, v_stage
    from public.stages s
    join public.pipelines p on p.id = s.pipeline_id
   where p.org_id = p_org_id
   order by p.id, s.sort_order, s.id
   limit 1;
  if v_stage is null then
    raise exception 'deal pipeline unavailable' using errcode = '22023';
  end if;

  select b.id into v_board
    from public.boards b
   where b.org_id = p_org_id and b.source = 'core.default-tab/contract-work'
   order by b.id limit 1;
  if v_board is null then
    raise exception 'contract work board unavailable' using errcode = '22023';
  end if;
  if p_group_id is null then
    -- 그룹을 안 넘긴 호출부(회사 상세의 「업무 시작」)는 종전과 같이 첫 그룹이다.
    select g.id into v_group
      from public.board_groups g
     where g.org_id = p_org_id and g.board_id = v_board
     order by g.sort_order, g.id limit 1;
  else
    -- 넘겼으면 «이 조직 · 이 보드» 의 그룹인지 확인한다. 화면 값을 믿지 않는다.
    select g.id into v_group
      from public.board_groups g
     where g.id = p_group_id and g.org_id = p_org_id and g.board_id = v_board;
    if v_group is null then
      -- 조용히 첫 그룹으로 «떨어지지» 않는다. 그게 이 카드가 고치는 증상이다.
      raise exception 'company work start group unavailable' using errcode = '22023';
    end if;
  end if;

  insert into public.deals(org_id, company_id, pipeline_id, stage_id, assigned_to, title)
  values (p_org_id, p_company_id, v_pipeline, v_stage, coalesce(v_company.assigned_to, v_actor), v_company.name)
  returning id into v_deal;

  insert into public.items(org_id, board_id, group_id, title, assigned_to, deal_id)
  values (p_org_id, v_board, v_group, v_company.name, coalesce(v_company.assigned_to, v_actor), v_deal)
  returning id into v_item;

  insert into public.company_work_start_requests(org_id, request_id, company_id, actor_id, deal_id, item_id, payload)
  values (p_org_id, p_request_id, p_company_id, v_actor, v_deal, v_item, v_payload);
  insert into public.audit_logs(org_id, actor, action, target_type, target_id, meta)
  values (p_org_id, v_actor, 'company.work_started', 'deal', v_deal,
    jsonb_build_object('request_id', p_request_id, 'company_id', p_company_id, 'item_id', v_item));

  return query select v_deal, v_item, false;
end;
$$;

revoke all on function public.start_company_work(uuid, uuid, uuid, uuid) from public, anon, service_role;
grant execute on function public.start_company_work(uuid, uuid, uuid, uuid) to authenticated;

comment on function public.start_company_work(uuid, uuid, uuid, uuid) is
  'BBE-237 + #588. Atomically creates one deal and one contract-work item in the chosen group; request replay returns the same result.';

-- 옛 3인자 서명을 남겨 두면 «어느 쪽이 불릴지» 가 호출부마다 달라진다.
-- 새 함수의 4번째 인자가 선택이라 그 자리를 그대로 대신한다.
drop function if exists public.start_company_work(uuid, uuid, uuid);

do $$
begin
  if to_regprocedure('public.start_company_work(uuid, uuid, uuid, uuid)') is null then
    raise exception '140: start_company_work 4-arg 서명이 없습니다';
  end if;
  if to_regprocedure('public.start_company_work(uuid, uuid, uuid)') is not null then
    raise exception '140: 옛 3-arg 서명이 남아 있습니다';
  end if;
end
$$;

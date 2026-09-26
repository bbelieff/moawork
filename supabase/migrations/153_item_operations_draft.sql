-- moa-migration-guard: logical_key=153_item_operations_draft predecessor=152_consultation_board_view digest=4917978dd6f366f47c54605ceb10b108b31c5048c842affbd924f909e6b51487 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '153_item_operations_draft',
  p_file_name => '153_item_operations_draft.sql',
  p_file_digest => '4917978dd6f366f47c54605ceb10b108b31c5048c842affbd924f909e6b51487',
  p_expected_predecessor => '152_consultation_board_view',
  p_executor => 'DG',
  p_thread_id => 'moawork-v17-item-operations-repair-20260926',
  p_foundation => false
);

-- DRAFT — 실제 마이그레이션 번호/guard predecessor/digest는 통합 시 총괄이 최종 확정한다.
-- 151(상담)·152(OCR) 예약과 충돌하지 않기 위해 새 미적용 153 초안으로만 작성한다. 기존 적용 150 이하는 수정하지 않는다.
-- hosted DB 직접 적용·실데이터 변경 금지. 이 파일은 원자성·권한·UI 검증용 초안이다.
--
-- v17 아이템 연산 (별도 보관/복구, 안전한 복제, 상하위 연결/해제, 정본 딜 복제).
-- 계약 (root review 반영):
--  ① 모든 진입 RPC는 DB 경계에서 직접 인증·인가한다 (auth/active org/work.view_tabs +
--     연산별 work.item_upsert|work.item_delete + danger.bulk_edit_delete + 행 가시성).
--     내부 헬퍼는 grant가 없고, 진입점에만 최소 authenticated grant를 준다.
--  ② 인증·인가가 receipt replay보다 먼저다. receipt는 actor/operation/board/payload를
--     함께 묶고, requestId 충돌은 advisory lock으로 직렬화한다.
--     payload·actor가 다르면 22023으로 거부한다 (ON CONFLICT DO NOTHING 은폐 금지).
--     정상 재시도(lost response)는 CAS보다 먼저 replay된다.
--  ③ 상하위 변경은 보드 그래프 advisory lock으로 직렬화한 뒤 자식·부모를 id 순서로
--     잠그고, 부모·자식 모두 가시성을 검사하며, 조상 체인을 끝까지(최대 200단계,
--     초과는 fail-closed) 따라 순환을 검출한다.
--  ④ 정본 딜 복제는 단일 트랜잭션 원자 복제다: 회사 식별자를 새로 만들거나
--     옮기지 않고 원본 deal의 company_id를 그대로 새 deal에 물린다.
--     허용 입력만 복사하고, 독립 link 기록 호출은 두지 않는다.
--  ⑤ 보관해도 회사 원본·딜·원장 행을 삭제하지 않는다. 영구삭제 없음.

alter table public.items
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid;

create index if not exists idx_items_archived_board_order
  on public.items(org_id, board_id, archived_at desc)
  where archived_at is not null and deleted_at is null;

create index if not exists idx_items_active_visible_order
  on public.items(org_id, board_id, sort_order)
  where archived_at is null and deleted_at is null;

-- 요청 원장: (org, request) 하나로 actor/operation/board/payload와 결과를 묶는다.
-- 재시도는 actor·board·operation·payload 일치 시 저장 결과 replay, 불일치 시 22023.
create table if not exists public.item_operation_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id) on delete restrict,
  board_id uuid not null references public.boards(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  operation text not null check (operation in ('archive', 'restore_archived', 'duplicate', 'duplicate_canonical', 'set_parent', 'clear_parent')),
  payload jsonb not null,
  result_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id)
);
create index if not exists item_operation_receipts_item_idx
  on public.item_operation_receipts(org_id, item_id);

alter table public.item_operation_receipts enable row level security;
alter table public.item_operation_receipts force row level security;
revoke all on public.item_operation_receipts from public, anon, authenticated, service_role;

-- 복제 출처 기록: 새 item이 어느 source에서 왔는지 남긴다 (감사·역추적용, 삭제 cadenas 없음).
create table if not exists public.item_duplicate_links (
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_item_id uuid not null references public.items(id) on delete cascade,
  new_item_id uuid not null references public.items(id) on delete cascade,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (org_id, new_item_id)
);
create index if not exists item_duplicate_links_source_idx
  on public.item_duplicate_links(org_id, source_item_id);

alter table public.item_duplicate_links enable row level security;
alter table public.item_duplicate_links force row level security;
revoke all on public.item_duplicate_links from public, anon, authenticated, service_role;

-- ── 내부 헬퍼 (grant 없음: 진입 RPC만 호출한다) ──

-- 인증·인가 일괄 판정. 활성 멤버 + 활성 조직 + work.view_tabs + 연산 스코프 +
-- danger.bulk_edit_delete 를 모두 요구한다. 실패는 42501.
create or replace function public.item_operations_require_actor(
  p_org_id uuid,
  p_scope_key text
)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'item operation requires authentication' using errcode = '42501';
  end if;
  if not exists(
    select 1 from public.org_members m
    join public.orgs o on o.id = m.org_id
    where m.org_id = p_org_id and m.user_id = v_actor
      and m.status = 'active' and o.status = 'active'
  ) then
    raise exception 'item operation not allowed for this workspace' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'item operation tab view denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, p_scope_key) then
    raise exception 'item operation permission denied' using errcode = '42501';
  end if;
  if not public.effective_permission(p_org_id, 'danger.bulk_edit_delete') then
    raise exception 'item operation bulk permission denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

revoke all on function public.item_operations_require_actor(uuid, text) from public, anon, authenticated, service_role;

-- 행 가시성: owner/admin/전체범위는 전부, team_lead·부서범위는 부서 하위집합,
-- 그 밖은 본인 담당만. 부서 테이블이 없는 스키마에서는 담당자 비교로 닫힌다.
create or replace function public.item_operations_visible(
  p_org_id uuid,
  p_item_assigned_to uuid
)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_role text;
  v_scope text;
  v_has_dept boolean;
begin
  v_actor := auth.uid();
  if v_actor is null then
    return false;
  end if;
  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    where m.org_id = p_org_id and m.user_id = v_actor and m.status = 'active';
  if v_role is null then
    return false;
  end if;
  if v_role in ('owner', 'admin') or v_scope = 'all' then
    return true;
  end if;
  v_has_dept := to_regclass('public.department_members') is not null
    and to_regclass('public.departments') is not null;
  if v_has_dept and (v_role = 'team_lead' or v_scope = 'department') then
    return exists(
      with recursive actor_departments as (
        select dm.dept_id from public.department_members dm
        where dm.org_id = p_org_id and dm.user_id = v_actor and dm.is_primary
        union all
        select d.id from public.departments d
        join actor_departments parent on d.parent_id = parent.dept_id
        where d.org_id = p_org_id and d.archived_at is null
      )
      select 1 from public.department_members dm
      join actor_departments ad on ad.dept_id = dm.dept_id
      where dm.org_id = p_org_id and dm.user_id = p_item_assigned_to
    );
  end if;
  return coalesce(p_item_assigned_to = v_actor, false);
end;
$$;

revoke all on function public.item_operations_visible(uuid, uuid) from public, anon, authenticated, service_role;

-- 복제 금지 키 (정규식만이 아니라 명시 목록 + 컬럼 검증과 함께 쓴다).
-- 승인·직인·전자서명·계약확인·입금/원장·히스토리·파일접근권한·assignment receipt는 복사하지 않는다.
create or replace function public.item_duplicate_key_blocked(p_key text)
returns boolean
language plpgsql immutable security definer
set search_path = ''
as $$
declare
  v_key text := lower(coalesce(p_key, ''));
  v_exact constant text[] := array[
    'owner', 'collaborators', 'assignee',
    'approval', 'approvals', 'approval_status',
    'seal', 'seal_image',
    'sign', 'signature', 'signatures', 'sign_status',
    'contract', 'contract_confirm', 'contract_file',
    'deposit', 'ledger',
    'history', 'histories',
    'file', 'files', 'file_path',
    'assignment', 'assignments',
    'receipt', 'receipts',
    'audit', 'payment', 'payments',
    'stamp', 'stamps',
    'confirm', 'confirmation'
  ];
begin
  if v_key = any(v_exact) then
    return true;
  end if;
  return v_key similar to
    '%(approv|seal|sign|contract|deposit|ledger|history|histor|file|assign|receipt|audit|payment|stamp|confirm)%';
end;
$$;

revoke all on function public.item_duplicate_key_blocked(text) from public, anon, authenticated, service_role;

-- 정본 딜 계열 보드 출처 (앱의 requiresCanonicalDuplicate 와 같은 집합).
create or replace function public.item_operations_canonical_source(p_source text)
returns boolean
language sql immutable security definer
set search_path = ''
as $$
  select coalesce(p_source, '') in (
    'core.default-tab/new-lead',
    'core.default-tab/contact',
    'core.default-tab/contract-work',
    'core.crm.new-lead',
    'core.crm.pipeline',
    'core.crm.contact',
    'core.crm.work',
    'new-lead',
    'contact',
    'work'
  );
$$;

revoke all on function public.item_operations_canonical_source(text) from public, anon, authenticated, service_role;

-- ① 보관: 활성(삭제·보관 아님) 행만 보관한다. 회사/딜/원장 행은 손대지 않는다.
create or replace function public.archive_board_item_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz default null
)
returns table (item_id uuid, archived_at timestamptz, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_payload jsonb;
  v_prior record;
  v_item record;
  v_board record;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_org_id is null or p_board_id is null or p_item_id is null or p_request_id is null then
    raise exception 'archive input required' using errcode = '22023';
  end if;
  v_actor := public.item_operations_require_actor(p_org_id, 'work.item_delete');

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));


  select b.* into v_board from public.boards b
    where b.id = p_board_id and b.org_id = p_org_id
    for update;
  if not found then
    raise exception 'board not found in this workspace' using errcode = '22023';
  end if;
  if coalesce(v_board.is_system, false) then
    raise exception 'system board is read-only here' using errcode = '42501';
  end if;

  select i.* into v_item from public.items i
    where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id
    for update;
  if not found then
    raise exception 'item not found in this board' using errcode = '22023';
  end if;
  if not public.item_operations_visible(p_org_id, v_item.assigned_to) then
    raise exception 'item operation not allowed for this row' using errcode = '42501';
  end if;

  -- Current row visibility is required even for a lost-response replay.
  select r.actor_id, r.board_id, r.operation, r.payload, r.result_jsonb into v_prior
    from public.item_operation_receipts r
    where r.org_id = p_org_id and r.request_id = p_request_id;
  v_payload := jsonb_build_object(
    'operation', 'archive', 'board_id', p_board_id, 'item_id', p_item_id,
    'expected_updated_at', p_expected_updated_at);
  if found then
    if v_prior.actor_id is distinct from v_actor
       or v_prior.board_id is distinct from p_board_id
       or v_prior.operation <> 'archive'
       or v_prior.payload is distinct from v_payload then
      raise exception 'request payload mismatch' using errcode = '22023';
    end if;
    item_id := (v_prior.result_jsonb ->> 'item_id')::uuid;
    archived_at := (v_prior.result_jsonb ->> 'archived_at')::timestamptz;
    replayed := true;
    return next;
    return;
  end if;
  if v_item.deleted_at is not null then
    raise exception 'trashed item cannot be archived' using errcode = '22023';
  end if;
  if v_item.archived_at is not null then
    raise exception 'item is already archived' using errcode = '22023';
  end if;
  if p_expected_updated_at is not null and v_item.updated_at is distinct from p_expected_updated_at then
    raise exception 'item changed before archive' using errcode = '40001';
  end if;

  update public.items
    set archived_at = v_now, archived_by = v_actor, updated_at = v_now
    where id = p_item_id;
  -- 회사 원본·딜·원장 삭제 없음: 이 함수는 items 한 행만 갱신한다.

  v_result := jsonb_build_object('item_id', p_item_id, 'archived_at', v_now);
  insert into public.item_operation_receipts(org_id, request_id, actor_id, board_id, item_id, operation, payload, result_jsonb)
    values (p_org_id, p_request_id, v_actor, p_board_id, p_item_id, 'archive', v_payload, v_result);

  item_id := p_item_id;
  archived_at := v_now;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.archive_board_item_atomic(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.archive_board_item_atomic(uuid, uuid, uuid, uuid, timestamptz) to authenticated;

-- ① 복구: 보관된(삭제되지 않은) 행만 활성으로 되돌린다.
create or replace function public.restore_archived_board_item_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz default null
)
returns table (item_id uuid, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_payload jsonb;
  v_prior record;
  v_item record;
  v_board record;
  v_now timestamptz := now();
  v_result jsonb;
begin
  if p_org_id is null or p_board_id is null or p_item_id is null or p_request_id is null then
    raise exception 'restore input required' using errcode = '22023';
  end if;
  v_actor := public.item_operations_require_actor(p_org_id, 'work.item_delete');

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));


  select b.* into v_board from public.boards b
    where b.id = p_board_id and b.org_id = p_org_id
    for update;
  if not found then
    raise exception 'board not found in this workspace' using errcode = '22023';
  end if;
  if coalesce(v_board.is_system, false) then
    raise exception 'system board is read-only here' using errcode = '42501';
  end if;

  select i.* into v_item from public.items i
    where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id
    for update;
  if not found then
    raise exception 'item not found in this board' using errcode = '22023';
  end if;
  if not public.item_operations_visible(p_org_id, v_item.assigned_to) then
    raise exception 'item operation not allowed for this row' using errcode = '42501';
  end if;

  -- Current row visibility is required even for a lost-response replay.
  select r.actor_id, r.board_id, r.operation, r.payload, r.result_jsonb into v_prior
    from public.item_operation_receipts r
    where r.org_id = p_org_id and r.request_id = p_request_id;
  v_payload := jsonb_build_object(
    'operation', 'restore_archived', 'board_id', p_board_id, 'item_id', p_item_id,
    'expected_updated_at', p_expected_updated_at);
  if found then
    if v_prior.actor_id is distinct from v_actor
       or v_prior.board_id is distinct from p_board_id
       or v_prior.operation <> 'restore_archived'
       or v_prior.payload is distinct from v_payload then
      raise exception 'request payload mismatch' using errcode = '22023';
    end if;
    item_id := (v_prior.result_jsonb ->> 'item_id')::uuid;
    replayed := true;
    return next;
    return;
  end if;
  if v_item.deleted_at is not null then
    raise exception 'trashed item cannot be restored as archived' using errcode = '22023';
  end if;
  if v_item.archived_at is null then
    raise exception 'item is not archived' using errcode = '22023';
  end if;
  if p_expected_updated_at is not null and v_item.updated_at is distinct from p_expected_updated_at then
    raise exception 'item changed before restore' using errcode = '40001';
  end if;

  update public.items
    set archived_at = null, archived_by = null, updated_at = v_now
    where id = p_item_id;

  v_result := jsonb_build_object('item_id', p_item_id);
  insert into public.item_operation_receipts(org_id, request_id, actor_id, board_id, item_id, operation, payload, result_jsonb)
    values (p_org_id, p_request_id, v_actor, p_board_id, p_item_id, 'restore_archived', v_payload, v_result);

  item_id := p_item_id;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.restore_archived_board_item_atomic(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.restore_archived_board_item_atomic(uuid, uuid, uuid, uuid, timestamptz) to authenticated;

-- ③ 상하위 연결/해제: 같은 조직·같은 보드만, 자기참조·순환 거부, 부모는 활성 행이어야 한다.
-- 그래프 advisory lock으로 직렬화한 뒤 자식·부모를 id 순서로 잠그고,
-- 부모·자식 모두 행 가시성을 검사한다. 조상 체인은 끝까지(최대 200단계) 따라가며
-- 초과분은 fail-closed로 거부한다. 부모 선택이 하위를 암묵적으로 일괄수정/삭제하지
-- 않는다 — 이 함수는 자식 한 행의 parent_item_id만 바꾼다.
create or replace function public.set_board_item_parent_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_parent_item_id uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz default null
)
returns table (item_id uuid, parent_item_id uuid, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_payload jsonb;
  v_prior record;
  v_item record;
  v_board record;
  v_parent record;
  v_op text;
  v_now timestamptz := now();
  v_result jsonb;
  v_cursor uuid;
  v_depth integer := 0;
begin
  if p_org_id is null or p_board_id is null or p_item_id is null or p_request_id is null then
    raise exception 'parent link input required' using errcode = '22023';
  end if;
  v_actor := public.item_operations_require_actor(p_org_id, 'work.item_upsert');

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  v_op := case when p_parent_item_id is null then 'clear_parent' else 'set_parent' end;


  -- 그래프 변경 직렬화: 같은 보드의 상하위 변경은 한 번에 하나씩.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':item-graph:' || p_board_id::text, 0));

  select b.* into v_board from public.boards b
    where b.id = p_board_id and b.org_id = p_org_id
    for update;
  if not found then
    raise exception 'board not found in this workspace' using errcode = '22023';
  end if;
  if coalesce(v_board.is_system, false) then
    raise exception 'system board is read-only here' using errcode = '42501';
  end if;

  -- 자식·부모를 id 순서로 잠근다 (A->B/B->A 동시 변경의 교착·경쟁 방지).
  if p_parent_item_id is not null and p_parent_item_id < p_item_id then
    select i.* into v_parent from public.items i
      where i.id = p_parent_item_id and i.org_id = p_org_id and i.board_id = p_board_id
      for update;
    select i.* into v_item from public.items i
      where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id
      for update;
  else
    select i.* into v_item from public.items i
      where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id
      for update;
    if p_parent_item_id is not null then
      select i.* into v_parent from public.items i
        where i.id = p_parent_item_id and i.org_id = p_org_id and i.board_id = p_board_id
        for update;
    end if;
  end if;
  if v_item.id is null then
    raise exception 'item not found in this board' using errcode = '22023';
  end if;
  if not public.item_operations_visible(p_org_id, v_item.assigned_to) then
    raise exception 'item operation not allowed for this row' using errcode = '42501';
  end if;
  if p_parent_item_id is not null and v_parent.id is null then
    raise exception 'parent must be in the same workspace and board' using errcode = '22023';
  end if;
  if p_parent_item_id is not null and not coalesce(public.item_operations_visible(p_org_id, v_parent.assigned_to), false) then
    raise exception 'parent item is not visible to this actor' using errcode = '42501';
  end if;

  -- Current row visibility is required even for a lost-response replay.
  select r.actor_id, r.board_id, r.operation, r.payload, r.result_jsonb into v_prior
    from public.item_operation_receipts r
    where r.org_id = p_org_id and r.request_id = p_request_id;
  v_payload := jsonb_build_object(
    'operation', v_op, 'board_id', p_board_id, 'item_id', p_item_id,
    'parent_item_id', p_parent_item_id, 'expected_updated_at', p_expected_updated_at);
  if found then
    if v_prior.actor_id is distinct from v_actor
       or v_prior.board_id is distinct from p_board_id
       or v_prior.operation <> v_op
       or v_prior.payload is distinct from v_payload then
      raise exception 'request payload mismatch' using errcode = '22023';
    end if;
    item_id := (v_prior.result_jsonb ->> 'item_id')::uuid;
    parent_item_id := nullif(v_prior.result_jsonb ->> 'parent_item_id', '')::uuid;
    if v_prior.result_jsonb ->> 'parent_item_id' is null then parent_item_id := null; end if;
    replayed := true;
    return next;
    return;
  end if;
  if v_item.deleted_at is not null or v_item.archived_at is not null then
    raise exception 'trashed or archived item cannot be relinked' using errcode = '22023';
  end if;
  if p_expected_updated_at is not null and v_item.updated_at is distinct from p_expected_updated_at then
    raise exception 'item changed before relink' using errcode = '40001';
  end if;

  if p_parent_item_id is not null then
    if p_parent_item_id = p_item_id then
      raise exception 'item cannot be its own parent' using errcode = '22023';
    end if;
    if v_parent.id is null then
      raise exception 'parent must be in the same workspace and board' using errcode = '22023';
    end if;
    if not public.item_operations_visible(p_org_id, v_parent.assigned_to) then
      raise exception 'parent item is not visible to this actor' using errcode = '42501';
    end if;
    if v_parent.deleted_at is not null or v_parent.archived_at is not null then
      raise exception 'parent must be an active item' using errcode = '22023';
    end if;
    -- 순환 검사: 부모 체인을 끝까지 따라가 자기자신이 나오면 거부.
    -- 200단계를 넘기는 체인은 깊이 제한으로 fail-closed 거부한다.
    v_cursor := p_parent_item_id;
    loop
      exit when v_cursor is null;
      if v_cursor = p_item_id then
        raise exception 'parent link would create a cycle' using errcode = '22023';
      end if;
      v_depth := v_depth + 1;
      if v_depth > 200 then
        raise exception 'parent chain is too deep to verify' using errcode = '22023';
      end if;
      select i.parent_item_id into v_cursor from public.items i
        where i.id = v_cursor and i.org_id = p_org_id;
      if not found then
        v_cursor := null;
      end if;
    end loop;
  end if;

  update public.items
    set parent_item_id = p_parent_item_id, updated_at = v_now
    where id = p_item_id;

  v_result := jsonb_build_object('item_id', p_item_id, 'parent_item_id', p_parent_item_id);
  insert into public.item_operation_receipts(org_id, request_id, actor_id, board_id, item_id, operation, payload, result_jsonb)
    values (p_org_id, p_request_id, v_actor, p_board_id, p_item_id, v_op, v_payload, v_result);

  item_id := p_item_id;
  parent_item_id := p_parent_item_id;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.set_board_item_parent_atomic(uuid, uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.set_board_item_parent_atomic(uuid, uuid, uuid, uuid, uuid, timestamptz) to authenticated;

-- ② 안전한 복제: 새 item 행을 원자 생성하고 허용된 입력값만 복사한다.
-- 복사하지 않는 것: deal 연결·담당자·부모·삭제/보관 상태,
-- 금지 키(승인·직인·서명·계약확인·입금/원장·히스토리·파일접근권한·assignment receipt).
-- 복사 조건은 board_columns 실측(존재·읽기전용 아님·파일/계산 아님)이 1차이고
-- 금지 키 판정이 2차다. 정본 딜 계열 보드는 이 경로를 쓰지 않고
-- duplicate_canonical_deal_item_atomic 을 사용해야 하며 22023으로 거부한다.
create or replace function public.duplicate_board_item_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_request_id uuid,
  p_new_item_id uuid default null,
  p_title_override text default null
)
returns table (source_item_id uuid, new_item_id uuid, copied_values integer, skipped_values integer, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_payload jsonb;
  v_prior record;
  v_item record;
  v_board record;
  v_new_id uuid;
  v_title text;
  v_next_sort integer;
  v_copied integer := 0;
  v_skipped integer := 0;
  v_now timestamptz := now();
  v_result jsonb;
  v_has_columns boolean;
begin
  if p_org_id is null or p_board_id is null or p_item_id is null or p_request_id is null then
    raise exception 'duplicate input required' using errcode = '22023';
  end if;
  v_actor := public.item_operations_require_actor(p_org_id, 'work.item_upsert');

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));


  select b.* into v_board from public.boards b
    where b.id = p_board_id and b.org_id = p_org_id
    for update;
  if not found then
    raise exception 'board not found in this workspace' using errcode = '22023';
  end if;
  if coalesce(v_board.is_system, false) then
    raise exception 'system board is read-only here' using errcode = '42501';
  end if;
  -- 정본 딜 계열 보드는 정본 원자 복제 흐름을 사용한다.
  if public.item_operations_canonical_source(v_board.source) then
    raise exception 'canonical board requires canonical duplicate flow' using errcode = '22023';
  end if;

  select i.* into v_item from public.items i
    where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id
    for update;
  if not found then
    raise exception 'item not found in this board' using errcode = '22023';
  end if;
  if not public.item_operations_visible(p_org_id, v_item.assigned_to) then
    raise exception 'item operation not allowed for this row' using errcode = '42501';
  end if;

  -- Current row visibility is required even for a lost-response replay.
  select r.actor_id, r.board_id, r.operation, r.payload, r.result_jsonb into v_prior
    from public.item_operation_receipts r
    where r.org_id = p_org_id and r.request_id = p_request_id;
  v_payload := jsonb_build_object(
    'operation', 'duplicate', 'board_id', p_board_id, 'item_id', p_item_id,
    'new_item_id', p_new_item_id, 'title_override', p_title_override);
  if found then
    if v_prior.actor_id is distinct from v_actor
       or v_prior.board_id is distinct from p_board_id
       or v_prior.operation <> 'duplicate'
       or v_prior.payload is distinct from v_payload then
      raise exception 'request payload mismatch' using errcode = '22023';
    end if;
    source_item_id := (v_prior.result_jsonb ->> 'source_item_id')::uuid;
    new_item_id := (v_prior.result_jsonb ->> 'new_item_id')::uuid;
    copied_values := (v_prior.result_jsonb ->> 'copied_values')::integer;
    skipped_values := (v_prior.result_jsonb ->> 'skipped_values')::integer;
    replayed := true;
    return next;
    return;
  end if;
  if v_item.deleted_at is not null or v_item.archived_at is not null then
    raise exception 'trashed or archived item cannot be duplicated' using errcode = '22023';
  end if;

  v_new_id := coalesce(p_new_item_id, gen_random_uuid());
  if exists(select 1 from public.items where id = v_new_id) then
    raise exception 'duplicate target already exists' using errcode = '22023';
  end if;
  v_title := nullif(btrim(coalesce(p_title_override, '')), '');
  if v_title is null then
    v_title := v_item.title || ' (복사본)';
  end if;
  select coalesce(max(sort_order), -1) + 1 into v_next_sort
    from public.items where org_id = p_org_id and board_id = p_board_id;

  -- 회사 정체성은 그대로 두되(같은 org), 업무/신청 식별자는 새로 만든다:
  -- deal 연결·담당자·부모·삭제/보관 상태는 복사하지 않는다.
  insert into public.items(id, org_id, board_id, group_id, title, assigned_to, sort_order, parent_item_id, deleted_at, deleted_by, archived_at, archived_by, created_at, updated_at)
    values (v_new_id, p_org_id, p_board_id, v_item.group_id, v_title, v_actor, v_next_sort, null, null, null, null, null, v_now, v_now);

  -- deal_id 컬럼이 있는 스키마에서는 연결을 끊는다. 컬럼이 없으면 무시한다.
  begin
    update public.items set deal_id = null where id = v_new_id and deal_id is not null;
  exception when undefined_column then
    -- 구 스키마 호환: deal_id 없음.
    null;
  end;

  -- 허용된 입력값만 복사: 1차 board_columns 실측, 2차 금지 키 판정.
  v_has_columns := to_regclass('public.board_columns') is not null;
  with moved as (
    insert into public.item_values(org_id, item_id, column_key, value_jsonb)
      select v.org_id, v_new_id, v.column_key, v.value_jsonb
        from public.item_values v
        where v.org_id = p_org_id and v.item_id = p_item_id
          and not public.item_duplicate_key_blocked(v.column_key)
          and (
            not v_has_columns
            or exists(
              select 1 from public.board_columns c
              where c.board_id = p_board_id
                and c.key = v.column_key
                and not coalesce(c.is_readonly, false)
                and c.type::text not in ('file', 'calc')
            )
          )
      on conflict (item_id, column_key) do nothing
      returning 1
  )
  select count(*)::integer into v_copied from moved;
  select count(*)::integer into v_skipped
    from public.item_values v
    where v.org_id = p_org_id and v.item_id = p_item_id
      and (
        public.item_duplicate_key_blocked(v.column_key)
        or (
          v_has_columns
          and not exists(
            select 1 from public.board_columns c
            where c.board_id = p_board_id
              and c.key = v.column_key
              and not coalesce(c.is_readonly, false)
              and c.type::text not in ('file', 'calc')
          )
        )
      );

  insert into public.item_duplicate_links(org_id, source_item_id, new_item_id, request_id)
    values (p_org_id, p_item_id, v_new_id, p_request_id);

  v_result := jsonb_build_object(
    'source_item_id', p_item_id, 'new_item_id', v_new_id,
    'copied_values', v_copied, 'skipped_values', v_skipped);
  insert into public.item_operation_receipts(org_id, request_id, actor_id, board_id, item_id, operation, payload, result_jsonb)
    values (p_org_id, p_request_id, v_actor, p_board_id, p_item_id, 'duplicate', v_payload, v_result);

  source_item_id := p_item_id;
  new_item_id := v_new_id;
  copied_values := v_copied;
  skipped_values := v_skipped;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.duplicate_board_item_atomic(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.duplicate_board_item_atomic(uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- ④ 정본 딜 계열 원자 복제: 신규리드·연락·계약업무 보드용 단일 트랜잭션.
-- 원본 deal의 company_id를 새 deal에 그대로 물린다 (회사를 새로 만들거나
-- 옮기지 않고, CRM 식별자 생성·재연결을 하지 않는다).
-- 허용 입력(deal_intake allowlist + 컬럼 실측 통과값)만 옮기고,
-- 담당자·부모·삭제/보관·금지 키는 복사하지 않는다.
-- 출처 기록까지 같은 트랜잭션에서 끝나므로 별도 link 호출이 없다.
create or replace function public.duplicate_canonical_deal_item_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_source_item_id uuid,
  p_request_id uuid,
  p_target_group_id uuid default null,
  p_new_item_id uuid default null,
  p_title_override text default null
)
returns table (source_item_id uuid, new_item_id uuid, new_deal_id uuid, company_id uuid, copied_values integer, skipped_values integer, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_payload jsonb;
  v_prior record;
  v_board record;
  v_source record;
  v_deal record;
  v_intake record;
  v_group uuid;
  v_new_id uuid;
  v_new_deal uuid;
  v_title text;
  v_next_sort integer;
  v_copied integer := 0;
  v_skipped integer := 0;
  v_now timestamptz := now();
  v_result jsonb;
  v_has_columns boolean;
  v_has_intake boolean;
begin
  if p_org_id is null or p_board_id is null or p_source_item_id is null or p_request_id is null then
    raise exception 'canonical duplicate input required' using errcode = '22023';
  end if;
  v_actor := public.item_operations_require_actor(p_org_id, 'work.item_upsert');

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));


  select b.* into v_board from public.boards b
    where b.id = p_board_id and b.org_id = p_org_id
    for update;
  if not found then
    raise exception 'board not found in this workspace' using errcode = '22023';
  end if;
  if coalesce(v_board.is_system, false) then
    raise exception 'system board is read-only here' using errcode = '42501';
  end if;
  if not public.item_operations_canonical_source(v_board.source) then
    raise exception 'canonical duplicate requires a canonical deal board' using errcode = '22023';
  end if;

  select i.* into v_source from public.items i
    where i.id = p_source_item_id and i.org_id = p_org_id and i.board_id = p_board_id
    for update;
  if not found then
    raise exception 'source item not found in this board' using errcode = '22023';
  end if;
  if not public.item_operations_visible(p_org_id, v_source.assigned_to) then
    raise exception 'item operation not allowed for this row' using errcode = '42501';
  end if;

  -- Current row visibility is required even for a lost-response replay.
  select r.actor_id, r.board_id, r.operation, r.payload, r.result_jsonb into v_prior
    from public.item_operation_receipts r
    where r.org_id = p_org_id and r.request_id = p_request_id;
  v_payload := jsonb_build_object(
    'operation', 'duplicate_canonical', 'board_id', p_board_id, 'item_id', p_source_item_id,
    'target_group_id', p_target_group_id, 'new_item_id', p_new_item_id, 'title_override', p_title_override);
  if found then
    if v_prior.actor_id is distinct from v_actor
       or v_prior.board_id is distinct from p_board_id
       or v_prior.operation <> 'duplicate_canonical'
       or v_prior.payload is distinct from v_payload then
      raise exception 'request payload mismatch' using errcode = '22023';
    end if;
    source_item_id := (v_prior.result_jsonb ->> 'source_item_id')::uuid;
    new_item_id := (v_prior.result_jsonb ->> 'new_item_id')::uuid;
    new_deal_id := (v_prior.result_jsonb ->> 'new_deal_id')::uuid;
    company_id := nullif(v_prior.result_jsonb ->> 'company_id', '')::uuid;
    if v_prior.result_jsonb ->> 'company_id' is null then company_id := null; end if;
    copied_values := (v_prior.result_jsonb ->> 'copied_values')::integer;
    skipped_values := (v_prior.result_jsonb ->> 'skipped_values')::integer;
    replayed := true;
    return next;
    return;
  end if;
  if v_source.deleted_at is not null or v_source.archived_at is not null then
    raise exception 'trashed or archived item cannot be duplicated' using errcode = '22023';
  end if;
  if v_source.deal_id is null then
    raise exception 'canonical duplicate requires a deal-linked row' using errcode = '22023';
  end if;

  select d.* into v_deal from public.deals d
    where d.id = v_source.deal_id and d.org_id = p_org_id
    for update;
  if not found then
    raise exception 'source deal not found in this workspace' using errcode = '22023';
  end if;

  v_group := coalesce(p_target_group_id, v_source.group_id);
  if v_group is null then
    raise exception 'canonical duplicate target group required' using errcode = '22023';
  end if;
  if not exists(
    select 1 from public.board_groups g
    where g.id = v_group and g.org_id = p_org_id and g.board_id = p_board_id
  ) then
    raise exception 'canonical duplicate target group unavailable' using errcode = '22023';
  end if;

  v_new_id := coalesce(p_new_item_id, gen_random_uuid());
  if exists(select 1 from public.items where id = v_new_id) then
    raise exception 'duplicate target already exists' using errcode = '22023';
  end if;
  v_title := nullif(btrim(coalesce(p_title_override, '')), '');
  if v_title is null then
    v_title := v_source.title || ' (복사본)';
  end if;
  select coalesce(max(sort_order), -1) + 1 into v_next_sort
    from public.items where org_id = p_org_id and board_id = p_board_id;

  -- 같은 회사로 새 deal을 만든다. 회사는 조회만 하고 절대 생성·수정하지 않는다.
  insert into public.deals(org_id, company_id, pipeline_id, stage_id, assigned_to, title)
    values (p_org_id, v_deal.company_id, v_deal.pipeline_id, v_deal.stage_id, v_actor, v_title)
    returning id into v_new_deal;

  -- Identity keys stay on the source intake (087 org-wide unique constraints).
  -- The new application keeps company_id, but starts without phone/email/external ID.
  -- Do not put the omitted identifiers back into an EAV projection.
  v_has_intake := to_regclass('public.deal_intake') is not null;
  if v_has_intake then
    select di.* into v_intake from public.deal_intake di
      where di.deal_id = v_deal.id and di.org_id = p_org_id;
    if found then
      insert into public.deal_intake(
        deal_id, org_id, representative_name, phone_normalized, phone_display,
        email_normalized, business_registration_type, industry, industry_code,
        revenue_band, region_sido, region_sigungu, acquisition_source, source_external_id
      )
      values (
        v_new_deal, p_org_id, v_intake.representative_name, null, null,
        null, v_intake.business_registration_type, v_intake.industry, v_intake.industry_code,
        v_intake.revenue_band, v_intake.region_sido, v_intake.region_sigungu, v_intake.acquisition_source, null
      );
    end if;
  end if;

  -- 새 item: 같은 보드·대상 그룹, 담당자는 행위자, deal은 새 deal, 부모 없음.
  insert into public.items(id, org_id, board_id, group_id, title, assigned_to, deal_id, sort_order, parent_item_id, deleted_at, deleted_by, archived_at, archived_by, created_at, updated_at)
    values (v_new_id, p_org_id, p_board_id, v_group, v_title, v_actor, v_new_deal, v_next_sort, null, null, null, null, null, v_now, v_now);

  -- The actual 120 trigger runs after UPDATE, once its target projection exists.
  -- Rebuild canonical values from the new intake, never from stale source EAV.
  -- The protected trigger owns its write capability; do not bypass the guard here.
  if v_has_intake and v_board.source = 'core.default-tab/new-lead' then
    update public.deal_intake set updated_at=updated_at
      where org_id=p_org_id and deal_id=v_new_deal;
  end if;

  -- 값 복사: 컬럼 실측 통과 + 금지 키 제외. intake 유래 표시값도 같은 규칙을 따른다.
  v_has_columns := to_regclass('public.board_columns') is not null;
  with moved as (
    insert into public.item_values(org_id, item_id, column_key, value_jsonb)
      select v.org_id, v_new_id, v.column_key, v.value_jsonb
        from public.item_values v
        where v.org_id = p_org_id and v.item_id = p_source_item_id
          and v.column_key not in ('phone','phone_normalized','phone_display','email','email_normalized','source_external_id')
          and (v_board.source <> 'core.default-tab/new-lead' or v.column_key not in ('owner','collaborators','applied_on','rep_name','biz_reg_type','industry','revenue_band','sido','sigungu','ad_name','business_registration_type','industry_code','region_sido','region_sigungu','acquisition_source','address_detail'))
          and not public.item_duplicate_key_blocked(v.column_key)
          and (
            not v_has_columns
            or exists(
              select 1 from public.board_columns c
              where c.board_id = p_board_id
                and c.key = v.column_key
                and not coalesce(c.is_readonly, false)
                and c.type::text not in ('file', 'calc')
            )
          )
      on conflict (item_id, column_key) do nothing
      returning 1
  )
  select count(*)::integer into v_copied from moved;
  select count(*)::integer into v_skipped
    from public.item_values v
    where v.org_id = p_org_id and v.item_id = p_source_item_id
      and (
        public.item_duplicate_key_blocked(v.column_key)
        or v.column_key in ('phone','phone_normalized','phone_display','email','email_normalized','source_external_id')
        or (v_board.source = 'core.default-tab/new-lead' and v.column_key in ('owner','collaborators','applied_on','rep_name','biz_reg_type','industry','revenue_band','sido','sigungu','ad_name','business_registration_type','industry_code','region_sido','region_sigungu','acquisition_source','address_detail'))
        or (
          v_has_columns
          and not exists(
            select 1 from public.board_columns c
            where c.board_id = p_board_id
              and c.key = v.column_key
              and not coalesce(c.is_readonly, false)
              and c.type::text not in ('file', 'calc')
          )
        )
      );

  insert into public.item_duplicate_links(org_id, source_item_id, new_item_id, request_id)
    values (p_org_id, p_source_item_id, v_new_id, p_request_id);

  v_result := jsonb_build_object(
    'source_item_id', p_source_item_id, 'new_item_id', v_new_id,
    'new_deal_id', v_new_deal, 'company_id', v_deal.company_id,
    'copied_values', v_copied, 'skipped_values', v_skipped);
  insert into public.item_operation_receipts(org_id, request_id, actor_id, board_id, item_id, operation, payload, result_jsonb)
    values (p_org_id, p_request_id, v_actor, p_board_id, p_source_item_id, 'duplicate_canonical', v_payload, v_result);

  source_item_id := p_source_item_id;
  new_item_id := v_new_id;
  new_deal_id := v_new_deal;
  company_id := v_deal.company_id;
  copied_values := v_copied;
  skipped_values := v_skipped;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.duplicate_canonical_deal_item_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.duplicate_canonical_deal_item_atomic(uuid, uuid, uuid, uuid, uuid, uuid, text) to authenticated;

-- 정본 복제의 출처 기록 (내부 전용: 원자 복제가 같은 트랜잭션에서 처리하므로
-- Data API grant가 없다. 호출하려면 먼저 원자 복제를 거친다).
-- source·신규 행의 보드/조직/행 + deal 회사 일치까지 검증한다.
create or replace function public.record_item_duplicate_link_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_source_item_id uuid,
  p_new_item_id uuid,
  p_request_id uuid
)
returns table (source_item_id uuid, new_item_id uuid, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_payload jsonb;
  v_prior record;
  v_source record;
  v_new record;
  v_source_company uuid;
  v_new_company uuid;
  v_result jsonb;
begin
  if p_org_id is null or p_board_id is null or p_source_item_id is null
     or p_new_item_id is null or p_request_id is null then
    raise exception 'duplicate link input required' using errcode = '22023';
  end if;
  v_actor := public.item_operations_require_actor(p_org_id, 'work.item_upsert');

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select r.actor_id, r.board_id, r.operation, r.payload, r.result_jsonb into v_prior
    from public.item_operation_receipts r
    where r.org_id = p_org_id and r.request_id = p_request_id;
  v_payload := jsonb_build_object(
    'operation', 'duplicate', 'board_id', p_board_id,
    'item_id', p_source_item_id, 'new_item_id', p_new_item_id);
  if found then
    if v_prior.actor_id is distinct from v_actor
       or v_prior.board_id is distinct from p_board_id
       or v_prior.operation <> 'duplicate'
       or v_prior.payload is distinct from v_payload then
      raise exception 'request payload mismatch' using errcode = '22023';
    end if;
    source_item_id := (v_prior.result_jsonb ->> 'source_item_id')::uuid;
    new_item_id := (v_prior.result_jsonb ->> 'new_item_id')::uuid;
    replayed := true;
    return next;
    return;
  end if;

  if p_source_item_id = p_new_item_id then
    raise exception 'duplicate link requires two different items' using errcode = '22023';
  end if;

  select i.* into v_source from public.items i
    where i.id = p_source_item_id and i.org_id = p_org_id and i.board_id = p_board_id
    for update;
  if not found then
    raise exception 'source item not found in this board' using errcode = '22023';
  end if;
  if not public.item_operations_visible(p_org_id, v_source.assigned_to) then
    raise exception 'item operation not allowed for this row' using errcode = '42501';
  end if;
  select i.* into v_new from public.items i
    where i.id = p_new_item_id and i.org_id = p_org_id
    for update;
  if not found then
    raise exception 'new item not found in this workspace' using errcode = '22023';
  end if;

  -- deal이 양쪽에 있으면 같은 회사 계열이어야 한다 (조직만으로는 부족하다).
  if v_source.deal_id is not null and v_new.deal_id is not null then
    select d.company_id into v_source_company from public.deals d
      where d.id = v_source.deal_id and d.org_id = p_org_id;
    select d.company_id into v_new_company from public.deals d
      where d.id = v_new.deal_id and d.org_id = p_org_id;
    if v_source_company is distinct from v_new_company then
      raise exception 'duplicate link company mismatch' using errcode = '22023';
    end if;
  end if;

  insert into public.item_duplicate_links(org_id, source_item_id, new_item_id, request_id)
    values (p_org_id, p_source_item_id, p_new_item_id, p_request_id);

  v_result := jsonb_build_object('source_item_id', p_source_item_id, 'new_item_id', p_new_item_id);
  insert into public.item_operation_receipts(org_id, request_id, actor_id, board_id, item_id, operation, payload, result_jsonb)
    values (p_org_id, p_request_id, v_actor, p_board_id, p_source_item_id, 'duplicate', v_payload, v_result);

  source_item_id := p_source_item_id;
  new_item_id := p_new_item_id;
  replayed := false;
  return next;
end;
$$;

revoke all on function public.record_item_duplicate_link_atomic(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- 보관 조회는 기존 SELECT + archived_at 조건으로 충분하다 (별도 함수 없음).
-- 활성: archived_at is null and deleted_at is null / 보관: archived_at is not null and deleted_at is null.
-- 이력은 item_operation_receipts(operation in ('archive','restore_archived',...)) 로 조회한다.

comment on column public.items.archived_at is
  '153-draft: 별도 보관 마커. 휴지통(deleted_at)과 독립. 보관해도 회사/딜/원장 행을 삭제하지 않는다.';
comment on column public.items.archived_by is
  '153-draft: 보관 행위자. 복구 시 null로 되돌린다.';

-- Archive is a database write boundary, including existing SECURITY DEFINER RPCs.
-- Companies are deliberately untouched. A shared deal remains writable when it
-- has another active projection; a shelved projection and its own cells stay frozen.
create or replace function public.guard_archived_item_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.archived_at is not null then
    if tg_op = 'UPDATE' and new.archived_at is null and new.archived_by is null
       and (to_jsonb(new) - array['archived_at','archived_by','updated_at'])
           = (to_jsonb(old) - array['archived_at','archived_by','updated_at']) then
      -- Only the restore payload is allowed; it cannot smuggle a title, owner,
      -- position, parent, deletion, or canonical-link mutation into a restore.
      perform public.item_operations_require_actor(old.org_id, 'work.item_delete');
      if not public.item_operations_visible(old.org_id, old.assigned_to) then
        raise exception 'item operation not allowed for this row' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'archived item must be restored before editing' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_archived_item_write() from public, anon, authenticated, service_role;
drop trigger if exists guard_archived_item_write on public.items;
create trigger guard_archived_item_write before update or delete on public.items
for each row execute function public.guard_archived_item_write();

create or replace function public.guard_archived_item_child_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_archived timestamptz;
begin
  -- Lock both old and new targets before checking, including a retargeted value.
  for v_item in
    select distinct id from unnest(array[
      case when tg_op <> 'INSERT' then old.item_id else null end,
      case when tg_op <> 'DELETE' then new.item_id else null end
    ]) id where id is not null order by id
  loop
    select i.archived_at into v_archived from public.items i where i.id = v_item for share;
    if v_archived is not null then
      raise exception 'archived item must be restored before editing' using errcode = '55000';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_archived_item_child_write() from public, anon, authenticated, service_role;
-- These records are item-owned. Shared company records and deal history are not.
do $$
declare v_table text;
begin
  foreach v_table in array array['item_values','board_item_detail_events','work_item_versions','consultation_states','consultation_events'] loop
    if to_regclass('public.' || v_table) is not null then
      execute format('create trigger guard_archived_item_child_write before insert or update or delete on public.%I for each row execute function public.guard_archived_item_child_write()', v_table);
    end if;
  end loop;
end $$;

create or replace function public.guard_archived_deal_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_deal uuid; v_org uuid;
begin
  v_org := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  if tg_table_name = 'deals' then
    v_deal := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_deal := case when tg_op = 'DELETE' then old.deal_id else new.deal_id end;
  end if;
  -- Serialize with archive/restore on the projections. Never freeze an entire
  -- company or a different active deal because one row was archived.
  perform i.id from public.items i
   where i.org_id = v_org and i.deal_id = v_deal and i.deleted_at is null
   order by i.id for share;
  if exists(select 1 from public.items i where i.org_id = v_org and i.deal_id = v_deal and i.deleted_at is null and i.archived_at is not null)
     and not exists(select 1 from public.items i where i.org_id = v_org and i.deal_id = v_deal and i.deleted_at is null and i.archived_at is null) then
    raise exception 'archived item must be restored before editing' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.guard_archived_deal_write() from public, anon, authenticated, service_role;
create trigger guard_archived_deal_write before update or delete on public.deals
for each row execute function public.guard_archived_deal_write();
do $$
begin
  if to_regclass('public.deal_intake') is not null then
    execute 'create trigger guard_archived_deal_write before insert or update or delete on public.deal_intake for each row execute function public.guard_archived_deal_write()';
  end if;
end $$;


-- 139 keeps row positions writer-owned. Its active ordering sets must exclude
-- archived rows as well, otherwise moving an active sibling touches frozen rows.
-- This is an additive redefinition; the applied 139 migration stays unchanged.
do $archive_order$
begin
  if to_regprocedure('public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid)') is not null then
    execute format('grant moawork_row_order_writer to %I with set true, inherit false', current_user);
    grant create on schema public to moawork_row_order_writer;
    set local role moawork_row_order_writer;
    execute $definition$
create or replace function public.issue602_move_board_item_private(
  p_org_id uuid,
  p_item_id uuid,
  p_expected_source_board_id uuid,
  p_expected_source_group_id uuid,
  p_target_board_id uuid,
  p_target_group_id uuid,
  p_before_item_id uuid,
  p_target_position integer default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_board_id uuid;
  v_source_group_id uuid;
  v_target_version bigint;
  v_source_ids uuid[]:='{}'::uuid[];
  v_target_ids uuid[]:='{}'::uuid[];
  v_original_target_ids uuid[]:='{}'::uuid[];
  v_at integer;
begin
  if p_org_id is null or p_item_id is null or p_expected_source_board_id is null
     or p_target_board_id is null or p_target_group_id is null then
    raise exception 'trusted row move input required' using errcode='22023';
  end if;
  if p_before_item_id=p_item_id then
    raise exception 'trusted row move self target' using errcode='22023';
  end if;
  if p_before_item_id is not null and p_target_position is not null then
    raise exception 'trusted row move has competing positions' using errcode='22023';
  end if;
  if p_target_position is not null and p_target_position<0 then
    raise exception 'trusted row move position invalid' using errcode='22023';
  end if;

  -- One tenant-scoped lock makes multi-board trusted moves deadlock-free.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':trusted-row-order',0));
  select i.board_id,i.group_id into v_source_board_id,v_source_group_id
    from public.items i
   where i.id=p_item_id and i.org_id=p_org_id and i.deleted_at is null and i.archived_at is null
   for update;
  if not found or v_source_board_id<>p_expected_source_board_id
     or v_source_group_id is distinct from p_expected_source_group_id then
    raise exception 'trusted row move source changed' using errcode='40001';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_target_board_id and b.org_id=p_org_id)
     or not exists(select 1 from public.board_groups g where g.id=p_target_group_id and g.org_id=p_org_id and g.board_id=p_target_board_id) then
    raise exception 'trusted row move target unavailable' using errcode='22023';
  end if;
  if p_before_item_id is not null and not exists(
    select 1 from public.items i where i.id=p_before_item_id and i.org_id=p_org_id
      and i.board_id=p_target_board_id and i.group_id=p_target_group_id and i.deleted_at is null and i.archived_at is null
  ) then raise exception 'trusted row move anchor unavailable' using errcode='22023'; end if;

  perform 1 from public.boards b where b.org_id=p_org_id
    and b.id in (v_source_board_id,p_target_board_id) order by b.id for update;
  perform 1 from public.items i where i.org_id=p_org_id and i.deleted_at is null and i.archived_at is null
    and ((i.board_id=v_source_board_id and i.group_id is not distinct from v_source_group_id)
      or (i.board_id=p_target_board_id and i.group_id=p_target_group_id))
    order by i.board_id,i.group_id nulls first,i.sort_order,i.id for update;

  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_original_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_target_board_id
      and i.group_id=p_target_group_id and i.deleted_at is null and i.archived_at is null;
  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_target_board_id
      and i.group_id=p_target_group_id and i.deleted_at is null and i.archived_at is null and i.id<>p_item_id;
  if p_target_position is not null then v_at:=least(p_target_position,cardinality(v_target_ids))+1;
  elsif p_before_item_id is null then v_at:=cardinality(v_target_ids)+1;
  else v_at:=array_position(v_target_ids,p_before_item_id); end if;
  if v_at is null then raise exception 'trusted row move anchor unavailable' using errcode='22023'; end if;
  v_target_ids:=coalesce(v_target_ids[1:v_at-1],'{}'::uuid[])||array[p_item_id]||coalesce(v_target_ids[v_at:cardinality(v_target_ids)],'{}'::uuid[]);

  if v_source_board_id=p_target_board_id
     and v_source_group_id is not distinct from p_target_group_id
     and v_target_ids=v_original_target_ids then
    select b.row_order_version into v_target_version from public.boards b
     where b.id=p_target_board_id and b.org_id=p_org_id;
    return v_target_version;
  end if;
  if v_source_board_id<>p_target_board_id or v_source_group_id is distinct from p_target_group_id then
    select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_source_ids
      from public.items i where i.org_id=p_org_id and i.board_id=v_source_board_id
        and i.group_id is not distinct from v_source_group_id and i.deleted_at is null and i.archived_at is null and i.id<>p_item_id;
  end if;

  update public.items i set board_id=p_target_board_id,group_id=p_target_group_id,
      sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
    from unnest(v_target_ids) with ordinality ordered(id,ordinality)
   where i.id=ordered.id and i.org_id=p_org_id;
  if v_source_board_id<>p_target_board_id or v_source_group_id is distinct from p_target_group_id then
    update public.items i set sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
      from unnest(v_source_ids) with ordinality ordered(id,ordinality)
     where i.id=ordered.id and i.org_id=p_org_id and i.board_id=v_source_board_id;
  end if;
  update public.boards b set row_order_version=b.row_order_version+1,updated_at=clock_timestamp()
   where b.org_id=p_org_id and b.id in (v_source_board_id,p_target_board_id);
  select b.row_order_version into v_target_version from public.boards b
   where b.id=p_target_board_id and b.org_id=p_org_id;
  return v_target_version;
end;
$$;
$definition$;
    execute $definition$
create or replace function public.move_board_row_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_target_group_id uuid,
  p_before_item_id uuid,
  p_expected_version bigint,
  p_request_id uuid
) returns table(
  item_id uuid,
  target_group_id uuid,
  before_item_id uuid,
  version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_scope text;
  v_source_group uuid;
  v_version bigint;
  v_payload jsonb;
  v_prior public.board_row_move_requests%rowtype;
  v_source_ids uuid[]:='{}'::uuid[];
  v_target_ids uuid[]:='{}'::uuid[];
  v_original_target_ids uuid[]:='{}'::uuid[];
  v_at integer;
  v_result jsonb;
begin
  if v_actor is null or p_org_id is null or p_board_id is null or p_item_id is null
     or p_expected_version is null or p_expected_version<0 or p_request_id is null then
    raise exception 'row move input required' using errcode='22023';
  end if;
  if p_before_item_id is not null and p_before_item_id=p_item_id then
    raise exception 'row move self target' using errcode='22023';
  end if;
  select m.role::text,m.scope::text into v_role,v_scope
    from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null or not public.effective_permission(p_org_id,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all') then
    raise exception 'row move permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and not b.is_system) then
    raise exception 'board unavailable' using errcode='42501';
  end if;
  v_payload:=jsonb_build_object('board_id',p_board_id,'item_id',p_item_id,'target_group_id',p_target_group_id,'before_item_id',p_before_item_id,'expected_version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select r.* into v_prior from public.board_row_move_requests r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.board_id<>p_board_id or v_prior.payload<>v_payload then
      raise exception 'row move replay conflict' using errcode='22023';
    end if;
    return query select (v_prior.result->>'itemId')::uuid,
      nullif(v_prior.result->>'targetGroupId','')::uuid,
      nullif(v_prior.result->>'beforeItemId','')::uuid,
      (v_prior.result->>'version')::bigint,true;
    return;
  end if;

  if p_target_group_id is not null and not exists(
    select 1 from public.board_groups g where g.id=p_target_group_id and g.org_id=p_org_id and g.board_id=p_board_id
  ) then raise exception 'target group unavailable' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_board_id::text,0));
  select b.row_order_version into v_version from public.boards b
   where b.id=p_board_id and b.org_id=p_org_id and not b.is_system for update;
  if not found then raise exception 'board unavailable' using errcode='42501'; end if;
  if v_version<>p_expected_version then raise exception 'row move stale version' using errcode='40001'; end if;

  select i.group_id into v_source_group
    from public.items i
   where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and i.archived_at is null
   for update;
  if not found then
    raise exception 'row move item unavailable' using errcode='42501';
  end if;
  if p_before_item_id is not null and not exists(
    select 1 from public.items i where i.id=p_before_item_id and i.org_id=p_org_id and i.board_id=p_board_id
      and i.deleted_at is null and i.archived_at is null and i.group_id is not distinct from p_target_group_id
  ) then raise exception 'row move anchor unavailable' using errcode='22023'; end if;

  perform 1 from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and i.archived_at is null
    and (i.group_id is not distinct from v_source_group or i.group_id is not distinct from p_target_group_id)
    order by i.group_id nulls first,i.sort_order,i.id for update;
  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_original_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and i.archived_at is null
      and i.group_id is not distinct from p_target_group_id;
  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and i.archived_at is null
      and i.id<>p_item_id and i.group_id is not distinct from p_target_group_id;
  if p_before_item_id is null then v_at:=cardinality(v_target_ids)+1;
  else v_at:=array_position(v_target_ids,p_before_item_id); end if;
  if v_at is null then raise exception 'row move anchor unavailable' using errcode='22023'; end if;
  v_target_ids:=coalesce(v_target_ids[1:v_at-1],'{}'::uuid[])||array[p_item_id]||coalesce(v_target_ids[v_at:cardinality(v_target_ids)],'{}'::uuid[]);
  if v_source_group is not distinct from p_target_group_id and v_target_ids=v_original_target_ids then
    return query select p_item_id,p_target_group_id,p_before_item_id,v_version,false;
    return;
  end if;
  if v_source_group is distinct from p_target_group_id then
    select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_source_ids
      from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and i.archived_at is null
        and i.id<>p_item_id and i.group_id is not distinct from v_source_group;
  end if;

  update public.items i set group_id=p_target_group_id,sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
    from unnest(v_target_ids) with ordinality ordered(id,ordinality)
   where i.id=ordered.id and i.org_id=p_org_id and i.board_id=p_board_id;
  if v_source_group is distinct from p_target_group_id then
    update public.items i set sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
      from unnest(v_source_ids) with ordinality ordered(id,ordinality)
     where i.id=ordered.id and i.org_id=p_org_id and i.board_id=p_board_id;
  end if;
  v_version:=v_version+1;
  update public.boards set row_order_version=v_version,updated_at=clock_timestamp()
   where id=p_board_id and org_id=p_org_id;
  v_result:=jsonb_build_object('itemId',p_item_id,'targetGroupId',coalesce(p_target_group_id::text,''),'beforeItemId',coalesce(p_before_item_id::text,''),'version',v_version);
  insert into public.board_row_move_requests(org_id,request_id,board_id,actor_id,payload,result)
  values(p_org_id,p_request_id,p_board_id,v_actor,v_payload,v_result);
  return query select p_item_id,p_target_group_id,p_before_item_id,v_version,false;
end;
$$;
$definition$;
    reset role;
    revoke create on schema public from moawork_row_order_writer;
    execute format('revoke moawork_row_order_writer from %I', current_user);
    if has_schema_privilege('moawork_row_order_writer','public','CREATE')
       or exists(select 1 from pg_auth_members m join pg_roles r on r.oid=m.roleid
         where r.rolname='moawork_row_order_writer' and (m.set_option or m.inherit_option))
       or has_function_privilege('authenticated','public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer)','EXECUTE')
       or not has_function_privilege('authenticated','public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid)','EXECUTE') then
      raise exception 'unsafe archive row-order boundary' using errcode='42501';
    end if;
  end if;
end $archive_order$;

-- Refresh only active projections when a shared canonical intake changes.
create or replace function public.sync_new_lead_intake_projection()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_item uuid; v_board uuid;
begin
  select i.id,i.board_id into v_item,v_board
    from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
   where i.org_id=new.org_id and i.deal_id=new.deal_id and i.deleted_at is null and i.archived_at is null
     and b.source='core.default-tab/new-lead';
  if not found then return new; end if;
  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select new.org_id,v_item,x.key,x.value
    from jsonb_each(jsonb_build_object(
      'rep_name',to_jsonb(new.representative_name),'phone',to_jsonb(new.phone_display),'email',to_jsonb(new.email_normalized),
      'biz_reg_type',to_jsonb(new.business_registration_type),'industry',to_jsonb(new.industry),
      'revenue_band',to_jsonb(new.revenue_band),'sido',to_jsonb(new.region_sido),'sigungu',to_jsonb(new.region_sigungu),
      'ad_name',to_jsonb(new.acquisition_source),
      'business_registration_type',to_jsonb(new.business_registration_type),
      'region_sido',to_jsonb(new.region_sido),'region_sigungu',to_jsonb(new.region_sigungu),
      'acquisition_source',to_jsonb(new.acquisition_source)
    )) x join public.board_columns c on c.org_id=new.org_id and c.board_id=v_board and c.key=x.key
  on conflict on constraint item_values_pkey do update
    set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
    values(new.org_id,v_item,'address_detail',to_jsonb(new.address_detail))
  on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  return new;
end $$;
revoke all on function public.sync_new_lead_intake_projection() from public,anon,authenticated,service_role;

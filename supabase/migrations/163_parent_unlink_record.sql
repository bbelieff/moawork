-- moa-migration-guard: logical_key=163_parent_unlink_record predecessor=162_work_handoff_projection digest=2a0a42d3ee10551255b8790b389eaafca1a53b6cb7ffb2b9cb1a77605dcd81d7 foundation=false
select public.begin_guarded_migration(
  p_logical_key => '163_parent_unlink_record', p_file_name => '163_parent_unlink_record.sql',
  p_file_digest => '2a0a42d3ee10551255b8790b389eaafca1a53b6cb7ffb2b9cb1a77605dcd81d7', p_expected_predecessor => '162_work_handoff_projection',
  p_executor => 'Codex', p_thread_id => 'v17-parent-unlink', p_foundation => false
);

-- A fresh database connection can unlink before any parent SELECT has run.
-- A typed row starts with NULL fields; an unassigned record cannot be inspected
-- even inside an AND condition. Keep the complete 153 authority/CAS/receipt body.
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
  v_parent public.items%rowtype;
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

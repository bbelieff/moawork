-- moa-migration-guard: logical_key=175_consultation_meeting_at_mirror predecessor=174_deal_ledger_edit_delete digest=70c3c9a4c7bd1e5bea8480c69ff5c508deac098c79fdf52303545407864cb181 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '175_consultation_meeting_at_mirror',
  p_file_name => '175_consultation_meeting_at_mirror.sql',
  p_file_digest => '70c3c9a4c7bd1e5bea8480c69ff5c508deac098c79fdf52303545407864cb181',
  p_expected_predecessor => '174_deal_ledger_edit_delete',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 884 (belie 결정 2026-10-13 «미팅 일정 한 곳에 저장») — 미팅 일시의 정본은 상담 기록(consultation_states.meeting_at).
--
--   리드컨택 보드의 «미팅 일시»(item_values.meeting_at)는 그 값을 비추는 칸이라 읽기 전용이다. 읽기 전용 칸은
--   item_values RLS(board_column_value_editable, 089)가 사용자 쓰기를 막으므로, 앱이 사용자 권한으로 거울 값을
--   쓸 수 없다. 그래서 «상담 기록 값을 그대로 옮겨 적는 일» 만 하는 좁은 함수를 둔다. 값은 호출자가 고를 수 없다.
--   호출자는 그 행을 볼 수 있는 같은 워크스페이스 멤버여야 한다(대표·관리자·전체 범위·행 담당자).
--   보드에 meeting_at 칸이 없으면 아무것도 하지 않는다.
--
--   한 번 맞추기: 이미 상담 기록에 일시가 있는 리드컨택 행은 보드 칸을 그 값으로 맞춘다(정본으로 덮음).

create or replace function public.mirror_consultation_meeting_at(p_org_id uuid, p_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_meeting timestamptz;
  v_found boolean;
begin
  if auth.uid() is null or not public.is_org_member(p_org_id) then
    raise exception 'consultation mirror denied' using errcode = '42501';
  end if;
  select * into v_item from public.items i where i.org_id = p_org_id and i.id = p_item_id;
  if v_item.id is null then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if not (public.org_role(p_org_id) in ('owner', 'admin') or public.org_scope(p_org_id) = 'all'
          or v_item.assigned_to = auth.uid()) then
    raise exception 'consultation mirror denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.board_columns c where c.board_id = v_item.board_id and c.key = 'meeting_at') then
    return;
  end if;

  select s.meeting_at, true into v_meeting, v_found
    from public.consultation_states s where s.org_id = p_org_id and s.item_id = p_item_id;
  if not coalesce(v_found, false) then
    return;
  end if;

  if v_meeting is null then
    delete from public.item_values where org_id = p_org_id and item_id = p_item_id and column_key = 'meeting_at';
  else
    insert into public.item_values (org_id, item_id, column_key, value_jsonb)
    values (p_org_id, p_item_id, 'meeting_at', to_jsonb(v_meeting))
    on conflict (item_id, column_key) do update set value_jsonb = excluded.value_jsonb;
  end if;
end; $$;

revoke all on function public.mirror_consultation_meeting_at(uuid, uuid) from public, anon;
grant execute on function public.mirror_consultation_meeting_at(uuid, uuid) to authenticated;

-- 한 번 맞추기 — 상담 기록에 일시가 있는 리드컨택 행만. 값이 같으면 건드리지 않는다.
insert into public.item_values (org_id, item_id, column_key, value_jsonb)
select s.org_id, s.item_id, 'meeting_at', to_jsonb(s.meeting_at)
  from public.consultation_states s
  join public.items i on i.org_id = s.org_id and i.id = s.item_id
  join public.boards b on b.id = i.board_id and b.source = 'core.default-tab/contact'
 where s.meeting_at is not null
   and exists (select 1 from public.board_columns c where c.board_id = i.board_id and c.key = 'meeting_at')
on conflict (item_id, column_key) do update set value_jsonb = excluded.value_jsonb
 where public.item_values.value_jsonb is distinct from excluded.value_jsonb;

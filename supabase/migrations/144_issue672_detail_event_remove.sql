-- moa-migration-guard: logical_key=144_issue672_detail_event_remove predecessor=143_issue662_detail_event_kinds digest=b3547271143bb26d7c36dbb0eab9d56a5eb420c6c985e807ca53fc40a75f651a foundation=false

select public.begin_guarded_migration(
  p_logical_key => '144_issue672_detail_event_remove',
  p_file_name => '144_issue672_detail_event_remove.sql',
  p_file_digest => 'b3547271143bb26d7c36dbb0eab9d56a5eb420c6c985e807ca53fc40a75f651a',
  p_expected_predecessor => '143_issue662_detail_event_kinds',
  p_executor => 'DC',
  p_thread_id => '9f4c1e02-7a3b-4d18-b6c5-2e8a1d09f7b4',
  p_foundation => false
);

-- 히스토리를 «치울 수» 있게 한다 (#672).
--
-- ## 총괄 지시
--
--     담당자가 되면 자동기록 과 자기가 작성한 히스토리 지울 수 있게
--     이외 협업자들은 본인이 작성한 히스토리 지울 수 있게
--     회사대표는 모든권한
--
-- ## ★ 지우지 않는다. «치운다».
--
-- 행을 진짜 DELETE 하지 않고 deleted_at 을 채운다. 왜 —
--
--   ① 히스토리는 감사 기록이다. 「무슨 일이 있었나」를 나중에 되짚을 수 있어야 한다.
--      진짜로 지우면 되돌릴 길이 없고, 그건 비가역 고객 데이터 변경이다.
--   ② 실수로 치웠을 때 되살릴 수 있다. 되돌릴 길 없는 조작은 만들지 않는다.
--   ③ 화면에서 안 보이는 것은 사용자에게 「지워진 것」과 같다 — 요구는 그대로 충족된다.
--
-- 원장은 여전히 append-only 다. deleted_at 을 켜는 것도 «한 방향» 이고 행을 없애지 않는다.

alter table public.board_item_detail_events
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id);

-- 살아 있는 것만 읽는 피드가 빠르도록. 기존 인덱스는 그대로 둔다(줄이지 않는다).
create index if not exists board_item_detail_events_live_feed_idx
  on public.board_item_detail_events(org_id, board_id, item_id, created_at desc, id desc)
  where deleted_at is null;

-- ## 누가 무엇을 치울 수 있나 — 이 함수 하나가 정본이다
--
--     회사 대표(owner)          전부
--     담당자(items.assigned_to) 자동 기록(field_change) + 자기가 쓴 것
--     그 밖의 활성 멤버          자기가 쓴 것만
--
-- ★ 화면에서 버튼을 감추는 것으로는 부족하다. 서버가 거부해야 한다 —
--   버튼이 없어도 요청은 손으로 만들 수 있다.
-- ★ admin 은 owner 와 «다르다». 지시가 「회사대표는 모든권한」이라고 콕 집었으므로
--   admin 을 임의로 끼워 넣지 않는다. 필요하면 그때 명시적으로 넓힌다.

create or replace function public.remove_board_item_detail_event(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_event_id uuid
) returns public.board_item_detail_events
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_row public.board_item_detail_events;
  v_assigned_to uuid;
  v_role text;
  v_allowed boolean;
begin
  if v_actor is null then raise exception 'permission_denied' using errcode = '42501'; end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  -- 그 아이템이 이 조직·보드의 것이고, 부르는 사람이 그 조직의 «활성» 멤버인가.
  select i.assigned_to, m.role into v_assigned_to, v_role
    from public.items i
    join public.org_members m on m.org_id = i.org_id and m.user_id = v_actor and m.status = 'active'
   where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id and i.deleted_at is null;
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;

  select * into v_row from public.board_item_detail_events
   where id = p_event_id and org_id = p_org_id and board_id = p_board_id and item_id = p_item_id;
  if not found then raise exception 'detail_event_not_found' using errcode = 'P0002'; end if;

  -- ★ 이미 치워져 있으면 «성공» 으로 돌려준다. 두 번 눌러도 같은 결과여야 한다.
  if v_row.deleted_at is not null then return v_row; end if;

  v_allowed :=
    v_role = 'owner'                                                   -- 대표는 전부
    or v_row.actor_id = v_actor                                        -- 누구나 자기 글
    or (v_assigned_to = v_actor and v_row.kind = 'field_change');      -- 담당자는 자동 기록도

  if not v_allowed then raise exception 'permission_denied' using errcode = '42501'; end if;

  update public.board_item_detail_events
     set deleted_at = now(), deleted_by = v_actor
   where id = p_event_id
  returning * into v_row;
  return v_row;
end $$;

-- ## 되살리기 — 치운 사람과 대표만
--
-- ★ 치울 수 있는 것과 되살릴 수 있는 것을 같게 두지 않는다. 남이 치운 것을
--   아무나 되살리면 「치웠다」가 의미를 잃는다.

create or replace function public.restore_board_item_detail_event(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_event_id uuid
) returns public.board_item_detail_events
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_row public.board_item_detail_events;
  v_role text;
begin
  if v_actor is null then raise exception 'permission_denied' using errcode = '42501'; end if;
  if not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select m.role into v_role
    from public.items i
    join public.org_members m on m.org_id = i.org_id and m.user_id = v_actor and m.status = 'active'
   where i.id = p_item_id and i.org_id = p_org_id and i.board_id = p_board_id and i.deleted_at is null;
  if not found then raise exception 'permission_denied' using errcode = '42501'; end if;

  select * into v_row from public.board_item_detail_events
   where id = p_event_id and org_id = p_org_id and board_id = p_board_id and item_id = p_item_id;
  if not found then raise exception 'detail_event_not_found' using errcode = 'P0002'; end if;
  if v_row.deleted_at is null then return v_row; end if;

  if not (v_role = 'owner' or v_row.deleted_by = v_actor) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  update public.board_item_detail_events
     set deleted_at = null, deleted_by = null
   where id = p_event_id
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.remove_board_item_detail_event(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.restore_board_item_detail_event(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.remove_board_item_detail_event(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.restore_board_item_detail_event(uuid, uuid, uuid, uuid) to authenticated;

-- ## 적용 뒤 사실 확인
--
-- 「적용은 됐는데 여전히 안 되는」 상태로 넘어가지 않게 한다.

do $$
declare
  v_missing text;
begin
  select string_agg(needed, ', ') into v_missing
    from (values ('deleted_at'), ('deleted_by')) as t(needed)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'board_item_detail_events' and column_name = t.needed
   );
  if v_missing is not null then
    raise exception '컬럼이 안 생겼습니다: %', v_missing using errcode = '22023';
  end if;

  -- ★ 옛 컬럼이 그대로 있는가. 넓힌다면서 좁히면 안 된다.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'board_item_detail_events' and column_name = 'kind'
  ) then
    raise exception '기존 컬럼이 사라졌습니다' using errcode = '22023';
  end if;

  -- 아무 행도 치워지지 않은 채로 시작해야 한다 — 이 마이그레이션은 데이터를 안 건드린다.
  if exists (select 1 from public.board_item_detail_events where deleted_at is not null) then
    raise exception '적용만 했는데 치워진 행이 있습니다' using errcode = '22023';
  end if;
end $$;

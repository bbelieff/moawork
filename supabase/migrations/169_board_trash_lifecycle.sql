-- moa-migration-guard: logical_key=169_board_trash_lifecycle predecessor=167_consultation_two_stage_contract digest=024ab2d4e56c6d24176077286dfed43ada5d495a0a436a07d897b278c48c0c9d foundation=false

select public.begin_guarded_migration(
  p_logical_key => '169_board_trash_lifecycle',
  p_file_name => '169_board_trash_lifecycle.sql',
  p_file_digest => '024ab2d4e56c6d24176077286dfed43ada5d495a0a436a07d897b278c48c0c9d',
  p_expected_predecessor => '167_consultation_two_stage_contract',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- #849 탭(보드) 만들기·지우기 백단 — belie 결정 2026-10-06
--
--   · 삭제하면 바로 휴지통. 7일 안에는 그대로 복구, 7일이 지나면 완전 삭제.
--   · 기본 탭(core.default-tab/*)도 똑같이 지운다. 지운 기본 탭은 자동으로 다시 만들지 않고
--     «기본 탭 다시 설치»로 빈 탭을 새로 만든다.
--   · 새 탭은 한 번의 요청으로 탭 + 기본 아이템 1개 + 기본 열 3개를 만들고, 사이드바의
--     업무 › 계약 전 / 계약 후 중 고른 자리에 들어간다.
--
-- 휴지통 설계: deleted_at 을 켜고 source 를 'trash/<id>/<원래 source>' 로 바꾼다.
--   기본 탭을 source 로 찾는 SQL 함수가 20개가 넘는다(095·117·140·141·155·162·167 …).
--   전부 «정확히 같은 source» 로 찾고 없으면 각자의 «unavailable» 오류를 낸다. 접두어를 바꾸면
--   그 함수들을 한 줄도 고치지 않고 휴지통 탭을 «없는 탭» 으로 본다. 'core.default-tab/%' 로
--   시작하지 않으므로 066 의 부분 유일 색인에서도 빠져, 휴지통에 있는 동안 다시 설치할 수 있다.
--   원래 값은 trashed_source 에 둔다(복구 때 되돌림).
--
-- 기본 탭이 다시 생기지 않게: default_tab_dismissals 에 «지운 기본 탭» 을 남긴다. 앱의 설치·
--   진입 복구 경로가 이 표를 보고 건너뛰고, create_workspace_board 도 같은 잠금 안에서 한 번 더
--   막는다(읽고-만들기 사이 경쟁 차단).
--
-- 완전 삭제: 지금 탭 삭제가 실패하던 이유(메모·링크·파일·클라우드 폴더 요청의 NO ACTION FK,
--   회사 시작/접수 영수증의 RESTRICT, 보관된 행 가드)를 순서대로 정리한다. 저장소의 실제 파일은
--   SQL 로 지우지 않는다(service_role 금지). 경로를 board_storage_purge_queue 에 넣고, 탭 삭제
--   권한이 있는 사람이 앱에서 지운 뒤 큐를 비운다.

-- ── 1. 탭 열 ────────────────────────────────────────────────────────────────
alter table public.boards
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null,
  add column if not exists trashed_source text,
  add column if not exists trash_paused_rules jsonb,
  add column if not exists nav_section text,
  add column if not exists trash_purge_attempted_at timestamptz;

alter table public.boards drop constraint if exists boards_nav_section_check;
alter table public.boards add constraint boards_nav_section_check
  check (nav_section is null or nav_section in ('before-contract', 'after-contract'));

alter table public.boards drop constraint if exists boards_trash_shape_check;
alter table public.boards add constraint boards_trash_shape_check check (
  (deleted_at is null and deleted_by is null and trashed_source is null and trash_paused_rules is null
    and (source is null or source not like 'trash/%'))
  or (deleted_at is not null and (
    (trashed_source is null and source is null)
    or source = 'trash/' || id::text || '/' || trashed_source))
);

create index if not exists boards_trash_idx on public.boards(org_id, deleted_at) where deleted_at is not null;

-- 사이드바 자리는 탭 관리 권한(boards_update 정책)으로 바꿀 수 있다. 휴지통 열은 RPC 로만.
grant update(nav_section) on public.boards to authenticated;

-- ── 2. 지운 기본 탭 기록 ────────────────────────────────────────────────────
create table if not exists public.default_tab_dismissals (
  org_id uuid not null references public.orgs(id) on delete cascade,
  source text not null check (source like 'core.default-tab/%'),
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid references public.users(id) on delete set null,
  primary key (org_id, source)
);
alter table public.default_tab_dismissals enable row level security;
revoke all on public.default_tab_dismissals from public, anon, authenticated, service_role;
grant select on public.default_tab_dismissals to authenticated;
drop policy if exists default_tab_dismissals_read on public.default_tab_dismissals;
create policy default_tab_dismissals_read on public.default_tab_dismissals
  for select to authenticated using (public.is_org_member(org_id));

-- ── 3. 저장소 파일 정리 대기열 ─────────────────────────────────────────────
create table if not exists public.board_storage_purge_queue (
  org_id uuid not null references public.orgs(id) on delete cascade,
  storage_path text not null,
  queued_at timestamptz not null default now(),
  primary key (org_id, storage_path)
);
alter table public.board_storage_purge_queue enable row level security;
revoke all on public.board_storage_purge_queue from public, anon, authenticated, service_role;
create index if not exists board_storage_purge_queue_path_idx on public.board_storage_purge_queue(storage_path);

-- 완전 삭제가 진행 중인 탭. 같은 트랜잭션 안에서만 아래 가드 예외가 열린다 — 일반 요청이
-- 휴지통 탭의 보관된 행을 바로 지우는 길로 쓰이지 않게 한다.
create table if not exists public.board_purge_in_progress (
  board_id uuid primary key references public.boards(id) on delete cascade,
  xid xid8 not null default pg_current_xact_id()
);
alter table public.board_purge_in_progress enable row level security;
revoke all on public.board_purge_in_progress from public, anon, authenticated, service_role;

create or replace function public.board_purge_active(p_board_id uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from public.board_purge_in_progress m
     where m.board_id = p_board_id and m.xid = pg_current_xact_id()
  );
$$;

-- ── 4. 보관된 행 가드: 휴지통 탭의 행은 지울 수 있게 ───────────────────────
-- 153 의 두 가드는 보관된 행을 지우는 것을 무조건 막는다. 완전 삭제가 진행 중인 탭(같은
-- 트랜잭션의 board_purge_in_progress)에서만 두 가지를 통과시킨다: 그 탭 행의 DELETE, 그리고
-- 다른 탭으로 옮겨 간 하위 행의 부모 연결 끊기.
create or replace function public.guard_archived_item_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and public.board_purge_active(old.board_id) then
    return old;
  end if;
  if tg_op = 'UPDATE' and old.parent_item_id is not null and new.parent_item_id is null
     and (to_jsonb(new) - array['parent_item_id','updated_at'])
         = (to_jsonb(old) - array['parent_item_id','updated_at'])
     and exists (
       select 1 from public.items p
        where p.id = old.parent_item_id and public.board_purge_active(p.board_id)
     ) then
    return new;
  end if;
  if old.archived_at is not null then
    if tg_op = 'UPDATE' and new.archived_at is null and new.archived_by is null
       and (to_jsonb(new) - array['archived_at','archived_by','updated_at'])
           = (to_jsonb(old) - array['archived_at','archived_by','updated_at']) then
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

create or replace function public.guard_archived_item_child_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_archived timestamptz;
begin
  if tg_op = 'DELETE' and exists (
    select 1 from public.items i where i.id = old.item_id and public.board_purge_active(i.board_id)
  ) then
    return old;
  end if;
  -- 완전 삭제가 옮겨 간 행의 기록을 지금 탭으로 옮길 때: board_id 하나만 바뀐다.
  if tg_op = 'UPDATE' and to_jsonb(old) ? 'board_id'
     and public.board_purge_active((to_jsonb(old)->>'board_id')::uuid)
     and (to_jsonb(new) - 'board_id') = (to_jsonb(old) - 'board_id') then
    return new;
  end if;
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

-- ── 5. 탭 만들기 (한 길) ───────────────────────────────────────────────────
-- 128 판에 사이드바 자리(p_nav_section)와 기본 아이템 「새 아이템」을 더한다. 같은 이름의 6인자
-- 함수를 남기면 오버로드가 둘이 되므로 지우고 다시 만든다. 지운 기본 탭은 여기서도 막는다.
drop function if exists public.create_workspace_board(uuid,text,text,text,text,uuid);
create function public.create_workspace_board(
  p_org_id uuid, p_name text, p_description text, p_icon text, p_source text, p_request_id uuid,
  p_nav_section text default null
)
returns public.boards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_payload jsonb; v_prior public.board_create_requests; v_board public.boards;
        v_sort integer; v_source text; v_section text;
begin
  if v_actor is null or p_request_id is null or length(btrim(coalesce(p_name,''))) not between 1 and 100
     or not public.effective_permission(p_org_id,'structure.tab_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  v_source := nullif(btrim(coalesce(p_source,'')),'');
  if v_source like 'trash/%' then raise exception 'invalid_board_source' using errcode='22023'; end if;
  v_section := case when v_source is null then coalesce(nullif(btrim(coalesce(p_nav_section,'')),''),'after-contract') end;
  if v_section is not null and v_section not in ('before-contract','after-contract') then
    raise exception 'invalid_nav_section' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('name',btrim(p_name),'description',nullif(btrim(coalesce(p_description,'')),''),
    'icon',nullif(btrim(coalesce(p_icon,'')),''),'source',v_source)
    || case when nullif(btrim(coalesce(p_nav_section,'')),'') is null then '{}'::jsonb
            else jsonb_build_object('nav_section',v_section) end;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':board-create',0));
  select * into v_prior from public.board_create_requests where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.payload<>v_payload then
      raise exception 'request_replay_conflict' using errcode='23505';
    end if;
    select * into v_board from public.boards where org_id=p_org_id and id=v_prior.board_id;
    if not found then raise exception 'board_unavailable' using errcode='42501'; end if;
    return v_board;
  end if;
  if v_source like 'core.default-tab/%' and exists (
    select 1 from public.default_tab_dismissals d where d.org_id=p_org_id and d.source=v_source
  ) then
    raise exception 'default_tab_dismissed' using errcode='55000';
  end if;
  select coalesce(max(sort_order)+1,0) into v_sort from public.boards where org_id=p_org_id;
  insert into public.boards(org_id,name,description,icon,is_system,source,sort_order,created_by,nav_section)
    values(p_org_id,btrim(p_name),v_payload->>'description',v_payload->>'icon',false,v_source,v_sort,v_actor,v_section)
    returning * into v_board;
  if v_source is null then
    insert into public.board_columns(org_id,board_id,key,label,type,source,right_pinned,options_jsonb,sort_order,is_readonly)
    values
      (p_org_id,v_board.id,'status','상태','select','in',false,'{"options":[{"id":"opt-todo","label":"대기","color":"#c4c4c4","order":0},{"id":"opt-doing","label":"진행중","color":"#fdab3d","order":1},{"id":"opt-done","label":"완료","color":"#00c875","order":2}]}'::jsonb,0,false),
      (p_org_id,v_board.id,'owner','담당','person','in',false,null,1,false),
      (p_org_id,v_board.id,'due','마감일','date','in',false,null,2,false);
    insert into public.board_groups(org_id,board_id,name,color,sort_order)
      values(p_org_id,v_board.id,'새 아이템',null,0);
  end if;
  insert into public.board_create_requests(org_id,request_id,actor_id,payload,board_id)
    values(p_org_id,p_request_id,v_actor,v_payload,v_board.id);
  return v_board;
end $$;

-- 탭 순서 저장도 휴지통 탭을 빼고 본다. 128 판은 휴지통 탭까지 «있어야 할 탭» 으로 세서
-- 휴지통에 탭이 하나라도 있으면 순서 저장이 항상 실패한다. 4곳에 deleted_at is null 만 더한다.
create or replace function public.reorder_workspace_boards(p_org_id uuid,p_board_ids uuid[],p_request_id uuid)
returns setof public.boards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_expected uuid[]; v_supplied uuid[]; v_prior public.board_order_requests;
begin
  if v_actor is null or p_request_id is null or not public.effective_permission(p_org_id,'structure.tab_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':board-order',0));
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_expected from public.boards
    where org_id=p_org_id and not is_system and deleted_at is null and coalesce(source,'') not like 'user.section-preset/%';
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into v_supplied from unnest(coalesce(p_board_ids,'{}'::uuid[])) id;
  if cardinality(coalesce(p_board_ids,'{}'::uuid[]))<>cardinality(v_supplied) or v_expected<>v_supplied then
    raise exception 'board_order_invalid' using errcode='22023';
  end if;
  select * into v_prior from public.board_order_requests where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.board_ids<>p_board_ids then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return query select * from public.boards where org_id=p_org_id and not is_system and deleted_at is null and coalesce(source,'') not like 'user.section-preset/%' order by sort_order,id;
    return;
  end if;
  update public.boards b set sort_order=ordered.position-1,updated_at=now()
    from unnest(p_board_ids) with ordinality ordered(id,position)
    where b.org_id=p_org_id and b.id=ordered.id and not b.is_system and b.deleted_at is null and coalesce(b.source,'') not like 'user.section-preset/%';
  insert into public.board_order_requests(org_id,request_id,actor_id,board_ids) values(p_org_id,p_request_id,v_actor,p_board_ids);
  return query select * from public.boards where org_id=p_org_id and not is_system and deleted_at is null and coalesce(source,'') not like 'user.section-preset/%' order by sort_order,id;
end $$;
revoke all on function public.reorder_workspace_boards(uuid,uuid[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.reorder_workspace_boards(uuid,uuid[],uuid) to authenticated;

-- 휴지통 탭은 직접 DELETE 로 지우지 않고 완전 삭제(정리 순서·저장소 대기열)로만 지운다.
drop policy if exists boards_delete on public.boards;
create policy boards_delete on public.boards for delete to authenticated
  using (public.effective_permission(org_id,'danger.bulk_edit_delete') and deleted_at is null);

-- ── 6. 휴지통으로 ───────────────────────────────────────────────────────────
create or replace function public.trash_workspace_board(p_org_id uuid, p_board_id uuid)
returns public.boards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_board public.boards; v_paused jsonb;
begin
  if v_actor is null or not public.effective_permission(p_org_id,'danger.bulk_edit_delete') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':board-create',0));
  select * into v_board from public.boards where org_id=p_org_id and id=p_board_id for update;
  if not found then raise exception 'board_unavailable' using errcode='42501'; end if;
  if v_board.is_system then raise exception 'system_board' using errcode='42501'; end if;
  if v_board.deleted_at is not null then return v_board; end if;

  -- 휴지통 동안 고객 문자·자동화가 돌지 않게 끄고, 복구 때 켤 것만 기억한다.
  v_paused := jsonb_build_object(
    'messaging', (select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb) from public.messaging_trigger_rules r
                   where r.org_id=p_org_id and r.board_id=p_board_id and r.enabled),
    'automation', (select coalesce(jsonb_agg(r.id order by r.id),'[]'::jsonb) from public.board_automation_rules r
                   where r.org_id=p_org_id and r.board_id=p_board_id and r.enabled));
  update public.messaging_trigger_rules set enabled=false where org_id=p_org_id and board_id=p_board_id and enabled;
  update public.board_automation_rules set enabled=false where org_id=p_org_id and board_id=p_board_id and enabled;

  update public.boards
     set deleted_at=now(), deleted_by=v_actor, trashed_source=source,
         source=case when source is null then null else 'trash/'||id::text||'/'||source end,
         trash_paused_rules=v_paused, trash_purge_attempted_at=null, updated_at=now()
   where org_id=p_org_id and id=p_board_id
  returning * into v_board;

  if v_board.trashed_source like 'core.default-tab/%' then
    insert into public.default_tab_dismissals(org_id,source,dismissed_by)
      values(p_org_id,v_board.trashed_source,v_actor)
      on conflict (org_id,source) do update set dismissed_at=now(), dismissed_by=excluded.dismissed_by;
  end if;
  return v_board;
end $$;

-- ── 7. 복구 ────────────────────────────────────────────────────────────────
create or replace function public.restore_workspace_board(p_org_id uuid, p_board_id uuid)
returns public.boards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_board public.boards; v_source text; v_paused jsonb;
begin
  if v_actor is null or not public.effective_permission(p_org_id,'danger.bulk_edit_delete') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':board-create',0));
  select * into v_board from public.boards where org_id=p_org_id and id=p_board_id for update;
  if not found then raise exception 'board_unavailable' using errcode='42501'; end if;
  if v_board.deleted_at is null then return v_board; end if;
  v_source := v_board.trashed_source;
  if v_source like 'core.default-tab/%' and exists (
    select 1 from public.boards b where b.org_id=p_org_id and b.source=v_source
  ) then
    raise exception 'default_tab_already_installed' using errcode='23505';
  end if;
  v_paused := coalesce(v_board.trash_paused_rules,'{}'::jsonb);

  update public.boards
     set source=v_source, trashed_source=null, deleted_at=null, deleted_by=null, trash_paused_rules=null,
         trash_purge_attempted_at=null, updated_at=now()
   where org_id=p_org_id and id=p_board_id
  returning * into v_board;

  update public.messaging_trigger_rules set enabled=true
   where org_id=p_org_id and board_id=p_board_id
     and id in (select (jsonb_array_elements_text(coalesce(v_paused->'messaging','[]'::jsonb)))::uuid);
  update public.board_automation_rules set enabled=true
   where org_id=p_org_id and board_id=p_board_id
     and id in (select (jsonb_array_elements_text(coalesce(v_paused->'automation','[]'::jsonb)))::uuid);

  if v_source like 'core.default-tab/%' then
    delete from public.default_tab_dismissals where org_id=p_org_id and source=v_source;
  end if;
  return v_board;
end $$;

-- ── 8. 완전 삭제 ────────────────────────────────────────────────────────────
-- 권한 검사가 없는 내부 함수. 아래 두 진입점만 부른다(어느 역할에도 실행 권한을 주지 않음).
create or replace function public.purge_trashed_board_internal(p_org_id uuid, p_board_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_board public.boards; v_items uuid[]; v_paths text[];
begin
  select * into v_board from public.boards where org_id=p_org_id and id=p_board_id for update;
  if not found or v_board.deleted_at is null then
    raise exception 'board_not_in_trash' using errcode='55000';
  end if;
  insert into public.board_purge_in_progress(board_id) values (p_board_id)
    on conflict (board_id) do update set xid = pg_current_xact_id();
  select coalesce(array_agg(i.id),'{}') into v_items from public.items i where i.org_id=p_org_id and i.board_id=p_board_id;

  -- 다른 탭으로 옮겨 간 행의 기록이 옛 탭 id 를 들고 있으면 지우지 않고 지금 탭으로 옮긴다.
  update public.board_item_detail_events e set board_id=i.board_id from public.items i
   where e.org_id=p_org_id and e.board_id=p_board_id and i.id=e.item_id and i.org_id=p_org_id and i.board_id<>p_board_id;
  update public.board_item_detail_links l set board_id=i.board_id from public.items i
   where l.org_id=p_org_id and l.board_id=p_board_id and i.id=l.item_id and i.org_id=p_org_id and i.board_id<>p_board_id;
  update public.board_item_detail_files f set board_id=i.board_id from public.items i
   where f.org_id=p_org_id and f.board_id=p_board_id and i.id=f.item_id and i.org_id=p_org_id and i.board_id<>p_board_id;
  update public.board_item_cloud_folder_requests c set board_id=i.board_id from public.items i
   where c.org_id=p_org_id and c.board_id=p_board_id and i.id=c.item_id and i.org_id=p_org_id and i.board_id<>p_board_id;
  -- 다른 탭으로 옮겨 간 하위 행은 지우지 않고 부모 연결만 끊는다(부모 삭제가 하위까지 지우는 cascade 차단).
  update public.items c set parent_item_id=null
   where c.org_id=p_org_id and c.parent_item_id=any(v_items) and c.board_id<>p_board_id;

  -- 저장소 정리 대상: 이번에 실제로 지우는 행의 파일 중, 남는 행이 같은 경로를 쓰지 않는 것만.
  select coalesce(array_agg(distinct s.storage_path),'{}') into v_paths from (
    select f.storage_path from public.board_item_detail_files f
     where f.org_id=p_org_id and f.item_id=any(v_items)
    union
    select r.storage_path from public.board_item_detail_file_reservations r
     where r.org_id=p_org_id and r.item_id=any(v_items) and r.state<>'cancelled'
  ) s
  where not exists (
    select 1 from public.board_item_detail_files kept
     where kept.storage_path=s.storage_path and not (kept.item_id=any(v_items))
  );

  -- 이 탭 행에 붙은 것: FK 가 NO ACTION/RESTRICT 라 행보다 먼저 지운다.
  delete from public.board_item_detail_files where org_id=p_org_id and item_id=any(v_items);
  delete from public.board_item_detail_links where org_id=p_org_id and item_id=any(v_items);
  delete from public.board_item_cloud_folder_requests where org_id=p_org_id and item_id=any(v_items);
  delete from public.board_item_detail_events where org_id=p_org_id and item_id=any(v_items);
  delete from public.company_work_start_requests where org_id=p_org_id and item_id=any(v_items);
  delete from public.company_intake_requests where org_id=p_org_id and item_id=any(v_items);
  delete from public.board_item_create_receipts where org_id=p_org_id and item_id=any(v_items);
  delete from public.notifications
   where org_id=p_org_id
     and ((target_type='board_item' and target_id=any(v_items)) or (target_type='board' and target_id=p_board_id));

  -- 행은 한 문장으로: 칸 값·하위 행·상담 상태 등은 FK cascade 가 따라 지운다.
  delete from public.items where org_id=p_org_id and board_id=p_board_id;
  delete from public.board_groups where org_id=p_org_id and board_id=p_board_id;
  delete from public.boards where org_id=p_org_id and id=p_board_id;

  insert into public.board_storage_purge_queue(org_id,storage_path)
    select p_org_id, p from unnest(v_paths) p
    on conflict (org_id,storage_path) do nothing;
  return coalesce(array_length(v_paths,1),0);
end $$;

create or replace function public.purge_workspace_board(p_org_id uuid, p_board_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'danger.bulk_edit_delete') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return public.purge_trashed_board_internal(p_org_id, p_board_id);
end $$;

-- 7일 지난 휴지통 탭을 지운다. 탭 관리 권한이 있는 사람이 앱을 열 때 부르고(워커가 꺼져 있어도
-- 지워지게), pg_cron 이 있으면 매일 한 번 전체를 돈다. 한 탭이 실패해도 나머지는 계속한다.
create or replace function public.purge_expired_workspace_boards(p_org_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_board uuid; v_count integer:=0;
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'structure.tab_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  for v_board in
    select b.id from public.boards b
     where b.org_id=p_org_id and b.deleted_at is not null and b.deleted_at < now() - interval '7 days'
     order by coalesce(b.trash_purge_attempted_at, b.deleted_at) limit 20
  loop
    begin
      perform public.purge_trashed_board_internal(p_org_id, v_board);
      v_count := v_count + 1;
    exception when others then
      -- 실패한 탭은 뒤로 미뤄 다른 탭 정리를 막지 않는다.
      update public.boards set trash_purge_attempted_at=now() where id=v_board;
      raise warning 'board purge skipped: % (%)', v_board, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;

create or replace function public.purge_expired_boards_all()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row record; v_count integer:=0;
begin
  for v_row in
    select b.org_id, b.id from public.boards b
     where b.deleted_at is not null and b.deleted_at < now() - interval '7 days'
     order by coalesce(b.trash_purge_attempted_at, b.deleted_at) limit 200
  loop
    begin
      perform public.purge_trashed_board_internal(v_row.org_id, v_row.id);
      v_count := v_count + 1;
    exception when others then
      update public.boards set trash_purge_attempted_at=now() where id=v_row.id;
      raise warning 'board purge skipped: % (%)', v_row.id, sqlerrm;
    end;
  end loop;
  return v_count;
end $$;

-- ── 9. 삭제 전에 보여 줄 개수 ─────────────────────────────────────────────
create or replace function public.read_board_trash_impact(p_org_id uuid, p_board_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'danger.bulk_edit_delete') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if not exists (select 1 from public.boards b where b.org_id=p_org_id and b.id=p_board_id) then
    raise exception 'board_unavailable' using errcode='42501';
  end if;
  select jsonb_build_object(
    'groups', (select count(*) from public.board_groups g where g.org_id=p_org_id and g.board_id=p_board_id),
    'rows', (select count(*) from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null),
    'memos', (select count(*) from public.board_item_detail_events e join public.items i on i.id=e.item_id
               where e.org_id=p_org_id and i.board_id=p_board_id and e.deleted_at is null and e.kind<>'field_change'),
    'files', (select count(*) from public.board_item_detail_files f join public.items i on i.id=f.item_id
               where f.org_id=p_org_id and i.board_id=p_board_id),
    'views', (select count(*) from public.tab_views v where v.org_id=p_org_id and v.board_id=p_board_id),
    'automations', (select count(*) from public.board_automation_rules r where r.org_id=p_org_id and r.board_id=p_board_id),
    'messaging', (select count(*) from public.messaging_trigger_rules r where r.org_id=p_org_id and r.board_id=p_board_id)
  ) into v_result;
  return v_result;
end $$;

-- ── 10. 지운 기본 탭 다시 설치 ─────────────────────────────────────────────
-- 기록만 지운다. 빈 기본 탭을 만드는 일은 앱의 기본 탭 설치 경로가 한다(같은 템플릿 한 곳).
create or replace function public.clear_default_tab_dismissal(p_org_id uuid, p_source text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'structure.tab_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if p_source is null or p_source not like 'core.default-tab/%' then
    raise exception 'invalid_default_tab' using errcode='22023';
  end if;
  delete from public.default_tab_dismissals where org_id=p_org_id and source=p_source;
  return found;
end $$;

-- ── 11. 저장소 파일 정리 ───────────────────────────────────────────────────
create or replace function public.can_purge_board_storage_object(p_name text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists (
    select 1 from public.board_storage_purge_queue q
     where q.storage_path = p_name
       and split_part(p_name, '/', 1) = q.org_id::text
       and public.effective_permission(q.org_id,'danger.bulk_edit_delete')
  );
$$;

create or replace function public.list_board_storage_purge_queue(p_org_id uuid, p_limit integer default 100)
returns setof text language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'danger.bulk_edit_delete') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return query select q.storage_path from public.board_storage_purge_queue q
    where q.org_id=p_org_id order by q.queued_at, q.storage_path
    limit greatest(1, least(coalesce(p_limit,100), 500));
end $$;

create or replace function public.ack_board_storage_purge(p_org_id uuid, p_paths text[])
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'danger.bulk_edit_delete') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  delete from public.board_storage_purge_queue where org_id=p_org_id and storage_path=any(coalesce(p_paths,'{}'));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

drop policy if exists board_item_files_purge_delete on storage.objects;
create policy board_item_files_purge_delete on storage.objects for delete to authenticated using (
  bucket_id = 'board-item-files' and public.can_purge_board_storage_object(name)
);
-- 저장소 API 는 DELETE … WHERE … RETURNING 으로 지운다. 그래서 SELECT 정책도 통과해야 하는데,
-- 기존 SELECT 정책(124·164)은 살아 있는 행을 요구한다 — 완전 삭제 뒤에는 큐에 있는 경로만 보이게 연다.
drop policy if exists board_item_files_purge_select on storage.objects;
create policy board_item_files_purge_select on storage.objects for select to authenticated using (
  bucket_id = 'board-item-files' and public.can_purge_board_storage_object(name)
);

-- ── 12. 쓰는 곳이 없는 공지 탭 자동 생성 RPC 를 닫는다 ─────────────────────
-- 앱은 기본 탭 설치 경로로 공지 탭을 만든다. 이 RPC 는 «지운 기본 탭» 기록을 모르므로 열어 두면
-- 지운 공지 탭을 다시 만들 수 있다.
do $$ begin
  if to_regprocedure('public.bbe151_ensure_notice_tab(uuid)') is not null then
    execute 'revoke execute on function public.bbe151_ensure_notice_tab(uuid) from authenticated';
  end if;
end $$;

-- ── 13. 권한 ───────────────────────────────────────────────────────────────
revoke all on function public.create_workspace_board(uuid,text,text,text,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.trash_workspace_board(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.restore_workspace_board(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.purge_trashed_board_internal(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.board_purge_active(uuid) from public,anon,authenticated,service_role;
revoke all on function public.purge_workspace_board(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.purge_expired_workspace_boards(uuid) from public,anon,authenticated,service_role;
revoke all on function public.purge_expired_boards_all() from public,anon,authenticated,service_role;
revoke all on function public.read_board_trash_impact(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.clear_default_tab_dismissal(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.can_purge_board_storage_object(text) from public,anon,authenticated,service_role;
revoke all on function public.list_board_storage_purge_queue(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.ack_board_storage_purge(uuid,text[]) from public,anon,authenticated,service_role;
grant execute on function public.create_workspace_board(uuid,text,text,text,text,uuid,text) to authenticated;
grant execute on function public.trash_workspace_board(uuid,uuid) to authenticated;
grant execute on function public.restore_workspace_board(uuid,uuid) to authenticated;
grant execute on function public.purge_workspace_board(uuid,uuid) to authenticated;
grant execute on function public.purge_expired_workspace_boards(uuid) to authenticated;
grant execute on function public.read_board_trash_impact(uuid,uuid) to authenticated;
grant execute on function public.clear_default_tab_dismissal(uuid,text) to authenticated;
grant execute on function public.can_purge_board_storage_object(text) to authenticated;
grant execute on function public.list_board_storage_purge_queue(uuid,integer) to authenticated;
grant execute on function public.ack_board_storage_purge(uuid,text[]) to authenticated;

do $$ begin
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema='public'
       and routine_name in ('create_workspace_board','trash_workspace_board','restore_workspace_board','board_purge_active',
         'purge_trashed_board_internal','purge_workspace_board','purge_expired_workspace_boards','purge_expired_boards_all',
         'read_board_trash_impact','clear_default_tab_dismissal','can_purge_board_storage_object',
         'list_board_storage_purge_queue','ack_board_storage_purge')
       and grantee in ('PUBLIC','anon','service_role')
  ) or exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema='public' and routine_name in ('purge_trashed_board_internal','purge_expired_boards_all','board_purge_active')
       and grantee='authenticated'
  ) then
    raise exception 'unsafe_board_trash_rpc_acl';
  end if;
end $$;

-- ── 14. 매일 한 번 7일 지난 휴지통 정리 (pg_cron 이 있을 때만) ─────────────
do $board_trash_schedule$
begin
  if to_regnamespace('cron') is not null then
    execute $schedule$
      select cron.schedule(
        'moawork-board-trash-purge',
        '20 15 * * *',
        'select public.purge_expired_boards_all()'
      )
    $schedule$;
  end if;
end
$board_trash_schedule$;

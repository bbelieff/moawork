-- moa-migration-guard: logical_key=143_issue662_detail_event_kinds predecessor=142_issue653_pgcrypto_search_path digest=debb3afda7a87af3fb61d89a3ee82494196f63d4a70f208e553bdf0e020e76b9 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '143_issue662_detail_event_kinds',
  p_file_name => '143_issue662_detail_event_kinds.sql',
  p_file_digest => 'debb3afda7a87af3fb61d89a3ee82494196f63d4a70f208e553bdf0e020e76b9',
  p_expected_predecessor => '142_issue653_pgcrypto_search_path',
  p_executor => 'DC',
  p_thread_id => '9f4c1e02-7a3b-4d18-b6c5-2e8a1d09f7b4',
  p_foundation => false
);

-- 히스토리 성격에 「행정」과 「미팅」을 더한다 (#662).
--
-- ## 왜
--
-- 지금 남길 수 있는 것은 memo · call 둘뿐이라, 실무의 «서류 접수·발급» 과 «미팅» 이
-- 전부 「메모」로 뭉뚱그려진다. 나중에 「미팅만 보기」 같은 것도 할 수 없다.
--
-- ## 넓히기만 한다
--
-- ★ 기존 값을 옮기거나 지우지 않는다. memo · call · field_change 는 그대로 있고
--   허용 목록에 admin · meeting 을 «더할» 뿐이다. 고객 행 UPDATE/DELETE 0.
-- ★ field_change 는 계속 «사람이 못 고르는» 값이다 — 시스템이 남기는 기록이라
--   아래 RPC 가드에서도 빠져 있다. 배지에 뜨는 값은 다섯, 고를 수 있는 값은 넷이다.

alter table public.board_item_detail_events
  drop constraint if exists board_item_detail_events_kind_check;

alter table public.board_item_detail_events
  add constraint board_item_detail_events_kind_check
  check (kind in ('memo', 'call', 'admin', 'meeting', 'field_change'));

-- ## RPC — 가드 한 줄만 넓힌다
--
-- ★ 본문은 124 의 것을 «글자 그대로» 옮겼다. 바뀐 곳은 아래 한 줄뿐이다:
--     전:  if p_kind not in ('memo','call')            then ... raise
--     후:  if p_kind not in ('memo','call','admin','meeting') then ... raise
--   손으로 다시 쓰면 권한 검사·멱등·멘션 검증이 조금씩 달라지고, 그건 권한 하향이 될 수 있다
--   (140 번 파일이 같은 이유로 경고한다).

create or replace function public.add_board_item_detail_event(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_kind text, p_body text, p_request_id uuid,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
) returns public.board_item_detail_events
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_events; v_row public.board_item_detail_events; v_assigned_to uuid; v_mentions uuid[];
begin
  if v_actor is null then raise exception 'permission_denied' using errcode='42501'; end if;
  if not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_kind not in ('memo','call','admin','meeting') or length(btrim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'invalid_detail_event' using errcode='22023'; end if;
  select i.assigned_to into v_assigned_to from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id join public.org_members m on m.org_id=i.org_id and m.user_id=v_actor and m.status='active' where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=v_actor);
  if not found then raise exception 'permission_denied' using errcode='42501'; end if;
  select coalesce(array_agg(user_id order by user_id),'{}'::uuid[]) into v_mentions from (select distinct unnest(coalesce(p_mentioned_user_ids,'{}'::uuid[])) user_id) normalized;
  select * into v_existing from public.board_item_detail_events where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_existing.item_id<>p_item_id or v_existing.kind<>p_kind or v_existing.body<>btrim(p_body) or coalesce(v_existing.metadata->'mentioned_user_ids','[]'::jsonb)<>to_jsonb(v_mentions) then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return v_existing;
  end if;
  if exists(
    select 1 from unnest(v_mentions) mentioned(user_id)
    where mentioned.user_id=v_actor or mentioned.user_id is distinct from v_assigned_to or not exists(
      select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=mentioned.user_id and m.status='active'
    )
  ) then raise exception 'invalid_mention_recipient' using errcode='42501'; end if;
  insert into public.board_item_detail_events(org_id,board_id,item_id,actor_id,kind,body,metadata,request_id)
  values(p_org_id,p_board_id,p_item_id,v_actor,p_kind,btrim(p_body),jsonb_build_object('mentioned_user_ids',v_mentions),p_request_id) returning * into v_row;
  insert into public.notifications(org_id,user_id,type,title,body,target_type,target_id,actor_id,is_action,dedupe_key)
  select p_org_id,recipient.user_id,'mention','업무 상세에서 회원님을 언급했습니다','회사 업무의 메모에서 회원님을 언급했습니다.','board_item',p_item_id,v_actor,false,'item-detail-mention:'||p_request_id::text
  from unnest(v_mentions) recipient(user_id)
  on conflict (org_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  return v_row;
end $$;

-- ## 적용 뒤 사실 확인
--
-- 넓힌 값이 실제로 통과하는지, 그리고 «넓히기만» 했는지를 여기서 잡는다.
-- 「적용은 됐는데 여전히 안 되는」 상태로 넘어가지 않게 한다.

do $$
declare
  v_allowed text;
begin
  select pg_get_constraintdef(oid) into v_allowed
  from pg_constraint
  where conrelid = 'public.board_item_detail_events'::regclass
    and conname = 'board_item_detail_events_kind_check';

  -- 새 값이 들어왔는가
  if v_allowed is null or v_allowed not like '%admin%' or v_allowed not like '%meeting%' then
    raise exception '행정·미팅이 허용 목록에 없습니다: %', coalesce(v_allowed, '(제약 없음)') using errcode = '22023';
  end if;

  -- ★ 옛 값이 «그대로» 있는가. 넓힌다면서 좁히면 이미 쌓인 기록이 규칙을 어기게 된다.
  if v_allowed not like '%memo%' or v_allowed not like '%call%' or v_allowed not like '%field_change%' then
    raise exception '기존 성격이 허용 목록에서 빠졌습니다: %', v_allowed using errcode = '22023';
  end if;
end $$;

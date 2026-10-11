-- moa-migration-guard: logical_key=171_restore_deal_reassign_and_comment_edit predecessor=170_member_account_profiles_batch digest=08ed0a91cf3b227babc00ee5917ae6f4b89e4d91dac294562c29efeb8b799353 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '171_restore_deal_reassign_and_comment_edit',
  p_file_name => '171_restore_deal_reassign_and_comment_edit.sql',
  p_file_digest => '08ed0a91cf3b227babc00ee5917ae6f4b89e4d91dac294562c29efeb8b799353',
  p_expected_predecessor => '170_member_account_profiles_batch',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 881 — 운영 DB 와 064 의 어긋남을 바로잡는다 (2026-10-11 운영 구조 대조).
--
--   064_deal_collab_notify.sql 은 운영에 일부만 들어갔다. 앱이 부르는 두 함수가 운영에 없다:
--     · reassign_deal_with_activity — 업무 상세에서 담당자 바꾸기 (supabaseCrmSource.reassignDealWithActivity)
--     · edit_deal_comment_atomic    — 업무 댓글 고치기 (lib/deal/comments.ts)
--   그래서 두 동작은 운영에서 늘 실패한다.
--
--   edit_deal_comment_atomic 은 064 본문 그대로 다시 만든다.
--
--   reassign_deal_with_activity 는 064 와 같은 이름·인자·반환으로 만들되, 이 업무에 보드 행이 있으면
--   담당 계보 경로(reassign_deal_with_lineage, 134)로 바꾼다. 064 원본은 deals 만 바꿔서 보드 행의
--   담당·담당 칸·계보 기록이 옛 사람으로 남았다(화면마다 담당자가 다름). 계보 경로가 알림도 보내므로
--   064 의 배정 알림 트리거(trg_notify_deal_assigned)는 되살리지 않는다 — 되살리면 알림이 두 번 간다.
--   보드 행이 없는 업무는 064 와 같이 deals 만 바꾼다. 어느 쪽이든 업무 타임라인에 활동 한 줄을 남긴다.

create or replace function public.reassign_deal_with_activity(
  p_org_id uuid,
  p_deal_id uuid,
  p_assigned_to uuid
) returns public.deals
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_deal public.deals%rowtype;
  v_item_id uuid;
  v_board_id uuid;
  v_version bigint;
  v_from uuid;
  v_from_name text;
  v_to_name text;
begin
  if not exists (
    select 1 from public.org_members m
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and (m.role::text in ('owner', 'admin') or m.scope::text = 'all')
  ) then
    raise exception 'deal reassignment is not allowed' using errcode = '42501';
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.org_members m
     where m.org_id = p_org_id and m.user_id = p_assigned_to and m.status = 'active'
  ) then
    raise exception 'assignee is not an active member of this organization' using errcode = '42501';
  end if;

  select * into v_deal
    from public.deals
   where id = p_deal_id and org_id = p_org_id;
  if not found then
    return null;
  end if;
  v_from := v_deal.assigned_to;
  if v_from is not distinct from p_assigned_to then
    return v_deal;
  end if;

  select i.id, i.board_id into v_item_id, v_board_id
    from public.items i
   where i.org_id = p_org_id and i.deal_id = p_deal_id and i.deleted_at is null;

  if v_item_id is not null then
    select s.version into v_version
      from public.assignment_lineage_state s
     where s.org_id = p_org_id and s.deal_id = p_deal_id;
    perform public.reassign_deal_with_lineage(
      p_org_id, v_board_id, p_deal_id, v_item_id,
      p_assigned_to, v_from, coalesce(v_version, 0), gen_random_uuid()
    );
    select * into v_deal from public.deals where id = p_deal_id and org_id = p_org_id;
  else
    update public.deals
       set assigned_to = p_assigned_to,
           updated_at = now()
     where id = p_deal_id and org_id = p_org_id
     returning * into v_deal;
  end if;

  select name into v_from_name from public.users where id = v_from;
  select name into v_to_name from public.users where id = p_assigned_to;
  insert into public.activities (org_id, deal_id, type, content, actor)
  values (
    p_org_id,
    p_deal_id,
    'assignment',
    '담당자: ' || coalesce(v_from_name, '미배정') || ' → ' || coalesce(v_to_name, '미배정'),
    auth.uid()
  );

  return v_deal;
end $$;

revoke all on function public.reassign_deal_with_activity(uuid, uuid, uuid) from public, anon;
grant execute on function public.reassign_deal_with_activity(uuid, uuid, uuid) to authenticated;

create or replace function public.edit_deal_comment_atomic(
  p_org_id uuid,
  p_deal_id uuid,
  p_comment_id text,
  p_body text,
  p_expected_version integer
) returns boolean
  language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_updated integer;
  v_now text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_body is null or length(btrim(p_body)) = 0 or length(btrim(p_body)) > 4000 then
    raise exception 'invalid comment body' using errcode = '22023';
  end if;
  if p_expected_version < 1 then
    raise exception 'invalid comment version' using errcode = '22023';
  end if;

  update public.deals d
     set custom = jsonb_set(
       coalesce(d.custom, '{}'::jsonb),
       '{comments}',
       (
         select coalesce(jsonb_agg(
           case when c->>'id' = p_comment_id then
             jsonb_set(
               jsonb_set(
                 jsonb_set(
                   jsonb_set(c, '{body}', to_jsonb(btrim(p_body)), true),
                   '{edited_at}', to_jsonb(v_now), true
                 ),
                 '{edit_history}',
                 coalesce(c->'edit_history', '[]'::jsonb) || jsonb_build_array(
                   jsonb_build_object(
                     'body', c->>'body',
                     'at', coalesce(c->>'edited_at', c->>'created_at')
                   )
                 ),
                 true
               ),
               '{version}', to_jsonb(p_expected_version + 1), true
             )
           else c end
         ), '[]'::jsonb)
         from jsonb_array_elements(coalesce(d.custom->'comments', '[]'::jsonb)) c
       ),
       true
     ),
     updated_at = now()
   where d.id = p_deal_id
     and d.org_id = p_org_id
     and exists (
       select 1
         from jsonb_array_elements(coalesce(d.custom->'comments', '[]'::jsonb)) c
        where c->>'id' = p_comment_id
          and case
            when c->>'version' ~ '^[0-9]+$' then (c->>'version')::integer
            else 1
          end = p_expected_version
          and c->>'author_id' = auth.uid()::text
     );

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.edit_deal_comment_atomic(uuid, uuid, text, text, integer) from public, anon;
grant execute on function public.edit_deal_comment_atomic(uuid, uuid, text, text, integer) to authenticated;

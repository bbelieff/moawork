-- moa-migration-guard: logical_key=113_bbe232_notification_replay_dedupe predecessor=112_bbe195_persistent_group_column_layout digest=dfa9336b7a6a40fc05246919e24b41f32b523d4a2b67248dc5b07b5911953fc9 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '113_bbe232_notification_replay_dedupe',
  p_file_name => '113_bbe232_notification_replay_dedupe.sql',
  p_file_digest => 'dfa9336b7a6a40fc05246919e24b41f32b523d4a2b67248dc5b07b5911953fc9',
  p_expected_predecessor => '112_bbe195_persistent_group_column_layout',
  p_executor => 'DG-06',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_recipient_dedupe_idx
  on public.notifications(org_id, user_id, dedupe_key)
  where dedupe_key is not null;

drop function if exists public.mention_org_members(uuid, uuid, uuid[]);
create function public.mention_org_members(
  p_org_id uuid,
  p_deal_id uuid,
  p_user_ids uuid[],
  p_event_key text
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_target uuid;
begin
  if auth.uid() is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'authenticated notification event required' using errcode = '42501';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not exists (select 1 from public.deals d where d.id=p_deal_id and d.org_id=p_org_id) then
    raise exception 'deal not found in organization' using errcode = '42501';
  end if;

  foreach v_target in array coalesce(p_user_ids, array[]::uuid[]) loop
    if v_target = auth.uid() or not exists (
      select 1 from public.org_members m
       where m.org_id=p_org_id and m.user_id=v_target
    ) then continue; end if;

    insert into public.notifications(
      org_id,user_id,type,title,body,target_type,target_id,actor_id,is_action,dedupe_key
    ) values (
      p_org_id,v_target,'mention','댓글에서 언급되었습니다',null,
      'deal',p_deal_id,auth.uid(),true,'deal-mention:' || p_event_key
    ) on conflict (org_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  end loop;
end $$;

revoke all on function public.mention_org_members(uuid,uuid,uuid[],text)
  from public, anon, authenticated, service_role;
grant execute on function public.mention_org_members(uuid,uuid,uuid[],text) to authenticated;

drop function if exists public.request_deal_followup(uuid, uuid);
create function public.request_deal_followup(
  p_org_id uuid,
  p_deal_id uuid,
  p_event_key text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_assignee uuid; v_inserted integer;
begin
  if auth.uid() is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'authenticated notification event required' using errcode = '42501';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  select assigned_to into v_assignee from public.deals
   where id=p_deal_id and org_id=p_org_id;
  if not found then raise exception 'deal not found in organization' using errcode = '42501'; end if;
  if v_assignee is null then return 'no_assignee'; end if;
  if v_assignee = auth.uid() then return 'self_assigned'; end if;
  if not exists (
    select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=v_assignee
  ) then return 'invalid_assignee'; end if;

  insert into public.notifications(
    org_id,user_id,type,title,body,target_type,target_id,actor_id,is_action,dedupe_key
  ) values (
    p_org_id,v_assignee,'requested','보완 요청이 도착했습니다',
    '담당 딜에 보완이 필요합니다. 댓글에서 사유를 확인하세요.',
    'deal',p_deal_id,auth.uid(),true,'deal-followup:' || p_event_key
  ) on conflict (org_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_inserted = row_count;
  return case when v_inserted=1 then 'sent' else 'duplicate' end;
end $$;

revoke all on function public.request_deal_followup(uuid,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_deal_followup(uuid,uuid,text) to authenticated;

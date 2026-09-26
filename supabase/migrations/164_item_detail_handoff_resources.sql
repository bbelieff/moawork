-- moa-migration-guard: logical_key=164_item_detail_handoff_resources predecessor=163_parent_unlink_record digest=999452703954bfeb7cd9922fc6b3f4a23f0852c3fe0fd5468ccbee9d2e306462 foundation=false
select public.begin_guarded_migration(
 p_logical_key => '164_item_detail_handoff_resources', p_file_name => '164_item_detail_handoff_resources.sql',
 p_file_digest => '999452703954bfeb7cd9922fc6b3f4a23f0852c3fe0fd5468ccbee9d2e306462', p_expected_predecessor => '163_parent_unlink_record',
 p_executor => 'Codex', p_thread_id => 'v17-detail-resource-move', p_foundation => false
);

-- Keep resource creation and the trusted item move in one lock order: item first.
-- The existing RPC bodies, payload checks, limits, receipts and ACL stay intact.
create function public.lock_item_detail_resource_target(p_org_id uuid,p_board_id uuid,p_item_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.items i join public.org_members m on m.org_id=i.org_id
 join public.orgs o on o.id=i.org_id
 where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id
   and i.deleted_at is null and i.archived_at is null and o.status='active'
   and m.user_id=auth.uid() and m.status='active'
   and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
   and public.effective_permission(p_org_id,'work.item_upsert')
 for update of i;
 if not found then raise exception 'permission_denied' using errcode='42501'; end if;
end $$;
revoke all on function public.lock_item_detail_resource_target(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.add_board_item_detail_event(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_kind text, p_body text, p_request_id uuid,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
) returns public.board_item_detail_events
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_events; v_row public.board_item_detail_events; v_assigned_to uuid; v_mentions uuid[];
begin
  perform public.lock_item_detail_resource_target(p_org_id,p_board_id,p_item_id);
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

create or replace function public.add_board_item_detail_link(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_label text,p_url text,p_request_id uuid
) returns public.board_item_detail_links language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_links; v_row public.board_item_detail_links;
begin
  perform public.lock_item_detail_resource_target(p_org_id,p_board_id,p_item_id);
  if v_actor is null or not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if length(btrim(coalesce(p_label,''))) not between 1 and 100 or length(coalesce(p_url,''))>2048 or coalesce(p_url,'')!~'^https://' then raise exception 'invalid_detail_link' using errcode='22023'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id join public.org_members m on m.org_id=i.org_id and m.user_id=v_actor and m.status='active' where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=v_actor)) then raise exception 'permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_item_id::text||':detail-link',0));
  select * into v_existing from public.board_item_detail_links where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_existing.board_id<>p_board_id or v_existing.item_id<>p_item_id or v_existing.created_by<>v_actor or v_existing.label<>btrim(p_label) or v_existing.url<>p_url then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return v_existing;
  end if;
  if (select count(*) from public.board_item_detail_links where org_id=p_org_id and board_id=p_board_id and item_id=p_item_id)>=20 then raise exception 'detail_link_limit' using errcode='22023'; end if;
  insert into public.board_item_detail_links(org_id,board_id,item_id,created_by,label,url,request_id)
    values(p_org_id,p_board_id,p_item_id,v_actor,btrim(p_label),p_url,p_request_id) returning * into v_row;
  return v_row;
end $$;

create or replace function public.reserve_board_item_detail_file(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_file_id uuid,p_name text,p_mime_type text,p_size_bytes bigint,p_storage_path text,p_request_id uuid
) returns table(file_id uuid,storage_path text,state text,replayed boolean) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_file_reservations; v_prefix text; v_count integer; v_total bigint;
begin
  perform public.lock_item_detail_resource_target(p_org_id,p_board_id,p_item_id);
  if v_actor is null or not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_request_id is null or p_file_id is null or length(btrim(coalesce(p_name,''))) not between 1 and 240 or p_size_bytes not between 1 and 10485760 then raise exception 'invalid_detail_file' using errcode='22023'; end if;
  v_prefix:=p_org_id::text||'/'||p_board_id::text||'/'||p_item_id::text||'/'||p_file_id::text||'__';
  if left(p_storage_path,length(v_prefix))<>v_prefix then raise exception 'invalid_storage_path' using errcode='22023'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id join public.org_members m on m.org_id=i.org_id and m.user_id=v_actor and m.status='active' where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=v_actor)) then raise exception 'permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_item_id::text||':detail-file',0));
  update public.board_item_detail_file_reservations r set state='cancelled' where r.state='pending' and r.expires_at<=now();
  select * into v_existing from public.board_item_detail_file_reservations where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_existing.board_id<>p_board_id or v_existing.item_id<>p_item_id or v_existing.file_id<>p_file_id or v_existing.actor_id<>v_actor or v_existing.name<>btrim(p_name) or v_existing.mime_type<>p_mime_type or v_existing.size_bytes<>p_size_bytes or v_existing.storage_path<>p_storage_path then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    if v_existing.state='cancelled' then raise exception 'reservation_cancelled' using errcode='22023'; end if;
    return query select v_existing.file_id,v_existing.storage_path,v_existing.state,true; return;
  end if;
  select count(*)::integer,coalesce(sum(size_bytes),0) into v_count,v_total from (
    select size_bytes from public.board_item_detail_files where org_id=p_org_id and board_id=p_board_id and item_id=p_item_id
    union all
    select r.size_bytes from public.board_item_detail_file_reservations r where r.org_id=p_org_id and r.board_id=p_board_id and r.item_id=p_item_id and r.state='pending' and r.expires_at>now()
  ) reserved;
  if v_count>=5 or v_total+p_size_bytes>31457280 then raise exception 'detail_file_limit' using errcode='22023'; end if;
  insert into public.board_item_detail_file_reservations(org_id,request_id,board_id,item_id,file_id,actor_id,name,mime_type,size_bytes,storage_path,state,expires_at)
    values(p_org_id,p_request_id,p_board_id,p_item_id,p_file_id,v_actor,btrim(p_name),p_mime_type,p_size_bytes,p_storage_path,'pending',now()+interval '15 minutes');
  return query select p_file_id,p_storage_path,'pending'::text,false;
end $$;

create or replace function public.register_board_item_detail_file(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_file_id uuid,p_name text,p_mime_type text,p_size_bytes bigint,p_storage_path text,p_request_id uuid
) returns public.board_item_detail_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_files; v_reservation public.board_item_detail_file_reservations; v_row public.board_item_detail_files; v_prefix text;
begin
  perform public.lock_item_detail_resource_target(p_org_id,p_board_id,p_item_id);
  if v_actor is null or not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 240 or p_size_bytes not between 1 and 10485760 then raise exception 'invalid_detail_file' using errcode='22023'; end if;
  v_prefix:=p_org_id::text||'/'||p_board_id::text||'/'||p_item_id::text||'/'||p_file_id::text||'__';
  if left(p_storage_path,length(v_prefix))<>v_prefix then raise exception 'invalid_storage_path' using errcode='22023'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id join public.org_members m on m.org_id=i.org_id and m.user_id=v_actor and m.status='active' where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=v_actor)) then raise exception 'permission_denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_item_id::text||':detail-file',0));
  select * into v_existing from public.board_item_detail_files where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_existing.id<>p_file_id or v_existing.board_id<>p_board_id or v_existing.item_id<>p_item_id or v_existing.uploaded_by<>v_actor or v_existing.name<>btrim(p_name) or v_existing.mime_type<>p_mime_type or v_existing.size_bytes<>p_size_bytes or v_existing.storage_path<>p_storage_path then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return v_existing;
  end if;
  select * into v_reservation from public.board_item_detail_file_reservations
    where org_id=p_org_id and request_id=p_request_id for update;
  if not found or v_reservation.state<>'pending' or v_reservation.expires_at<=now()
     or v_reservation.actor_id<>v_actor or v_reservation.board_id<>p_board_id
     or v_reservation.item_id<>p_item_id or v_reservation.file_id<>p_file_id
     or v_reservation.name<>btrim(p_name) or v_reservation.mime_type<>p_mime_type
     or v_reservation.size_bytes<>p_size_bytes or v_reservation.storage_path<>p_storage_path then
    raise exception 'file_reservation_required' using errcode='22023';
  end if;
  insert into public.board_item_detail_files(id,org_id,board_id,item_id,uploaded_by,name,mime_type,size_bytes,storage_path,request_id)
    values(p_file_id,p_org_id,p_board_id,p_item_id,v_actor,btrim(p_name),p_mime_type,p_size_bytes,p_storage_path,p_request_id) returning * into v_row;
  update public.board_item_detail_file_reservations set state='finalized'
    where org_id=p_org_id and request_id=p_request_id;
  return v_row;
end $$;

-- AFTER the writer-owned position change, rebind only the two approved forward
-- paths. No data backfill, arbitrary-tab move, reverse move or blob rename.
create function public.rebind_item_detail_handoff_resources()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_source text; v_target text;
begin
 if new.board_id is not distinct from old.board_id then return new; end if;
 select source into v_source from public.boards where id=old.board_id and org_id=old.org_id;
 select source into v_target from public.boards where id=new.board_id and org_id=new.org_id;
 if not coalesce((v_source='core.default-tab/new-lead' and v_target='core.default-tab/contact')
   or (v_source='core.default-tab/contact' and v_target='core.default-tab/contract-work'),false) then return new; end if;
 if new.org_id is distinct from old.org_id or new.id is distinct from old.id
   or new.deal_id is distinct from old.deal_id or new.deleted_at is not null or new.archived_at is not null then
   raise exception 'detail handoff identity mismatch' using errcode='22023'; end if;
 if exists(select 1 from public.board_item_detail_file_reservations r
   where r.org_id=new.org_id and r.item_id=new.id and r.state='pending' and r.expires_at>now()) then
   raise exception '첨부 파일 업로드가 끝난 뒤 다시 인계해 주세요.' using errcode='55000'; end if;
 update public.board_item_detail_events set board_id=new.board_id
   where org_id=new.org_id and item_id=new.id and board_id=old.board_id;
 update public.board_item_detail_links set board_id=new.board_id
   where org_id=new.org_id and item_id=new.id and board_id=old.board_id;
 update public.board_item_detail_files set board_id=new.board_id
   where org_id=new.org_id and item_id=new.id and board_id=old.board_id;
 -- Finalized/cancelled reservations and edit/revision receipts retain their
 -- original request identity; only the current resource locator above moves.
 return new;
end $$;
revoke all on function public.rebind_item_detail_handoff_resources() from public,anon,authenticated,service_role;
create trigger item_detail_handoff_resources after update of board_id on public.items
 for each row execute function public.rebind_item_detail_handoff_resources();

-- A registered object's immutable storage_path is the physical key. Its old
-- board segment is not the current authorization target. Require the exact
-- metadata row + current canonical item and current read scope instead.
-- Existing SELECT and all INSERT/UPDATE/DELETE policies are unchanged.
create policy board_item_files_moved_detail_select on storage.objects
for select to authenticated using (
 bucket_id='board-item-files' and exists(
   select 1 from public.board_item_detail_files f
   join public.items i on i.id=f.item_id and i.org_id=f.org_id and i.board_id=f.board_id
   join public.boards b on b.id=i.board_id and b.org_id=i.org_id
   join public.orgs o on o.id=i.org_id and o.status='active'
   join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
   where f.storage_path=storage.objects.name
     and split_part(storage.objects.name,'/',1)=i.org_id::text
     and split_part(storage.objects.name,'/',3)=i.id::text
     and split_part(storage.objects.name,'/',2)<>i.board_id::text
     and b.source in ('core.default-tab/contact','core.default-tab/contract-work')
     and i.deleted_at is null and i.archived_at is null
     and public.effective_permission(i.org_id,'work.view_tabs')
     and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
 )
);

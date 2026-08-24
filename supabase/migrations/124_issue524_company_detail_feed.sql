-- moa-migration-guard: logical_key=124_issue524_company_detail_feed predecessor=123_bbe182_new_lead_address_projection_validation digest=721997267eef5765fd6564a2e857452eab8e468fa32098e9b5180dbdc029398c foundation=false

select public.begin_guarded_migration(
  p_logical_key => '124_issue524_company_detail_feed',
  p_file_name => '124_issue524_company_detail_feed.sql',
  p_file_digest => '721997267eef5765fd6564a2e857452eab8e468fa32098e9b5180dbdc029398c',
  p_expected_predecessor => '123_bbe182_new_lead_address_projection_validation',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

create table if not exists public.board_item_detail_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  board_id uuid not null references public.boards(id),
  item_id uuid not null references public.items(id),
  actor_id uuid references public.users(id),
  kind text not null check (kind in ('memo','call','field_change')),
  body text not null check (length(btrim(body)) between 1 and 4000),
  metadata jsonb not null default '{}'::jsonb,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (org_id, request_id)
);
create index if not exists board_item_detail_events_feed_idx
  on public.board_item_detail_events(org_id, board_id, item_id, created_at desc, id desc);

create table if not exists public.board_item_detail_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  board_id uuid not null references public.boards(id),
  item_id uuid not null references public.items(id),
  created_by uuid references public.users(id),
  label text not null check (length(btrim(label)) between 1 and 200),
  url text not null check (url ~ '^https://'),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (org_id, request_id)
);
create table if not exists public.board_item_detail_files (
  id uuid primary key,
  org_id uuid not null references public.orgs(id),
  board_id uuid not null references public.boards(id),
  item_id uuid not null references public.items(id),
  uploaded_by uuid references public.users(id),
  name text not null check (length(btrim(name)) between 1 and 240),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (org_id, request_id)
);
create index if not exists board_item_detail_links_item_idx
  on public.board_item_detail_links(org_id, board_id, item_id, created_at desc);

alter table public.board_item_detail_events enable row level security;
alter table public.board_item_detail_events force row level security;
alter table public.board_item_detail_links enable row level security;
alter table public.board_item_detail_links force row level security;
alter table public.board_item_detail_files enable row level security;
alter table public.board_item_detail_files force row level security;

create policy board_item_detail_events_read on public.board_item_detail_events for select to authenticated using (
  exists (
    select 1 from public.items i join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
    where i.id=board_item_detail_events.item_id and i.board_id=board_item_detail_events.board_id and i.org_id=board_item_detail_events.org_id and i.deleted_at is null
      and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
  )
);
create policy board_item_detail_links_read on public.board_item_detail_links for select to authenticated using (
  exists (
    select 1 from public.items i join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
    where i.id=board_item_detail_links.item_id and i.board_id=board_item_detail_links.board_id and i.org_id=board_item_detail_links.org_id and i.deleted_at is null
      and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
  )
);
create policy board_item_detail_files_read on public.board_item_detail_files for select to authenticated using (
  exists (
    select 1 from public.items i join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
    where i.id=board_item_detail_files.item_id and i.board_id=board_item_detail_files.board_id and i.org_id=board_item_detail_files.org_id and i.deleted_at is null
      and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
  )
);

-- The shared board-item bucket previously stopped at the organization folder.
-- Bind all three path segments to a live item and apply the same assigned scope
-- used by the metadata tables. Mutations additionally require item-upsert.
drop policy if exists board_item_files_select on storage.objects;
create policy board_item_files_select on storage.objects for select to authenticated using (
  bucket_id='board-item-files' and
  case when coalesce((storage.foldername(name))[1],'') ~ '^[0-9a-fA-F-]{36}$'
         and coalesce((storage.foldername(name))[2],'') ~ '^[0-9a-fA-F-]{36}$'
         and coalesce((storage.foldername(name))[3],'') ~ '^[0-9a-fA-F-]{36}$'
    then exists(
      select 1 from public.items i
      join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
      where i.org_id=(storage.foldername(name))[1]::uuid
        and i.board_id=(storage.foldername(name))[2]::uuid
        and i.id=(storage.foldername(name))[3]::uuid
        and i.deleted_at is null
        and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
    ) else false end
);
drop policy if exists board_item_files_insert on storage.objects;
create policy board_item_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='board-item-files' and
  case when coalesce((storage.foldername(name))[1],'') ~ '^[0-9a-fA-F-]{36}$'
         and coalesce((storage.foldername(name))[2],'') ~ '^[0-9a-fA-F-]{36}$'
         and coalesce((storage.foldername(name))[3],'') ~ '^[0-9a-fA-F-]{36}$'
    then public.effective_permission((storage.foldername(name))[1]::uuid,'work.item_upsert') and exists(
      select 1 from public.items i
      join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
      where i.org_id=(storage.foldername(name))[1]::uuid
        and i.board_id=(storage.foldername(name))[2]::uuid
        and i.id=(storage.foldername(name))[3]::uuid
        and i.deleted_at is null
        and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
    ) else false end
);
drop policy if exists board_item_files_delete on storage.objects;
create policy board_item_files_delete on storage.objects for delete to authenticated using (
  bucket_id='board-item-files' and
  case when coalesce((storage.foldername(name))[1],'') ~ '^[0-9a-fA-F-]{36}$'
         and coalesce((storage.foldername(name))[2],'') ~ '^[0-9a-fA-F-]{36}$'
         and coalesce((storage.foldername(name))[3],'') ~ '^[0-9a-fA-F-]{36}$'
    then public.effective_permission((storage.foldername(name))[1]::uuid,'work.item_upsert') and exists(
      select 1 from public.items i
      join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
      where i.org_id=(storage.foldername(name))[1]::uuid
        and i.board_id=(storage.foldername(name))[2]::uuid
        and i.id=(storage.foldername(name))[3]::uuid
        and i.deleted_at is null
        and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
    ) else false end
);

create or replace function public.record_board_item_field_change() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_item public.items; v_request_id uuid:=gen_random_uuid();
begin
  if tg_op='UPDATE' and old.value_jsonb is not distinct from new.value_jsonb then return new; end if;
  select * into v_item from public.items where id=new.item_id and org_id=new.org_id and deleted_at is null;
  if not found then return new; end if;
  insert into public.board_item_detail_events(org_id,board_id,item_id,actor_id,kind,body,metadata,request_id)
  values(new.org_id,v_item.board_id,new.item_id,auth.uid(),'field_change',new.column_key||' 항목이 변경되었습니다.',jsonb_build_object('column_key',new.column_key,'before',case when tg_op='UPDATE' then old.value_jsonb else null end,'after',new.value_jsonb),v_request_id);
  insert into public.notifications(org_id,user_id,type,title,body,target_type,target_id,actor_id,is_action,dedupe_key)
  select new.org_id,v_item.assigned_to,'board_item_changed','담당 업무 정보가 변경되었습니다','회사 업무의 상세 정보가 변경되었습니다.','board_item',new.item_id,auth.uid(),false,'item-detail-change:'||v_request_id::text
  where v_item.assigned_to is not null and exists(select 1 from public.org_members m where m.org_id=new.org_id and m.user_id=v_item.assigned_to and m.status='active')
  on conflict (org_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  return new;
end $$;
drop trigger if exists board_item_detail_field_change on public.item_values;
create trigger board_item_detail_field_change after insert or update of value_jsonb on public.item_values for each row execute function public.record_board_item_field_change();

revoke all on public.board_item_detail_events, public.board_item_detail_links, public.board_item_detail_files from public,anon,authenticated,service_role;
grant select on public.board_item_detail_events, public.board_item_detail_links, public.board_item_detail_files to authenticated;

create or replace function public.add_board_item_detail_event(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_kind text, p_body text, p_request_id uuid,
  p_mentioned_user_ids uuid[] default '{}'::uuid[]
) returns public.board_item_detail_events
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_events; v_row public.board_item_detail_events; v_assigned_to uuid; v_mentions uuid[];
begin
  if v_actor is null then raise exception 'permission_denied' using errcode='42501'; end if;
  if not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if p_kind not in ('memo','call') or length(btrim(coalesce(p_body,''))) not between 1 and 4000 then raise exception 'invalid_detail_event' using errcode='22023'; end if;
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
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_label text, p_url text, p_request_id uuid
) returns public.board_item_detail_links
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_links; v_row public.board_item_detail_links;
begin
  if v_actor is null then raise exception 'permission_denied' using errcode='42501'; end if;
  if not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if length(btrim(coalesce(p_label,''))) not between 1 and 200 or coalesce(p_url,'') !~ '^https://' then raise exception 'invalid_detail_link' using errcode='22023'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id join public.org_members m on m.org_id=i.org_id and m.user_id=v_actor and m.status='active' where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=v_actor)) then raise exception 'permission_denied' using errcode='42501'; end if;
  select * into v_existing from public.board_item_detail_links where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_existing.item_id<>p_item_id or v_existing.label<>btrim(p_label) or v_existing.url<>p_url then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return v_existing;
  end if;
  insert into public.board_item_detail_links(org_id,board_id,item_id,created_by,label,url,request_id)
  values(p_org_id,p_board_id,p_item_id,v_actor,btrim(p_label),p_url,p_request_id) returning * into v_row;
  return v_row;
end $$;

create or replace function public.register_board_item_detail_file(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_file_id uuid, p_name text, p_mime_type text, p_size_bytes bigint, p_storage_path text, p_request_id uuid
) returns public.board_item_detail_files
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_files; v_row public.board_item_detail_files; v_prefix text;
begin
  if v_actor is null then raise exception 'permission_denied' using errcode='42501'; end if;
  if not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'permission_denied' using errcode='42501'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 240 or p_size_bytes not between 1 and 10485760 then raise exception 'invalid_detail_file' using errcode='22023'; end if;
  v_prefix:=p_org_id::text||'/'||p_board_id::text||'/'||p_item_id::text||'/'||p_file_id::text||'__';
  if left(p_storage_path,length(v_prefix))<>v_prefix then raise exception 'invalid_storage_path' using errcode='22023'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id join public.org_members m on m.org_id=i.org_id and m.user_id=v_actor and m.status='active' where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=v_actor)) then raise exception 'permission_denied' using errcode='42501'; end if;
  select * into v_existing from public.board_item_detail_files where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_existing.item_id<>p_item_id or v_existing.storage_path<>p_storage_path then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return v_existing;
  end if;
  insert into public.board_item_detail_files(id,org_id,board_id,item_id,uploaded_by,name,mime_type,size_bytes,storage_path,request_id)
  values(p_file_id,p_org_id,p_board_id,p_item_id,v_actor,btrim(p_name),p_mime_type,p_size_bytes,p_storage_path,p_request_id) returning * into v_row;
  return v_row;
end $$;

revoke all on function public.add_board_item_detail_event(uuid,uuid,uuid,text,text,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.add_board_item_detail_link(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.add_board_item_detail_event(uuid,uuid,uuid,text,text,uuid,uuid[]) to authenticated;
grant execute on function public.add_board_item_detail_link(uuid,uuid,uuid,text,text,uuid) to authenticated;
revoke all on function public.register_board_item_detail_file(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.register_board_item_detail_file(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) to authenticated;
revoke all on function public.record_board_item_field_change() from public,anon,authenticated,service_role;

do $$ begin
  if exists(select 1 from information_schema.role_table_grants where table_schema='public' and table_name in ('board_item_detail_events','board_item_detail_links','board_item_detail_files') and grantee in ('PUBLIC','anon','service_role')) then raise exception 'unsafe_detail_table_acl'; end if;
end $$;

-- moa-migration-guard: logical_key=128_issue542_new_lead_v6plus predecessor=127_issue544_contract_work_fee_terms digest=3129f6afc82d266b861c49742d52cabc661602ce2fa9f7ada069bc4ded1edb0e foundation=false

select public.begin_guarded_migration(
  p_logical_key => '128_issue542_new_lead_v6plus',
  p_file_name => '128_issue542_new_lead_v6plus.sql',
  p_file_digest => '3129f6afc82d266b861c49742d52cabc661602ce2fa9f7ada069bc4ded1edb0e',
  p_expected_predecessor => '127_issue544_contract_work_fee_terms',
  p_executor => 'DG',
  p_thread_id => '019f7fe6-0310-7713-9ad6-0c76bbceebf3',
  p_foundation => false
);

-- Presentation state only. It never grants a membership, permission or tenant scope.
create table if not exists public.new_lead_onboarding_state (
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  version text not null check (length(version) between 1 and 100),
  state text not null check (state in ('completed','dismissed')),
  updated_at timestamptz not null default now(),
  primary key (org_id,user_id,version)
);
create table if not exists public.new_lead_onboarding_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  version text not null,
  state text not null,
  created_at timestamptz not null default now(),
  primary key (org_id,request_id)
);
alter table public.new_lead_onboarding_state enable row level security;
alter table public.new_lead_onboarding_state force row level security;
alter table public.new_lead_onboarding_requests enable row level security;
alter table public.new_lead_onboarding_requests force row level security;
revoke all on public.new_lead_onboarding_state, public.new_lead_onboarding_requests from public,anon,authenticated,service_role;

create or replace function public.get_new_lead_onboarding_state(p_org_id uuid,p_version text)
returns table(state text) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();
begin
  if length(btrim(coalesce(p_version,''))) not between 1 and 100 then
    raise exception 'invalid_onboarding_version' using errcode='22023';
  end if;
  if v_actor is null
     or not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id and o.status='active' where m.org_id=p_org_id and m.user_id=v_actor and m.status='active')
     or not public.effective_permission(p_org_id,'work.view_tabs') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  return query select s.state from public.new_lead_onboarding_state s
    where s.org_id=p_org_id and s.user_id=v_actor and s.version=btrim(p_version);
end $$;

create or replace function public.set_new_lead_onboarding_state(p_org_id uuid,p_version text,p_state text,p_request_id uuid)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_prior public.new_lead_onboarding_requests;
begin
  if p_request_id is null or p_state not in ('completed','dismissed')
     or length(btrim(coalesce(p_version,''))) not between 1 and 100 then
    raise exception 'invalid_onboarding_state' using errcode='22023';
  end if;
  if v_actor is null
     or not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id and o.status='active' where m.org_id=p_org_id and m.user_id=v_actor and m.status='active')
     or not public.effective_permission(p_org_id,'work.view_tabs') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||v_actor::text||':'||p_version,0));
  select * into v_prior from public.new_lead_onboarding_requests where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_prior.user_id<>v_actor or v_prior.version<>btrim(p_version) or v_prior.state<>p_state then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return v_prior.state;
  end if;
  insert into public.new_lead_onboarding_state(org_id,user_id,version,state,updated_at)
    values(p_org_id,v_actor,btrim(p_version),p_state,now())
    on conflict (org_id,user_id,version) do update set state=excluded.state,updated_at=excluded.updated_at;
  insert into public.new_lead_onboarding_requests(org_id,request_id,user_id,version,state)
    values(p_org_id,p_request_id,v_actor,btrim(p_version),p_state);
  return p_state;
end $$;

create table if not exists public.board_create_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id),
  payload jsonb not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id,request_id)
);
alter table public.board_create_requests enable row level security;
alter table public.board_create_requests force row level security;
revoke all on public.board_create_requests from public,anon,authenticated,service_role;

drop policy if exists boards_rw on public.boards;
drop policy if exists boards_read on public.boards;
drop policy if exists boards_insert on public.boards;
drop policy if exists boards_update on public.boards;
drop policy if exists boards_delete on public.boards;
create policy boards_read on public.boards for select to authenticated using (public.is_org_member(org_id));
create policy boards_update on public.boards for update to authenticated using (public.effective_permission(org_id,'structure.tab_manage')) with check (public.effective_permission(org_id,'structure.tab_manage'));
create policy boards_delete on public.boards for delete to authenticated using (public.effective_permission(org_id,'danger.bulk_edit_delete'));
revoke insert,update on public.boards from authenticated;
grant update(name,description,icon,source,detail_layout_jsonb,updated_at) on public.boards to authenticated;

create or replace function public.create_workspace_board(p_org_id uuid,p_name text,p_description text,p_icon text,p_source text,p_request_id uuid)
returns public.boards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_payload jsonb; v_prior public.board_create_requests; v_board public.boards; v_sort integer;
begin
  if v_actor is null or p_request_id is null or length(btrim(coalesce(p_name,''))) not between 1 and 100
     or not public.effective_permission(p_org_id,'structure.tab_manage') then raise exception 'permission_denied' using errcode='42501'; end if;
  v_payload:=jsonb_build_object('name',btrim(p_name),'description',nullif(btrim(coalesce(p_description,'')),''),'icon',nullif(btrim(coalesce(p_icon,'')),''),'source',nullif(btrim(coalesce(p_source,'')),''));
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':board-create',0));
  select * into v_prior from public.board_create_requests where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.payload<>v_payload then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    select * into v_board from public.boards where org_id=p_org_id and id=v_prior.board_id;
    if not found then raise exception 'board_unavailable' using errcode='42501'; end if;
    return v_board;
  end if;
  select coalesce(max(sort_order)+1,0) into v_sort from public.boards where org_id=p_org_id;
  insert into public.boards(org_id,name,description,icon,is_system,source,sort_order,created_by)
    values(p_org_id,btrim(p_name),v_payload->>'description',v_payload->>'icon',false,v_payload->>'source',v_sort,v_actor) returning * into v_board;
  if v_payload->>'source' is null then
    insert into public.board_columns(org_id,board_id,key,label,type,source,right_pinned,options_jsonb,sort_order,is_readonly)
    values
      (p_org_id,v_board.id,'status','상태','select','in',false,'{"options":[{"id":"opt-todo","label":"대기","color":"#c4c4c4","order":0},{"id":"opt-doing","label":"진행중","color":"#fdab3d","order":1},{"id":"opt-done","label":"완료","color":"#00c875","order":2}]}'::jsonb,0,false),
      (p_org_id,v_board.id,'owner','담당','person','in',false,null,1,false),
      (p_org_id,v_board.id,'due','마감일','date','in',false,null,2,false);
  end if;
  insert into public.board_create_requests(org_id,request_id,actor_id,payload,board_id)
    values(p_org_id,p_request_id,v_actor,v_payload,v_board.id);
  return v_board;
end $$;

-- A reorder request owns the complete non-system board sequence for one company.
create table if not exists public.board_order_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id),
  board_ids uuid[] not null,
  created_at timestamptz not null default now(),
  primary key (org_id,request_id)
);
alter table public.board_order_requests enable row level security;
alter table public.board_order_requests force row level security;
revoke all on public.board_order_requests from public,anon,authenticated,service_role;

create or replace function public.reorder_workspace_boards(p_org_id uuid,p_board_ids uuid[],p_request_id uuid)
returns setof public.boards language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_expected uuid[]; v_supplied uuid[]; v_prior public.board_order_requests;
begin
  if v_actor is null or p_request_id is null or not public.effective_permission(p_org_id,'structure.tab_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':board-order',0));
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_expected from public.boards
    where org_id=p_org_id and not is_system and coalesce(source,'') not like 'user.section-preset/%';
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into v_supplied from unnest(coalesce(p_board_ids,'{}'::uuid[])) id;
  if cardinality(coalesce(p_board_ids,'{}'::uuid[]))<>cardinality(v_supplied) or v_expected<>v_supplied then
    raise exception 'board_order_invalid' using errcode='22023';
  end if;
  select * into v_prior from public.board_order_requests where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.board_ids<>p_board_ids then raise exception 'request_replay_conflict' using errcode='23505'; end if;
    return query select * from public.boards where org_id=p_org_id and not is_system and coalesce(source,'') not like 'user.section-preset/%' order by sort_order,id;
    return;
  end if;
  update public.boards b set sort_order=ordered.position-1,updated_at=now()
    from unnest(p_board_ids) with ordinality ordered(id,position)
    where b.org_id=p_org_id and b.id=ordered.id and not b.is_system and coalesce(b.source,'') not like 'user.section-preset/%';
  insert into public.board_order_requests(org_id,request_id,actor_id,board_ids) values(p_org_id,p_request_id,v_actor,p_board_ids);
  return query select * from public.boards where org_id=p_org_id and not is_system and coalesce(source,'') not like 'user.section-preset/%' order by sort_order,id;
end $$;

-- Existing rows are preserved. NOT VALID enforces the new contract for every new write.
alter table public.board_item_detail_links drop constraint if exists board_item_detail_links_label_check;
alter table public.board_item_detail_links add constraint board_item_detail_links_label_check
  check (length(btrim(label)) between 1 and 100) not valid;
alter table public.board_item_detail_links drop constraint if exists board_item_detail_links_url_check;
alter table public.board_item_detail_links add constraint board_item_detail_links_url_check
  check (url ~ '^https://' and length(url)<=2048) not valid;

update storage.buckets set file_size_limit=10485760 where id='board-item-files';

create table if not exists public.board_item_detail_file_reservations (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  file_id uuid not null,
  actor_id uuid not null references public.users(id),
  name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_path text not null unique,
  state text not null check(state in ('pending','finalized','cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key(org_id,request_id),
  unique(org_id,file_id)
);
alter table public.board_item_detail_file_reservations enable row level security;
alter table public.board_item_detail_file_reservations force row level security;
revoke all on public.board_item_detail_file_reservations from public,anon,authenticated,service_role;

create or replace function public.reserve_board_item_detail_file(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_file_id uuid,p_name text,p_mime_type text,p_size_bytes bigint,p_storage_path text,p_request_id uuid
) returns table(file_id uuid,storage_path text,state text,replayed boolean) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_file_reservations; v_prefix text; v_count integer; v_total bigint;
begin
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

create or replace function public.cancel_board_item_detail_file(p_org_id uuid,p_request_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'permission_denied' using errcode='42501'; end if;
  update public.board_item_detail_file_reservations set state='cancelled'
    where org_id=p_org_id and request_id=p_request_id and actor_id=auth.uid() and state='pending';
  get diagnostics v_count=row_count;
  return v_count=1;
end $$;

create or replace function public.can_upload_reserved_board_item_file(p_storage_path text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(
    select 1 from public.board_item_detail_file_reservations r
    where r.storage_path=p_storage_path and r.actor_id=auth.uid() and r.state='pending' and r.expires_at>now()
      and public.effective_permission(r.org_id,'work.item_upsert')
  )
$$;

drop policy if exists board_item_files_insert on storage.objects;
create policy board_item_files_insert on storage.objects for insert to authenticated with check (
  bucket_id='board-item-files' and public.can_upload_reserved_board_item_file(storage.objects.name)
);
drop policy if exists board_item_files_update on storage.objects;
create policy board_item_files_update on storage.objects for update to authenticated
  using (bucket_id='board-item-files' and public.can_upload_reserved_board_item_file(storage.objects.name))
  with check (bucket_id='board-item-files' and public.can_upload_reserved_board_item_file(storage.objects.name));

create or replace function public.add_board_item_detail_link(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_label text,p_url text,p_request_id uuid
) returns public.board_item_detail_links language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_links; v_row public.board_item_detail_links;
begin
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

create or replace function public.register_board_item_detail_file(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_file_id uuid,p_name text,p_mime_type text,p_size_bytes bigint,p_storage_path text,p_request_id uuid
) returns public.board_item_detail_files language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_existing public.board_item_detail_files; v_reservation public.board_item_detail_file_reservations; v_row public.board_item_detail_files; v_prefix text;
begin
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

revoke all on function public.get_new_lead_onboarding_state(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.set_new_lead_onboarding_state(uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.create_workspace_board(uuid,text,text,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.reorder_workspace_boards(uuid,uuid[],uuid) from public,anon,authenticated,service_role;
revoke all on function public.add_board_item_detail_link(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.reserve_board_item_detail_file(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.cancel_board_item_detail_file(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.can_upload_reserved_board_item_file(text) from public,anon,authenticated,service_role;
revoke all on function public.register_board_item_detail_file(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_new_lead_onboarding_state(uuid,text) to authenticated;
grant execute on function public.set_new_lead_onboarding_state(uuid,text,text,uuid) to authenticated;
grant execute on function public.create_workspace_board(uuid,text,text,text,text,uuid) to authenticated;
grant execute on function public.reorder_workspace_boards(uuid,uuid[],uuid) to authenticated;
grant execute on function public.add_board_item_detail_link(uuid,uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.reserve_board_item_detail_file(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) to authenticated;
grant execute on function public.cancel_board_item_detail_file(uuid,uuid) to authenticated;
grant execute on function public.can_upload_reserved_board_item_file(text) to authenticated;
grant execute on function public.register_board_item_detail_file(uuid,uuid,uuid,uuid,text,text,bigint,text,uuid) to authenticated;

do $$ begin
  if exists(select 1 from information_schema.role_routine_grants where routine_schema='public' and routine_name in ('get_new_lead_onboarding_state','set_new_lead_onboarding_state','create_workspace_board','reorder_workspace_boards','add_board_item_detail_link','reserve_board_item_detail_file','cancel_board_item_detail_file','can_upload_reserved_board_item_file','register_board_item_detail_file') and grantee in ('PUBLIC','anon','service_role')) then raise exception 'unsafe_issue542_rpc_acl'; end if;
end $$;

-- BBE-27: verified, one-time 001 CRM -> 003 new-customer board cutover.
create extension if not exists pgcrypto;

create or replace function public.newcust_sha256(p_value text) returns text language plpgsql security definer set search_path='' as $$
declare out_value text;
begin
  if pg_catalog.to_regprocedure('public.digest(text,text)') is not null then execute 'select pg_catalog.encode(public.digest($1,''sha256''),''hex'')' into out_value using p_value;
  elsif pg_catalog.to_regprocedure('extensions.digest(text,text)') is not null then execute 'select pg_catalog.encode(extensions.digest($1,''sha256''),''hex'')' into out_value using p_value;
  else raise exception 'NEWCUST_PGCRYPTO_DIGEST_MISSING' using errcode='P0001'; end if;
  return out_value;
end $$;
revoke all on function public.newcust_sha256(text) from public,anon,authenticated;
do $$ begin
  if pg_catalog.to_regprocedure('public.digest(text,text)') is null and pg_catalog.to_regprocedure('extensions.digest(text,text)') is not null then
    execute 'create function public.digest(text,text) returns bytea language sql immutable strict set search_path='''' as ''select extensions.digest($1,$2)''';
    execute 'revoke all on function public.digest(text,text) from public,anon,authenticated';
  end if;
end $$;

alter table boards add constraint boards_id_org_uq unique (id, org_id);
alter table board_groups add constraint board_groups_id_board_org_uq unique (id, board_id, org_id);
alter table board_columns add constraint board_columns_id_board_org_uq unique (id, board_id, org_id);
alter table items add constraint items_id_org_uq unique (id, org_id);
alter table items add constraint items_id_board_org_uq unique (id, board_id, org_id);
create unique index boards_newcust_logical_source_uq on boards(org_id, split_part(source, ':', 1)) where source in ('newcust.monday.v1','newcust.monday.v1:initializing');

create or replace function public.newcust_board_source_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if (old.source is null or old.source not in ('newcust.monday.v1','newcust.monday.v1:initializing')) and new.source in ('newcust.monday.v1','newcust.monday.v1:initializing') then
    raise exception 'NEWCUST_BOARD_SOURCE_CLAIM_FORBIDDEN' using errcode='P0001';
  end if;
  if old.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and (new.org_id is distinct from old.org_id or new.created_by is distinct from old.created_by) then
    raise exception 'NEWCUST_BOARD_OWNERSHIP_IMMUTABLE' using errcode='P0001';
  end if;
  if old.source='newcust.monday.v1' and new.source is distinct from old.source then
    raise exception 'NEWCUST_BOARD_SOURCE_IMMUTABLE' using errcode='P0001';
  end if;
  if old.source='newcust.monday.v1:initializing' and (new.source is null or new.source not in ('newcust.monday.v1:initializing','newcust.monday.v1')) then
    raise exception 'NEWCUST_BOARD_SOURCE_TRANSITION_INVALID' using errcode='P0001';
  end if;
  return new;
end $$;
create trigger boards_newcust_source_guard before update of source,org_id,created_by on boards for each row execute function public.newcust_board_source_guard();

alter table board_groups add constraint board_groups_board_org_fk foreign key (board_id, org_id) references boards(id, org_id) on delete cascade not valid;
alter table board_columns add constraint board_columns_board_org_fk foreign key (board_id, org_id) references boards(id, org_id) on delete cascade not valid;
alter table items add constraint items_board_org_fk foreign key (board_id, org_id) references boards(id, org_id) on delete cascade not valid;
alter table items add constraint items_group_board_org_fk foreign key (group_id, board_id, org_id) references board_groups(id, board_id, org_id) not valid;
alter table items add constraint items_parent_org_fk foreign key (parent_item_id, org_id) references items(id, org_id) on delete cascade not valid;
alter table item_values add constraint item_values_item_org_fk foreign key (item_id, org_id) references items(id, org_id) on delete cascade not valid;
alter table board_views add constraint board_views_board_org_fk foreign key (board_id, org_id) references boards(id, org_id) on delete cascade not valid;
alter table board_groups validate constraint board_groups_board_org_fk;
alter table board_columns validate constraint board_columns_board_org_fk;
alter table items validate constraint items_board_org_fk;
alter table items validate constraint items_group_board_org_fk;
alter table items validate constraint items_parent_org_fk;
alter table item_values validate constraint item_values_item_org_fk;
alter table board_views validate constraint board_views_board_org_fk;

drop policy boards_rw on boards;
create policy boards_select on boards for select using (public.is_org_member(org_id));
create policy boards_insert on boards for insert with check (public.is_org_member(org_id) and (source is null or source not in ('newcust.monday.v1','newcust.monday.v1:initializing') or (public.org_role(org_id) in ('owner','admin') and created_by=auth.uid())));
create policy boards_update on boards for update using (public.is_org_member(org_id) and (source is null or source not in ('newcust.monday.v1','newcust.monday.v1:initializing') or public.org_role(org_id) in ('owner','admin') or created_by=auth.uid())) with check (public.is_org_member(org_id) and (source is null or source not in ('newcust.monday.v1','newcust.monday.v1:initializing') or public.org_role(org_id) in ('owner','admin') or created_by=auth.uid()));
create policy boards_delete on boards for delete using (public.is_org_member(org_id) and (source is null or source not in ('newcust.monday.v1','newcust.monday.v1:initializing') or public.org_role(org_id) in ('owner','admin') or created_by=auth.uid()));
drop policy bgroups_rw on board_groups;
create policy bgroups_select on board_groups for select using (public.is_org_member(org_id));
create policy bgroups_insert on board_groups for insert with check (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing'))));
create policy bgroups_update on board_groups for update using (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing')))) with check (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing'))));
create policy bgroups_delete on board_groups for delete using (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_groups.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing'))));
drop policy bcols_rw on board_columns;
create policy bcols_select on board_columns for select using (public.is_org_member(org_id));
create policy bcols_insert on board_columns for insert with check (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing'))));
create policy bcols_update on board_columns for update using (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing')))) with check (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing'))));
create policy bcols_delete on board_columns for delete using (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') and b.created_by=auth.uid()) or not exists(select 1 from public.boards b where b.id=board_id and b.org_id=board_columns.org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing'))));
drop policy bviews_rw on board_views;
create policy bviews_select on board_views for select using (public.is_org_member(org_id) and (user_id=auth.uid() or shared));
create policy bviews_insert on board_views for insert with check (public.is_org_member(org_id) and user_id=auth.uid());
create policy bviews_update on board_views for update using (public.is_org_member(org_id) and user_id=auth.uid()) with check (public.is_org_member(org_id) and user_id=auth.uid());
create policy bviews_delete on board_views for delete using (public.is_org_member(org_id) and user_id=auth.uid());

drop policy items_rw on items;
create policy items_select on items for select using (
  public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or assigned_to=auth.uid()));
create policy items_insert on items for insert with check (
  public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or assigned_to=auth.uid()));
create policy items_update on items for update using (
  public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or assigned_to=auth.uid()))
  with check (public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or assigned_to=auth.uid()));
create policy items_delete on items for delete using (
  public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or assigned_to=auth.uid()));

drop policy itemvals_rw on item_values;
create policy itemvals_select on item_values for select using (exists (select 1 from items i where i.id=item_id and i.org_id=item_values.org_id));
create policy itemvals_insert on item_values for insert with check (exists (select 1 from items i where i.id=item_id and i.org_id=item_values.org_id));
create policy itemvals_update on item_values for update using (exists (select 1 from items i where i.id=item_id and i.org_id=item_values.org_id)) with check (exists (select 1 from items i where i.id=item_id and i.org_id=item_values.org_id));
create policy itemvals_delete on item_values for delete using (exists (select 1 from items i where i.id=item_id and i.org_id=item_values.org_id));

create table newcust_legacy_batches (
  id uuid primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  board_id uuid not null,
  request_id uuid not null,
  source_checksum text not null,
  source_schema_fingerprint text not null,
  target_schema_fingerprint text not null,
  target_checksum text not null,
  status text not null check(status in ('applied_verified','rolled_back')),
  actor_id uuid not null references users(id),
  source_count int not null,
  insert_count int not null,
  update_count int not null check(update_count=0),
  quarantine_count int not null,
  conflict_count int not null,
  missing_count int not null,
  created_at timestamptz not null default now(),
  unique(org_id, request_id),
  unique(id, org_id),
  foreign key(board_id, org_id) references boards(id, org_id)
);
create table newcust_legacy_cutovers (
  org_id uuid primary key references orgs(id) on delete cascade,
  board_id uuid not null,
  batch_id uuid,
  status text not null check(status in ('pending','applied_verified','rolled_back')) default 'pending',
  updated_at timestamptz not null default now(),
  foreign key(board_id,org_id) references boards(id,org_id),
  foreign key(batch_id,org_id) references newcust_legacy_batches(id,org_id)
);
create table newcust_legacy_item_links (
  item_id uuid primary key,
  org_id uuid not null,
  batch_id uuid not null,
  source_kind text not null default 'crm_deal' check(source_kind='crm_deal'),
  legacy_id uuid not null,
  row_hash text not null,
  target_hash text not null,
  unique(org_id,source_kind,legacy_id),
  foreign key(batch_id,org_id) references newcust_legacy_batches(id,org_id)
);
alter table newcust_legacy_batches enable row level security;
alter table newcust_legacy_cutovers enable row level security;
alter table newcust_legacy_item_links enable row level security;
revoke all on newcust_legacy_batches,newcust_legacy_cutovers,newcust_legacy_item_links from public,anon,authenticated;

create or replace function public.newcust_uuid(p_seed text) returns uuid language sql immutable strict set search_path='' as $$
  select (substr(md5(p_seed),1,8)||'-'||substr(md5(p_seed),9,4)||'-'||substr(md5(p_seed),13,4)||'-'||substr(md5(p_seed),17,4)||'-'||substr(md5(p_seed),21,12))::uuid
$$;
revoke all on function public.newcust_uuid(text) from public,anon,authenticated;

create or replace function public.newcust_assert_admin(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_org_member(p_org) or public.org_role(p_org) not in ('owner','admin') then raise exception 'NEWCUST_FORBIDDEN' using errcode='42501'; end if;
end $$;
revoke all on function public.newcust_assert_admin(uuid) from public,anon,authenticated;

create or replace function public.newcust_is_iso_date(p_value text) returns boolean language plpgsql immutable set search_path='' as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform p_value::date;
  return true;
exception when others then return false;
end $$;
revoke all on function public.newcust_is_iso_date(text) from public,anon,authenticated;

create or replace function public.newcust_legacy_source_rows(p_org uuid)
returns table(legacy_id uuid,row_data jsonb,row_hash text,quarantine_code text) language sql security definer set search_path='' as $$
  with mapped as (
  select d.id as legacy_id,
    jsonb_build_object(
      'title',coalesce(nullif(btrim(d.title),''),nullif(btrim(c.name),'')),'assigned_to',coalesce(d.assigned_to,c.assigned_to),
      'contact_status','new','proposal_status','pending',
      'applied_on',d.applied_on,'ad_name',nullif(btrim(coalesce(d.custom->>'ad_name',d.custom->>'advertisement_name',d.custom->>'campaign_name')),''),
      'business_type',nullif(btrim(c.biz_type),''),'company_name',nullif(btrim(c.name),''),'company_revenue',c.revenue,'contact',nullif(btrim(c.phone),''),
      'owner_name',nullif(btrim(c.owner_name),''),'address',nullif(btrim(coalesce(d.custom->>'address',d.custom->>'company_address',d.custom->>'road_address')),''),
      'expected_revenue',d.amount,'next_contact',coalesce(d.custom->>'next_contact',d.custom->>'next_contact_date',d.custom->>'next_action_date'),
      'priority',d.custom->>'priority','legacy_email',lower(nullif(btrim(c.email),'')),'legacy_note',nullif(btrim(d.status_note),''),'legacy_stage_name',btrim(s.name),
      'files',(select jsonb_agg(jsonb_build_object('path',f->>'storage_path','name',f->>'name','size',case when jsonb_typeof(f->'size_bytes')='number' then (f->>'size_bytes')::numeric else 0 end,'mime',f->>'mime_type') order by f->>'storage_path') from jsonb_array_elements(case when jsonb_typeof(d.custom->'files')='array' then d.custom->'files' else '[]'::jsonb end) f)) as row_data,
    case
      when coalesce(nullif(btrim(d.title),''),nullif(btrim(c.name),'')) is null then 'missing_title'
      when p.id is null then 'invalid_pipeline'
      when coalesce(d.assigned_to,c.assigned_to) is not null and not exists(select 1 from public.org_members m where m.org_id=p_org and m.user_id=coalesce(d.assigned_to,c.assigned_to) and m.status='active') then 'invalid_assignee'
      when d.custom->>'priority' is not null and d.custom->>'priority' not in ('high','medium','low') then 'invalid_priority'
      when d.applied_on is not null and d.applied_on::text !~ '^\d{4}-\d{2}-\d{2}$' then 'invalid_applied_on'
      when coalesce(d.custom->>'next_contact',d.custom->>'next_contact_date',d.custom->>'next_action_date') is not null and not public.newcust_is_iso_date(coalesce(d.custom->>'next_contact',d.custom->>'next_contact_date',d.custom->>'next_action_date')) then 'invalid_next_contact'
      when nullif(btrim(c.email),'') is not null and lower(btrim(c.email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'invalid_email'
      when nullif(btrim(c.phone),'') is not null and (btrim(c.phone) !~ '^[0-9+(). -]+$' or btrim(c.phone) !~ '[0-9]') then 'invalid_phone'
      when exists(select 1 from unnest(array['ad_name','advertisement_name','campaign_name','address','company_address','road_address','next_contact','next_contact_date','next_action_date']) k where d.custom ? k and jsonb_typeof(d.custom->k)<>'string') then 'invalid_alias_type'
      when c.revenue is not null and (c.revenue<0 or c.revenue>9007199254740991) then 'invalid_company_revenue'
      when d.amount is not null and (d.amount<0 or d.amount>9007199254740991) then 'invalid_expected_revenue'
      when (select count(distinct v) from unnest(array[d.custom->>'ad_name',d.custom->>'advertisement_name',d.custom->>'campaign_name']) v where v is not null)>1 then 'conflicting_ad_aliases'
      when (select count(distinct v) from unnest(array[d.custom->>'address',d.custom->>'company_address',d.custom->>'road_address']) v where v is not null)>1 then 'conflicting_address_aliases'
      when (select count(distinct v) from unnest(array[d.custom->>'next_contact',d.custom->>'next_contact_date',d.custom->>'next_action_date']) v where v is not null)>1 then 'conflicting_next_contact_aliases'
      when d.custom ? 'files' and (jsonb_typeof(d.custom->'files')<>'array'
        or (select count(*)<>count(distinct f->>'storage_path') from jsonb_array_elements(case when jsonb_typeof(d.custom->'files')='array' then d.custom->'files' else '[]'::jsonb end) f)
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.custom->'files')='array' then d.custom->'files' else '[]'::jsonb end) f where jsonb_typeof(f)<>'object' or not (f ?& array['storage_path','name','size_bytes','mime_type']) or (f - array['storage_path','name','size_bytes','mime_type','data_url','id','uploaded_by','created_at']) <> '{}'::jsonb or jsonb_typeof(f->'storage_path')<>'string' or jsonb_typeof(f->'name')<>'string' or jsonb_typeof(f->'mime_type')<>'string' or f->>'storage_path' not like p_org::text||'/%' or f->>'storage_path' like '%..%' or case when jsonb_typeof(f->'size_bytes')='number' then (f->>'size_bytes')::numeric<0 or (f->>'size_bytes')::numeric<>trunc((f->>'size_bytes')::numeric) or (f->>'size_bytes')::numeric>9007199254740991 else true end or (not (f ? 'storage_path') and f ? 'data_url'))) then 'invalid_file'
      else null end as quarantine_code
  from public.deals d
  join public.stages s on s.id=d.stage_id and s.kind='marketing'
  left join public.pipelines p on p.id=s.pipeline_id and p.id=d.pipeline_id and p.org_id=d.org_id
  left join public.companies c on c.id=d.company_id and c.org_id=d.org_id
  where d.org_id=p_org)
  select legacy_id,row_data,encode(public.digest(jsonb_build_object('legacy_id',legacy_id,'row',row_data)::text,'sha256'),'hex'),quarantine_code from mapped
$$;
revoke all on function public.newcust_legacy_source_rows(uuid) from public,anon,authenticated;

create or replace function public.newcust_legacy_target_checksum(p_board uuid,p_item_ids uuid[] default null) returns text language sql security definer set search_path='' as $$
  select encode(public.digest(coalesce(jsonb_agg(jsonb_build_object(
    'item',jsonb_build_object('id',i.id,'title',i.title,'assigned_to',i.assigned_to,'group_id',i.group_id,'parent_item_id',i.parent_item_id,'sort_order',i.sort_order),
    'values',coalesce((select jsonb_agg(jsonb_build_object('key',v.column_key,'value',v.value_jsonb) order by v.column_key) from public.item_values v where v.item_id=i.id),'[]'::jsonb)
  ) order by i.id),'[]'::jsonb)::text,'sha256'),'hex') from public.items i where i.board_id=p_board and (p_item_ids is null or i.id=any(p_item_ids))
$$;
revoke all on function public.newcust_legacy_target_checksum(uuid,uuid[]) from public,anon,authenticated;

create or replace function public.newcust_legacy_expected_target_checksum(p_org uuid,p_board uuid,p_group uuid) returns text language sql security definer set search_path='' as $$
  with canonical as (
    select public.newcust_uuid(p_org::text||':deal:'||r.legacy_id) as item_id,jsonb_build_object(
      'item',jsonb_build_object('id',public.newcust_uuid(p_org::text||':deal:'||r.legacy_id),'title',r.row_data->>'title','assigned_to',r.row_data->'assigned_to','group_id',to_jsonb(p_group),'parent_item_id',null,'sort_order',row_number() over(order by r.legacy_id)),
      'values',coalesce((select jsonb_agg(jsonb_build_object('key',e.key,'value',e.value) order by e.key) from jsonb_each(r.row_data-'title'-'assigned_to') e where e.value<>'null'::jsonb),'[]'::jsonb)
    ) as target_row from public.newcust_legacy_source_rows(p_org) r where r.quarantine_code is null)
  select encode(public.digest(coalesce(jsonb_agg(target_row order by item_id),'[]'::jsonb)::text,'sha256'),'hex') from canonical
$$;
revoke all on function public.newcust_legacy_expected_target_checksum(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.newcust_legacy_source_schema_fingerprint() returns text language sql stable security definer set search_path='' as $$
  select encode(public.digest(jsonb_agg(jsonb_build_object('table',c.table_name,'column',c.column_name,'type',c.data_type,'nullable',c.is_nullable) order by c.table_name,c.ordinal_position)::text,'sha256'),'hex') from information_schema.columns c where c.table_schema='public' and c.table_name in ('companies','deals','org_members','pipelines','stages')
$$;
create or replace function public.newcust_legacy_source_schema_ok() returns boolean language sql stable security definer set search_path='' as $$
  with expected(table_name,column_name,data_type) as (values
    ('deals','id','uuid'),('deals','org_id','uuid'),('deals','company_id','uuid'),('deals','pipeline_id','uuid'),('deals','stage_id','uuid'),('deals','assigned_to','uuid'),('deals','title','text'),('deals','amount','numeric'),('deals','status_note','text'),('deals','applied_on','date'),('deals','custom','jsonb'),
    ('companies','id','uuid'),('companies','org_id','uuid'),('companies','name','text'),('companies','biz_type','text'),('companies','owner_name','text'),('companies','phone','text'),('companies','email','text'),('companies','revenue','numeric'),('companies','assigned_to','uuid'),
    ('pipelines','id','uuid'),('pipelines','org_id','uuid'),('stages','id','uuid'),('stages','pipeline_id','uuid'),('stages','name','text'),('stages','kind','USER-DEFINED'),('org_members','org_id','uuid'),('org_members','user_id','uuid'),('org_members','status','text'))
  select count(*)=(select count(*) from expected) from expected e join information_schema.columns c on c.table_schema='public' and c.table_name=e.table_name and c.column_name=e.column_name and c.data_type=e.data_type
$$;
create or replace function public.newcust_legacy_target_schema_fingerprint(p_board uuid) returns text language sql stable security definer set search_path='' as $$
  select public.newcust_sha256(coalesce(jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'type',c.type::text,'options',c.options_jsonb,'order',c.sort_order) order by c.sort_order,c.key),'[]'::jsonb)::text) from public.board_columns c where c.board_id=p_board
$$;
create or replace function public.newcust_legacy_expected_target_schema_fingerprint() returns text language sql stable security definer set search_path='' as $$
  with expected(key,label,type,options,ord) as (values
    ('applied_on','신청일','date',null::jsonb,0),('ad_name','광고명','text',null,1),('business_type','사업자 유형','text',null,2),('company_name','회사명','text',null,3),('company_revenue','매출액','number',null,4),('contact','연락처','phone',null,5),('files','파일','file',null,6),('owner_name','대표자명','text',null,7),('address','주소','text',null,8),
    ('contact_status','연락 상태','select','{"options":[{"id":"new","label":"신규","color":"#c4c4c4"},{"id":"contacted","label":"연락 완료","color":"#579bfc"}]}'::jsonb,9),('proposal_status','제안 상태','select','{"options":[{"id":"pending","label":"검토 중","color":"#fdab3d"},{"id":"sent","label":"제안 완료","color":"#00c875"}]}'::jsonb,10),('expected_revenue','예상 매출','number',null,11),('priority','우선순위','select','{"options":[{"id":"high","label":"높음","color":"#e2445c"},{"id":"medium","label":"보통","color":"#fdab3d"},{"id":"low","label":"낮음","color":"#00c875"}]}'::jsonb,12),('next_contact','다음 연락일','date',null,13),('legacy_email','이메일','email',null,14),('legacy_note','메모','longtext',null,15),('legacy_stage_name','기존 단계','text',null,16))
  select public.newcust_sha256(jsonb_agg(jsonb_build_object('key',key,'label',label,'type',type,'options',options,'order',ord) order by ord,key)::text) from expected
$$;
revoke all on function public.newcust_legacy_source_schema_fingerprint(),public.newcust_legacy_target_schema_fingerprint(uuid) from public,anon,authenticated;
revoke all on function public.newcust_legacy_source_schema_ok() from public,anon,authenticated;
revoke all on function public.newcust_legacy_expected_target_schema_fingerprint() from public,anon,authenticated;

create or replace function public.newcust_legacy_dry_run(p_org_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n int; q int; m int; checksum text; inserted_count int; unchanged_count int:=0; conflict_count int:=0; c public.newcust_legacy_cutovers%rowtype; imported_ids uuid[]; expected text; expected_target text; board uuid; source_fp text; target_fp text; schema_valid boolean; schema_code text; reasons jsonb; sample_rows jsonb; quarantine_rows jsonb;
begin
  perform public.newcust_assert_admin(p_org_id);
  select count(*),count(*) filter(where quarantine_code is not null and quarantine_code<>'missing_company'),count(*) filter(where quarantine_code='missing_company'),encode(public.digest(coalesce(jsonb_agg(row_hash order by legacy_id),'[]'::jsonb)::text,'sha256'),'hex') into n,q,m,checksum from public.newcust_legacy_source_rows(p_org_id);
  inserted_count:=n-q-m;
  select coalesce(jsonb_object_agg(quarantine_code,cnt),'{}'::jsonb) into reasons from (select quarantine_code,count(*) cnt from public.newcust_legacy_source_rows(p_org_id) where quarantine_code is not null group by quarantine_code) grouped;
  select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'mapped',true) order by ordinal),'[]'::jsonb) into sample_rows from (select row_number() over(order by legacy_id) ordinal from public.newcust_legacy_source_rows(p_org_id) where quarantine_code is null order by legacy_id limit 5) bounded;
  select coalesce(jsonb_agg(jsonb_build_object('ordinal',ordinal,'reason',quarantine_code) order by ordinal),'[]'::jsonb) into quarantine_rows from (select row_number() over(order by legacy_id) ordinal,quarantine_code from public.newcust_legacy_source_rows(p_org_id) where quarantine_code is not null order by legacy_id limit 20) bounded;
  source_fp:=public.newcust_legacy_source_schema_fingerprint();
  select b.id into board from public.boards b where b.org_id=p_org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') order by b.created_at limit 1;
  target_fp:=case when board is null then 'absent' else public.newcust_legacy_target_schema_fingerprint(board) end;
  schema_valid:=public.newcust_legacy_source_schema_ok() and (board is null or target_fp=public.newcust_legacy_expected_target_schema_fingerprint());
  schema_code:=case when not public.newcust_legacy_source_schema_ok() then 'source_schema_mismatch' when board is not null and target_fp<>public.newcust_legacy_expected_target_schema_fingerprint() then 'target_schema_mismatch' else null end;
  select * into c from public.newcust_legacy_cutovers where org_id=p_org_id;
  if c.status='applied_verified' then
    select b.source_checksum,b.target_checksum into expected,expected_target from public.newcust_legacy_batches b where b.id=c.batch_id and b.org_id=p_org_id;
    select coalesce(array_agg(l.item_id order by l.item_id),'{}'::uuid[]) into imported_ids from public.newcust_legacy_item_links l where l.batch_id=c.batch_id and l.org_id=p_org_id;
    select count(*) filter(where l.item_id is not null and l.row_hash=r.row_hash and l.target_hash=public.newcust_legacy_target_checksum(c.board_id,array[l.item_id])),
      count(*) filter(where l.item_id is null or l.row_hash is distinct from r.row_hash or l.target_hash is distinct from public.newcust_legacy_target_checksum(c.board_id,array[l.item_id]))
      into unchanged_count,conflict_count from public.newcust_legacy_source_rows(p_org_id) r left join public.newcust_legacy_item_links l on l.org_id=p_org_id and l.batch_id=c.batch_id and l.source_kind='crm_deal' and l.legacy_id=r.legacy_id where r.quarantine_code is null;
    if expected is distinct from checksum or public.newcust_legacy_target_checksum(c.board_id,imported_ids) is distinct from expected_target then conflict_count:=greatest(conflict_count,inserted_count-unchanged_count); end if;
    inserted_count:=0;
  else
    select count(*) into conflict_count from public.newcust_legacy_source_rows(p_org_id) r join public.items i on i.id=public.newcust_uuid(p_org_id::text||':deal:'||r.legacy_id) where r.quarantine_code is null;
    inserted_count:=inserted_count-conflict_count;
  end if;
  return jsonb_build_object('source',n,'inserted',inserted_count,'update',0,'unchanged',unchanged_count,'conflict',conflict_count,'quarantine',q,'missing',m,'quarantine_reasons',reasons,'quarantine_sample',quarantine_rows,'sample',sample_rows,'schema_ok',schema_valid,'schema_error_code',schema_code,'source_checksum',checksum,'source_schema_fingerprint',source_fp,'target_schema_fingerprint',target_fp);
end $$;

create or replace function public.newcust_legacy_apply(p_org_id uuid,p_request_id uuid,p_expected_checksum text) returns jsonb language plpgsql security definer set search_path='' as $$
declare dry jsonb; board uuid; grp uuid; batch uuid:=gen_random_uuid(); existing public.newcust_legacy_cutovers%rowtype; target_hash text; expected_target_hash text; imported_ids uuid[];
begin
  perform public.newcust_assert_admin(p_org_id); perform pg_advisory_xact_lock(hashtextextended(p_org_id::text,26));
  perform 1 from public.deals where org_id=p_org_id for update; perform 1 from public.companies where org_id=p_org_id for share;
  perform 1 from public.pipelines where org_id=p_org_id for update;
  perform 1 from public.stages s join public.pipelines p on p.id=s.pipeline_id where p.org_id=p_org_id for update of s;
  lock table public.org_members in share mode;
  select b.id into board from public.boards b where b.org_id=p_org_id and b.source in ('newcust.monday.v1','newcust.monday.v1:initializing') order by b.created_at limit 1 for update;
  board:=coalesce(board,public.newcust_uuid(p_org_id::text||':newcust-board')); grp:=public.newcust_uuid(p_org_id::text||':newcust-group');
  dry:=public.newcust_legacy_dry_run(p_org_id);
  if (dry->>'source')::int=0 then raise exception 'NEWCUST_NO_SOURCE' using errcode='P0001'; end if;
  if dry->>'source_checksum'<>p_expected_checksum or not (dry->>'schema_ok')::boolean or (dry->>'quarantine')::int>0 or (dry->>'conflict')::int>0 or (dry->>'missing')::int>0 then raise exception 'NEWCUST_PREFLIGHT_FAILED' using errcode='P0001'; end if;
  select * into existing from public.newcust_legacy_cutovers where org_id=p_org_id;
  if existing.org_id is not null and existing.board_id is distinct from board then raise exception 'NEWCUST_BOARD_LIFECYCLE_CONFLICT' using errcode='P0001'; end if;
  if existing.status='applied_verified' then
    select coalesce(array_agg(l.item_id order by l.item_id),'{}'::uuid[]) into imported_ids from public.newcust_legacy_item_links l where l.batch_id=existing.batch_id and l.org_id=p_org_id;
    select public.newcust_legacy_target_checksum(existing.board_id,imported_ids) into target_hash;
    if not exists(select 1 from public.newcust_legacy_item_links l where l.batch_id=existing.batch_id and l.org_id=p_org_id and l.target_hash is distinct from public.newcust_legacy_target_checksum(existing.board_id,array[l.item_id]))
      and target_hash=(select b.target_checksum from public.newcust_legacy_batches b where b.id=existing.batch_id and b.org_id=p_org_id)
      and (select source_checksum from public.newcust_legacy_batches where id=existing.batch_id)=p_expected_checksum
      and (select source_schema_fingerprint from public.newcust_legacy_batches where id=existing.batch_id)=public.newcust_legacy_source_schema_fingerprint()
      and (select target_schema_fingerprint from public.newcust_legacy_batches where id=existing.batch_id)=public.newcust_legacy_target_schema_fingerprint(existing.board_id) then
      return (dry||jsonb_build_object('inserted',0,'unchanged',(dry->>'source')::int,'status','applied_verified','batch_id',existing.batch_id,'target_checksum',target_hash,'replayed',true));
    end if;
    raise exception 'NEWCUST_REPLAY_CONFLICT' using errcode='P0001';
  end if;
  insert into public.boards(id,org_id,name,description,icon,is_system,source,sort_order,created_by) values(board,p_org_id,'신규 업체','001 CRM 일회 이관 보드','table',true,'newcust.monday.v1',0,auth.uid()) on conflict(id) do update set source='newcust.monday.v1';
  insert into public.board_groups(id,org_id,board_id,name,color,sort_order) values(grp,p_org_id,board,'신규 업체','#00c875',0) on conflict(id) do nothing;
  insert into public.board_columns(id,org_id,board_id,key,label,type,options_jsonb,sort_order) select public.newcust_uuid(board::text||':'||x.key),p_org_id,board,x.key,x.label,x.type::public.field_type,
    case x.key when 'contact_status' then '{"options":[{"id":"new","label":"신규","color":"#c4c4c4"},{"id":"contacted","label":"연락 완료","color":"#579bfc"}]}'::jsonb when 'proposal_status' then '{"options":[{"id":"pending","label":"검토 중","color":"#fdab3d"},{"id":"sent","label":"제안 완료","color":"#00c875"}]}'::jsonb when 'priority' then '{"options":[{"id":"high","label":"높음","color":"#e2445c"},{"id":"medium","label":"보통","color":"#fdab3d"},{"id":"low","label":"낮음","color":"#00c875"}]}'::jsonb else null end,x.ord from (values
    ('applied_on','신청일','date',0),('ad_name','광고명','text',1),('business_type','사업자 유형','text',2),('company_name','회사명','text',3),('company_revenue','매출액','number',4),('contact','연락처','phone',5),('files','파일','file',6),('owner_name','대표자명','text',7),('address','주소','text',8),('contact_status','연락 상태','select',9),('proposal_status','제안 상태','select',10),('expected_revenue','예상 매출','number',11),('priority','우선순위','select',12),('next_contact','다음 연락일','date',13),('legacy_email','이메일','email',14),('legacy_note','메모','longtext',15),('legacy_stage_name','기존 단계','text',16)) x(key,label,type,ord) on conflict(board_id,key) do nothing;
  if (select count(*) from public.board_columns where board_id=board and (key,type::text,sort_order) in (('applied_on','date',0),('ad_name','text',1),('business_type','text',2),('company_name','text',3),('company_revenue','number',4),('contact','phone',5),('files','file',6),('owner_name','text',7),('address','text',8),('contact_status','select',9),('proposal_status','select',10),('expected_revenue','number',11),('priority','select',12),('next_contact','date',13),('legacy_email','email',14),('legacy_note','longtext',15),('legacy_stage_name','text',16))) <> 17 then raise exception 'NEWCUST_TARGET_SCHEMA_MISMATCH' using errcode='P0001'; end if;
  if not exists(select 1 from public.board_columns where board_id=board and key='contact_status' and options_jsonb->'options' @> '[{"id":"new"},{"id":"contacted"}]'::jsonb)
    or not exists(select 1 from public.board_columns where board_id=board and key='proposal_status' and options_jsonb->'options' @> '[{"id":"pending"},{"id":"sent"}]'::jsonb)
    or not exists(select 1 from public.board_columns where board_id=board and key='priority' and options_jsonb->'options' @> '[{"id":"high"},{"id":"medium"},{"id":"low"}]'::jsonb) then raise exception 'NEWCUST_TARGET_OPTIONS_MISMATCH' using errcode='P0001'; end if;
  if public.newcust_legacy_target_schema_fingerprint(board)<>public.newcust_legacy_expected_target_schema_fingerprint() then raise exception 'NEWCUST_TARGET_SCHEMA_FINGERPRINT_MISMATCH' using errcode='P0001'; end if;
  insert into public.items(id,org_id,board_id,group_id,title,assigned_to,sort_order)
    select public.newcust_uuid(p_org_id::text||':deal:'||legacy_id),p_org_id,board,grp,row_data->>'title',(row_data->>'assigned_to')::uuid,row_number() over(order by legacy_id) from public.newcust_legacy_source_rows(p_org_id) where quarantine_code is null;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
    select p_org_id,public.newcust_uuid(p_org_id::text||':deal:'||r.legacy_id),e.key,e.value from public.newcust_legacy_source_rows(p_org_id) r cross join lateral jsonb_each(r.row_data-'title'-'assigned_to') e where e.value<>'null'::jsonb;
  select coalesce(array_agg(public.newcust_uuid(p_org_id::text||':deal:'||legacy_id) order by legacy_id),'{}'::uuid[]) into imported_ids from public.newcust_legacy_source_rows(p_org_id) where quarantine_code is null;
  select public.newcust_legacy_target_checksum(board,imported_ids) into target_hash;
  select public.newcust_legacy_expected_target_checksum(p_org_id,board,grp) into expected_target_hash;
  if target_hash<>expected_target_hash then raise exception 'NEWCUST_TARGET_CHECKSUM_MISMATCH' using errcode='P0001'; end if;
  insert into public.newcust_legacy_batches(id,org_id,board_id,request_id,source_checksum,source_schema_fingerprint,target_schema_fingerprint,target_checksum,status,actor_id,source_count,insert_count,update_count,quarantine_count,conflict_count,missing_count)
    values(batch,p_org_id,board,p_request_id,p_expected_checksum,public.newcust_legacy_source_schema_fingerprint(),public.newcust_legacy_target_schema_fingerprint(board),target_hash,'applied_verified',auth.uid(),(dry->>'source')::int,(dry->>'inserted')::int,0,(dry->>'quarantine')::int,(dry->>'conflict')::int,(dry->>'missing')::int);
  insert into public.newcust_legacy_item_links(item_id,org_id,batch_id,source_kind,legacy_id,row_hash,target_hash)
    select public.newcust_uuid(p_org_id::text||':deal:'||legacy_id),p_org_id,batch,'crm_deal',legacy_id,row_hash,
      public.newcust_legacy_target_checksum(board,array[public.newcust_uuid(p_org_id::text||':deal:'||legacy_id)])
    from public.newcust_legacy_source_rows(p_org_id) where quarantine_code is null;
  insert into public.newcust_legacy_cutovers(org_id,board_id,batch_id,status) values(p_org_id,board,batch,'applied_verified') on conflict(org_id) do update set batch_id=excluded.batch_id,status=excluded.status,updated_at=now();
  return dry||jsonb_build_object('status','applied_verified','batch_id',batch,'target_checksum',target_hash,'replayed',false);
end $$;

create or replace function public.newcust_legacy_status(p_org_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ declare c public.newcust_legacy_cutovers%rowtype; begin perform public.newcust_assert_admin(p_org_id); select * into c from public.newcust_legacy_cutovers where org_id=p_org_id; return jsonb_build_object('status',coalesce(c.status,'pending'),'batch_id',c.batch_id); end $$;

create or replace function public.newcust_legacy_ui_ready(p_org_id uuid) returns boolean language sql security definer set search_path='' as $$
  select public.is_org_member(p_org_id) and (not exists(select 1 from public.newcust_legacy_source_rows(p_org_id)) or exists(select 1 from public.newcust_legacy_cutovers c where c.org_id=p_org_id and c.status='applied_verified'))
$$;

create or replace function public.newcust_legacy_rollback(p_org_id uuid,p_expected_target_checksum text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.newcust_legacy_cutovers%rowtype; expected text; imported_ids uuid[];
begin
  perform public.newcust_assert_admin(p_org_id); perform pg_advisory_xact_lock(hashtextextended(p_org_id::text,26)); select * into c from public.newcust_legacy_cutovers where org_id=p_org_id for update;
  select target_checksum into expected from public.newcust_legacy_batches where id=c.batch_id and org_id=p_org_id;
  select coalesce(array_agg(l.item_id order by l.item_id),'{}'::uuid[]) into imported_ids from public.newcust_legacy_item_links l where l.batch_id=c.batch_id and l.org_id=p_org_id;
  if c.org_id is null or c.status is distinct from 'applied_verified' or c.batch_id is null or expected is distinct from p_expected_target_checksum or public.newcust_legacy_target_checksum(c.board_id,imported_ids) is distinct from expected
    or exists(select 1 from public.newcust_legacy_item_links l where l.batch_id=c.batch_id and l.org_id=p_org_id and l.target_hash is distinct from public.newcust_legacy_target_checksum(c.board_id,array[l.item_id])) then raise exception 'NEWCUST_ROLLBACK_CONFLICT' using errcode='P0001'; end if;
  if exists(select 1 from public.items child where child.org_id=p_org_id and child.parent_item_id=any(imported_ids) and not (child.id=any(imported_ids))) then raise exception 'NEWCUST_ROLLBACK_CHILD_CONFLICT' using errcode='P0001'; end if;
  delete from public.item_values where item_id=any(imported_ids);
  delete from public.newcust_legacy_item_links where batch_id=c.batch_id and org_id=p_org_id;
  delete from public.items where id=any(imported_ids) and org_id=p_org_id;
  update public.newcust_legacy_cutovers set status='rolled_back',updated_at=now() where org_id=p_org_id;
  update public.newcust_legacy_batches set status='rolled_back' where id=c.batch_id and org_id=p_org_id;
  return jsonb_build_object('status','rolled_back');
end $$;

create or replace function public.newcust_legacy_write_fence() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; marketing boolean;
begin
  if tg_op='DELETE' then oid:=old.org_id; select exists(select 1 from public.stages s join public.pipelines p on p.id=s.pipeline_id where s.id=old.stage_id and s.kind='marketing' and p.org_id=oid) into marketing;
  elsif tg_op='INSERT' then oid:=new.org_id; select exists(select 1 from public.stages s join public.pipelines p on p.id=s.pipeline_id where s.id=new.stage_id and s.kind='marketing' and p.org_id=oid) into marketing;
  else if old.org_id is distinct from new.org_id then raise exception 'NEWCUST_CROSS_ORG_MOVE_FORBIDDEN' using errcode='P0001'; end if; oid:=old.org_id; select exists(select 1 from public.stages s join public.pipelines p on p.id=s.pipeline_id where s.id in (old.stage_id,new.stage_id) and s.kind='marketing' and p.org_id=oid) into marketing; end if;
  if not marketing then if tg_op='DELETE' then return old; end if; return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(oid::text,26));
  if exists(select 1 from public.newcust_legacy_cutovers c where c.org_id=oid and c.status in ('applied_verified','rolled_back')) then raise exception 'NEWCUST_CUTOVER_FENCE' using errcode='P0001'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger deals_newcust_cutover_fence before insert or update or delete on deals for each row execute function public.newcust_legacy_write_fence();

create or replace function public.newcust_legacy_structure_fence() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid; marketing boolean;
begin
  if tg_table_name='pipelines' then if tg_op='UPDATE' and old.org_id is distinct from new.org_id then raise exception 'NEWCUST_CROSS_ORG_MOVE_FORBIDDEN' using errcode='P0001'; end if; if tg_op='DELETE' then oid:=old.org_id; marketing:=exists(select 1 from public.stages s where s.pipeline_id=old.id and s.kind='marketing'); else oid:=new.org_id; marketing:=exists(select 1 from public.stages s where s.pipeline_id=new.id and s.kind='marketing'); end if;
  else if tg_op='UPDATE' and old.pipeline_id is distinct from new.pipeline_id and (select p.org_id from public.pipelines p where p.id=old.pipeline_id) is distinct from (select p.org_id from public.pipelines p where p.id=new.pipeline_id) then raise exception 'NEWCUST_CROSS_ORG_MOVE_FORBIDDEN' using errcode='P0001'; end if; if tg_op='DELETE' then select p.org_id into oid from public.pipelines p where p.id=old.pipeline_id; marketing:=old.kind='marketing'; else select p.org_id into oid from public.pipelines p where p.id=new.pipeline_id; marketing:=old.kind='marketing' or new.kind='marketing'; end if; end if;
  if not marketing then if tg_op='DELETE' then return old; end if; return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(oid::text,26));
  if exists(select 1 from public.newcust_legacy_cutovers c where c.org_id=oid and c.status in ('applied_verified','rolled_back')) then raise exception 'NEWCUST_CUTOVER_FENCE' using errcode='P0001'; end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger pipelines_newcust_cutover_fence before update or delete on pipelines for each row execute function public.newcust_legacy_structure_fence();
create trigger stages_newcust_cutover_fence before update or delete on stages for each row execute function public.newcust_legacy_structure_fence();

revoke all on function public.newcust_legacy_dry_run(uuid),public.newcust_legacy_apply(uuid,uuid,text),public.newcust_legacy_status(uuid),public.newcust_legacy_rollback(uuid,text) from public,anon;
revoke all on function public.newcust_legacy_ui_ready(uuid) from public,anon;
grant execute on function public.newcust_legacy_dry_run(uuid),public.newcust_legacy_apply(uuid,uuid,text),public.newcust_legacy_status(uuid),public.newcust_legacy_rollback(uuid,text),public.newcust_legacy_ui_ready(uuid) to authenticated;

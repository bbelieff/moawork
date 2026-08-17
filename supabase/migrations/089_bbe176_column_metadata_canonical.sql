-- BBE-176: canonical, replay-safe board column commands.
-- Installation is additive and does not update customer board/value rows.

alter table public.board_columns
  add column if not exists description text,
  add column if not exists is_required boolean not null default false,
  add column if not exists validation_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists edit_policy_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists view_policy_jsonb jsonb not null default '{}'::jsonb,
  add column if not exists summary_hidden boolean not null default false,
  add column if not exists wrap_mode text not null default 'truncate',
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_by uuid;

do $$ begin
  alter table public.board_columns add constraint board_columns_wrap_mode
    check (wrap_mode in ('truncate','wrap'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.board_columns add constraint board_columns_policy_objects
    check (jsonb_typeof(validation_jsonb)='object' and jsonb_typeof(edit_policy_jsonb)='object' and jsonb_typeof(view_policy_jsonb)='object');
exception when duplicate_object then null; end $$;

create index if not exists board_columns_active_order_idx
  on public.board_columns(org_id,board_id,sort_order) where archived_at is null;

create table if not exists public.board_column_command_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id),
  board_id uuid not null references public.boards(id) on delete cascade,
  operation text not null,
  payload_hash text not null,
  result_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  primary key(org_id,request_id)
);

create table if not exists public.board_column_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid,
  actor_id uuid not null references public.users(id),
  operation text not null,
  before_jsonb jsonb,
  after_jsonb jsonb,
  request_id uuid not null,
  changed_at timestamptz not null default now(),
  unique(org_id,request_id)
);

alter table public.board_column_command_receipts enable row level security;
alter table public.board_column_audit enable row level security;

drop policy if exists board_column_receipt_actor_read on public.board_column_command_receipts;
create policy board_column_receipt_actor_read on public.board_column_command_receipts
  for select to authenticated using (actor_id=(select auth.uid()) and public.is_org_member(org_id));
drop policy if exists board_column_audit_manager_read on public.board_column_audit;
create policy board_column_audit_manager_read on public.board_column_audit
  for select to authenticated using (public.org_role(org_id) in ('owner','admin'));

create or replace function public.board_column_policy_allows(p_org_id uuid,p_policy jsonb)
returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_role text; v_scope text;
begin
  select m.role::text,m.scope::text into v_role,v_scope from public.org_members m
  join public.orgs o on o.id=m.org_id
  where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null then return false; end if;
  if coalesce(p_policy,'{}'::jsonb)='{}'::jsonb then return true; end if;
  return (not (p_policy?'roles') or p_policy->'roles' ? v_role)
     and (not (p_policy?'scopes') or p_policy->'scopes' ? v_scope)
     and (not (p_policy?'userIds') or p_policy->'userIds' ? v_actor::text);
end $$;

create or replace function public.board_column_value_visible(p_org_id uuid,p_item_id uuid,p_column_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.items i join public.board_columns c
      on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_column_key
    join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
    join public.orgs o on o.id=i.org_id and o.status='active'
    where i.org_id=p_org_id and i.id=p_item_id and c.archived_at is null
      and public.effective_permission(p_org_id,'work.view_tabs')
      and public.board_column_policy_allows(p_org_id,c.view_policy_jsonb)
      and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
  )
$$;

create or replace function public.board_column_value_editable(p_org_id uuid,p_item_id uuid,p_column_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.items i join public.board_columns c
      on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_column_key
    join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
    join public.orgs o on o.id=i.org_id and o.status='active'
    where i.org_id=p_org_id and i.id=p_item_id and c.archived_at is null and not c.is_readonly
      and public.effective_permission(p_org_id,'work.item_upsert')
      and public.board_column_policy_allows(p_org_id,c.edit_policy_jsonb)
      and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
  )
$$;

drop policy if exists bcols_rw on public.board_columns;
drop policy if exists bcols_select on public.board_columns;
create policy bcols_select on public.board_columns for select to authenticated
  using (public.is_org_member(org_id) and public.board_column_policy_allows(org_id,view_policy_jsonb));

drop policy if exists itemvals_rw on public.item_values;
drop policy if exists itemvals_select on public.item_values;
drop policy if exists itemvals_insert on public.item_values;
drop policy if exists itemvals_update on public.item_values;
drop policy if exists itemvals_delete on public.item_values;
create policy itemvals_select on public.item_values for select to authenticated
  using (public.board_column_value_visible(org_id,item_id,column_key));
create policy itemvals_insert on public.item_values for insert to authenticated
  with check (public.board_column_value_editable(org_id,item_id,column_key));
create policy itemvals_update on public.item_values for update to authenticated
  using (public.board_column_value_editable(org_id,item_id,column_key))
  with check (public.board_column_value_editable(org_id,item_id,column_key));
create policy itemvals_delete on public.item_values for delete to authenticated
  using (public.board_column_value_editable(org_id,item_id,column_key));

create or replace function public.board_column_type_dry_run(
  p_org_id uuid,p_board_id uuid,p_column_id uuid,p_target_type public.field_type
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_key text; v_role text; v_total int; v_invalid int; v_fingerprint text;
begin
  select m.role::text into v_role from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=auth.uid() and m.status='active' and o.status='active';
  if v_role not in ('owner','admin') then raise exception 'column structure permission denied' using errcode='42501'; end if;
  select key into strict v_key from public.board_columns where id=p_column_id and org_id=p_org_id and board_id=p_board_id and archived_at is null;
  select count(*),count(*) filter(where not (
    value_jsonb is null or value_jsonb='null'::jsonb
    or p_target_type::text in ('text','longtext','url','email','phone','select')
    or (p_target_type::text in ('number','money') and (jsonb_typeof(value_jsonb)='number' or (jsonb_typeof(value_jsonb)='string' and trim(both '"' from value_jsonb::text) ~ '^-?[0-9]+([.][0-9]+)?$')))
    or (p_target_type::text='checkbox' and jsonb_typeof(value_jsonb)='boolean')
    or (p_target_type::text in ('multiselect','people') and jsonb_typeof(value_jsonb)='array')
    or (p_target_type::text='person' and jsonb_typeof(value_jsonb)='string' and trim(both '"' from value_jsonb::text) ~ '^[0-9a-fA-F-]{36}$')
    or (p_target_type::text='date' and jsonb_typeof(value_jsonb)='string' and trim(both '"' from value_jsonb::text) ~ '^\\d{4}-\\d{2}-\\d{2}$')
    or (p_target_type::text='datetime' and jsonb_typeof(value_jsonb)='string' and trim(both '"' from value_jsonb::text) ~ '^\\d{4}-\\d{2}-\\d{2}T')
  )),encode(digest(coalesce(string_agg(item_id::text||':'||value_jsonb::text,'|' order by item_id),'empty'),'sha256'),'hex')
  into v_total,v_invalid,v_fingerprint from public.item_values where org_id=p_org_id and column_key=v_key
    and item_id in(select id from public.items where org_id=p_org_id and board_id=p_board_id);
  return jsonb_build_object('columnId',p_column_id,'targetType',p_target_type::text,'totalValues',v_total,'invalidValues',v_invalid,'safe',v_invalid=0,'fingerprint',v_fingerprint);
end $$;

create or replace function public.execute_board_column_command(
  p_org_id uuid,p_board_id uuid,p_column_id uuid,p_operation text,p_request_id uuid,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_role text; v_hash text; v_prior public.board_column_command_receipts; v_col public.board_columns;
  v_before jsonb; v_after jsonb; v_result jsonb; v_position int; v_new_id uuid; v_new_key text; v_dry jsonb;
begin
  if p_request_id is null or p_operation is null or jsonb_typeof(coalesce(p_payload,'{}'))<>'object' then raise exception 'invalid column command' using errcode='22023'; end if;
  select m.role::text into v_role from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role not in ('owner','admin') then raise exception 'column structure permission denied' using errcode='42501'; end if;
  if not exists(select 1 from public.boards where id=p_board_id and org_id=p_org_id) then raise exception 'board not found' using errcode='P0002'; end if;
  v_hash:=encode(digest(p_operation||':'||coalesce(p_column_id::text,'')||':'||coalesce(p_payload,'{}')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.board_column_command_receipts where org_id=p_org_id and request_id=p_request_id;
  if found then
    if v_prior.payload_hash<>v_hash then raise exception 'request_id payload mismatch' using errcode='22023'; end if;
    return v_prior.result_jsonb||jsonb_build_object('replayed',true);
  end if;
  if p_column_id is not null then select * into strict v_col from public.board_columns where id=p_column_id and org_id=p_org_id and board_id=p_board_id for update; v_before:=to_jsonb(v_col); end if;
  case p_operation
    when 'create_at' then
      v_position:=greatest(0,least(coalesce((p_payload->>'position')::int,(select count(*) from public.board_columns where board_id=p_board_id and archived_at is null)),(select count(*) from public.board_columns where board_id=p_board_id and archived_at is null)));
      update public.board_columns set sort_order=sort_order+1 where org_id=p_org_id and board_id=p_board_id and archived_at is null and sort_order>=v_position;
      v_new_key:=coalesce(nullif(p_payload->>'key',''),'custom_'||substr(replace(gen_random_uuid()::text,'-',''),1,12));
      insert into public.board_columns(org_id,board_id,key,label,type,source,sort_order,description,is_required,validation_jsonb,edit_policy_jsonb,view_policy_jsonb,summary_hidden,wrap_mode)
      values(p_org_id,p_board_id,v_new_key,nullif(btrim(p_payload->>'label'),''),(p_payload->>'type')::public.field_type,coalesce((p_payload->>'source')::public.field_source,'in'),v_position,p_payload->>'description',coalesce((p_payload->>'required')::boolean,false),coalesce(p_payload->'validation','{}'),coalesce(p_payload->'editPolicy','{}'),coalesce(p_payload->'viewPolicy','{}'),coalesce((p_payload->>'summaryHidden')::boolean,false),coalesce(p_payload->>'wrapMode','truncate')) returning id into v_new_id;
    when 'duplicate' then
      v_position:=coalesce((p_payload->>'position')::int,v_col.sort_order+1); update public.board_columns set sort_order=sort_order+1 where org_id=p_org_id and board_id=p_board_id and archived_at is null and sort_order>=v_position;
      v_new_key:=coalesce(nullif(p_payload->>'key',''),v_col.key||'_copy_'||substr(replace(gen_random_uuid()::text,'-',''),1,6));
      insert into public.board_columns(org_id,board_id,key,label,type,options_jsonb,sort_order,width,source,right_pinned,move_rule_jsonb,is_readonly,description,is_required,validation_jsonb,edit_policy_jsonb,view_policy_jsonb,summary_hidden,wrap_mode)
      select org_id,board_id,v_new_key,coalesce(nullif(p_payload->>'label',''),label||' copy'),type,options_jsonb,v_position,width,source,right_pinned,move_rule_jsonb,is_readonly,description,is_required,validation_jsonb,edit_policy_jsonb,view_policy_jsonb,summary_hidden,wrap_mode from public.board_columns where id=p_column_id returning id into v_new_id;
      insert into public.item_values(org_id,item_id,column_key,value_jsonb) select org_id,item_id,v_new_key,value_jsonb from public.item_values where org_id=p_org_id and column_key=v_col.key and item_id in(select id from public.items where board_id=p_board_id and org_id=p_org_id);
    when 'rename' then update public.board_columns set label=nullif(btrim(p_payload->>'label'),'') where id=p_column_id;
    when 'settings' then update public.board_columns set description=case when p_payload?'description' then p_payload->>'description' else description end,is_required=case when p_payload?'required' then (p_payload->>'required')::boolean else is_required end,validation_jsonb=coalesce(p_payload->'validation',validation_jsonb),edit_policy_jsonb=coalesce(p_payload->'editPolicy',edit_policy_jsonb),view_policy_jsonb=coalesce(p_payload->'viewPolicy',view_policy_jsonb),summary_hidden=case when p_payload?'summaryHidden' then (p_payload->>'summaryHidden')::boolean else summary_hidden end,wrap_mode=coalesce(p_payload->>'wrapMode',wrap_mode) where id=p_column_id;
    when 'reorder' then
      v_position:=greatest(0,least((p_payload->>'position')::int,(select greatest(count(*)-1,0) from public.board_columns where board_id=p_board_id and archived_at is null)));
      if v_position<v_col.sort_order then
        update public.board_columns set sort_order=sort_order+1 where org_id=p_org_id and board_id=p_board_id and archived_at is null and id<>p_column_id and sort_order>=v_position and sort_order<v_col.sort_order;
      elsif v_position>v_col.sort_order then
        update public.board_columns set sort_order=sort_order-1 where org_id=p_org_id and board_id=p_board_id and archived_at is null and id<>p_column_id and sort_order>v_col.sort_order and sort_order<=v_position;
      end if;
      update public.board_columns set sort_order=v_position where id=p_column_id;
    when 'type_commit' then
      perform 1 from public.item_values where org_id=p_org_id and column_key=v_col.key and item_id in(select id from public.items where board_id=p_board_id and org_id=p_org_id) for update;
      v_dry:=public.board_column_type_dry_run(p_org_id,p_board_id,p_column_id,(p_payload->>'targetType')::public.field_type);
      if not (v_dry->>'safe')::boolean then raise exception 'unsafe column type conversion' using errcode='22023'; end if;
      if v_dry->>'fingerprint' is distinct from p_payload->>'fingerprint' then raise exception 'column values changed after dry run' using errcode='40001'; end if;
      if p_payload->>'targetType' in ('number','money') then update public.item_values set value_jsonb=to_jsonb(trim(both '"' from value_jsonb::text)::numeric) where org_id=p_org_id and column_key=v_col.key and value_jsonb is not null and value_jsonb<>'null'::jsonb and jsonb_typeof(value_jsonb)='string' and item_id in(select id from public.items where board_id=p_board_id and org_id=p_org_id); end if;
      if p_payload->>'targetType' in ('text','longtext','url','email','phone') then update public.item_values set value_jsonb=to_jsonb(trim(both '"' from value_jsonb::text)) where org_id=p_org_id and column_key=v_col.key and value_jsonb is not null and value_jsonb<>'null'::jsonb and jsonb_typeof(value_jsonb)<>'string' and item_id in(select id from public.items where board_id=p_board_id and org_id=p_org_id); end if;
      update public.board_columns set type=(p_payload->>'targetType')::public.field_type where id=p_column_id;
    when 'archive' then update public.board_columns set archived_at=now(),deleted_by=v_actor where id=p_column_id and archived_at is null;
    when 'restore' then update public.board_columns set archived_at=null,deleted_by=null where id=p_column_id and archived_at is not null;
    else raise exception 'unsupported column operation' using errcode='22023';
  end case;
  select to_jsonb(c) into v_after from public.board_columns c where c.id=coalesce(v_new_id,p_column_id);
  v_result:=jsonb_build_object('accepted',true,'replayed',false,'operation',p_operation,'columnId',coalesce(v_new_id,p_column_id),'column',v_after);
  insert into public.board_column_command_receipts values(p_org_id,p_request_id,v_actor,p_board_id,p_operation,v_hash,v_result,now());
  insert into public.board_column_audit(org_id,board_id,column_id,actor_id,operation,before_jsonb,after_jsonb,request_id) values(p_org_id,p_board_id,coalesce(v_new_id,p_column_id),v_actor,p_operation,v_before,v_after,p_request_id);
  return v_result;
end $$;

revoke all on public.board_column_command_receipts,public.board_column_audit from public,anon,authenticated;
grant select on public.board_column_command_receipts,public.board_column_audit to authenticated;
revoke insert,update,delete on public.board_columns from public,anon,authenticated;
revoke all on function public.board_column_policy_allows(uuid,jsonb),public.board_column_value_visible(uuid,uuid,text),public.board_column_value_editable(uuid,uuid,text),public.board_column_type_dry_run(uuid,uuid,uuid,public.field_type),public.execute_board_column_command(uuid,uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.board_column_type_dry_run(uuid,uuid,uuid,public.field_type),public.execute_board_column_command(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;
grant execute on function public.board_column_policy_allows(uuid,jsonb),public.board_column_value_visible(uuid,uuid,text),public.board_column_value_editable(uuid,uuid,text) to authenticated;

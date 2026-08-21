-- moa-migration-guard: logical_key=118_bbe178_column_value_and_schedule_dispatch predecessor=117_bbe237_company_start_work digest=5bc9c2468389a80e9051f9da9f2e933ec4a5ae5c23f999296d98f52520c40a22 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '118_bbe178_column_value_and_schedule_dispatch',
  p_file_name => '118_bbe178_column_value_and_schedule_dispatch.sql',
  p_file_digest => '5bc9c2468389a80e9051f9da9f2e933ec4a5ae5c23f999296d98f52520c40a22',
  p_expected_predecessor => '117_bbe237_company_start_work',
  p_executor => 'DG-06',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

create or replace function public.board_column_validation_is_valid(p_validation jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_validation)<>'object' or exists(select 1 from jsonb_object_keys(p_validation) k where k not in ('minLength','maxLength','min','max','pattern','allowedValues','dateMin','dateMax')) then return false; end if;
  if p_validation?'minLength' and (jsonb_typeof(p_validation->'minLength')<>'number' or (p_validation->>'minLength')::numeric<0 or trunc((p_validation->>'minLength')::numeric)<>(p_validation->>'minLength')::numeric) then return false; end if;
  if p_validation?'maxLength' and (jsonb_typeof(p_validation->'maxLength')<>'number' or (p_validation->>'maxLength')::numeric<0 or trunc((p_validation->>'maxLength')::numeric)<>(p_validation->>'maxLength')::numeric) then return false; end if;
  if p_validation?'minLength' and p_validation?'maxLength' and (p_validation->>'minLength')::numeric>(p_validation->>'maxLength')::numeric then return false; end if;
  if p_validation?'min' and jsonb_typeof(p_validation->'min')<>'number' then return false; end if;
  if p_validation?'max' and jsonb_typeof(p_validation->'max')<>'number' then return false; end if;
  if p_validation?'min' and p_validation?'max' and (p_validation->>'min')::numeric>(p_validation->>'max')::numeric then return false; end if;
  if p_validation?'pattern' and (jsonb_typeof(p_validation->'pattern')<>'string' or char_length(p_validation->>'pattern')>500) then return false; end if;
  if p_validation?'allowedValues' and (jsonb_typeof(p_validation->'allowedValues')<>'array' or exists(select 1 from jsonb_array_elements(p_validation->'allowedValues') x where jsonb_typeof(x) not in ('string','number','boolean'))) then return false; end if;
  if p_validation?'dateMin' and (jsonb_typeof(p_validation->'dateMin')<>'string' or not (p_validation->>'dateMin') ~ '^\d{4}-\d{2}-\d{2}(T.*)?$') then return false; end if;
  if p_validation?'dateMax' and (jsonb_typeof(p_validation->'dateMax')<>'string' or not (p_validation->>'dateMax') ~ '^\d{4}-\d{2}-\d{2}(T.*)?$') then return false; end if;
  if p_validation?'dateMin' and p_validation?'dateMax' and (p_validation->>'dateMin')::timestamptz>(p_validation->>'dateMax')::timestamptz then return false; end if;
  return true;
exception when others then return false;
end $$;

create or replace function public.board_column_value_is_valid(
  p_org_id uuid, p_item_id uuid, p_column_key text, p_value jsonb
) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_col public.board_columns; v_missing boolean;
begin
  select c.* into v_col from public.items i join public.board_columns c
    on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_column_key
   where i.id=p_item_id and i.org_id=p_org_id and c.archived_at is null;
  if not found then return false; end if;
  v_missing:=p_value is null or p_value='null'::jsonb
    or (jsonb_typeof(p_value)='string' and btrim(p_value#>>'{}')='');
  if v_missing then return not v_col.is_required; end if;
  if v_col.validation_jsonb?'minLength' and (jsonb_typeof(p_value)<>'string' or char_length(p_value#>>'{}')<(v_col.validation_jsonb->>'minLength')::int) then return false; end if;
  if v_col.validation_jsonb?'maxLength' and (jsonb_typeof(p_value)<>'string' or char_length(p_value#>>'{}')>(v_col.validation_jsonb->>'maxLength')::int) then return false; end if;
  if v_col.validation_jsonb?'min' and (jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')::numeric<(v_col.validation_jsonb->>'min')::numeric) then return false; end if;
  if v_col.validation_jsonb?'max' and (jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')::numeric>(v_col.validation_jsonb->>'max')::numeric) then return false; end if;
  if v_col.validation_jsonb?'pattern' and (jsonb_typeof(p_value)<>'string' or not (p_value#>>'{}') ~ (v_col.validation_jsonb->>'pattern')) then return false; end if;
  if v_col.validation_jsonb?'allowedValues' and not (v_col.validation_jsonb->'allowedValues' @> jsonb_build_array(p_value)) then return false; end if;
  if v_col.validation_jsonb?'dateMin' and (jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')::timestamptz<(v_col.validation_jsonb->>'dateMin')::timestamptz) then return false; end if;
  if v_col.validation_jsonb?'dateMax' and (jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')::timestamptz>(v_col.validation_jsonb->>'dateMax')::timestamptz) then return false; end if;
  return true;
exception when invalid_regular_expression then return false;
end $$;

create or replace function public.enforce_board_column_value()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    if pg_trigger_depth()>1 then return old; end if;
    if not exists(select 1 from public.items where id=old.item_id and org_id=old.org_id) then return old; end if;
    if not public.board_column_value_is_valid(old.org_id,old.item_id,old.column_key,null) then
      raise exception 'required column value cannot be deleted' using errcode='23514';
    end if;
    return old;
  end if;
  if not public.board_column_value_is_valid(new.org_id,new.item_id,new.column_key,new.value_jsonb) then
    raise exception 'column value validation failed' using errcode='23514';
  end if;
  return new;
end $$;

drop trigger if exists bbe178_enforce_board_column_value on public.item_values;
create trigger bbe178_enforce_board_column_value before insert or update or delete on public.item_values
  for each row execute function public.enforce_board_column_value();

create or replace function public.enforce_required_values_on_item_create()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(
    select 1 from public.board_columns c
    where c.org_id=new.org_id and c.board_id=new.board_id and c.archived_at is null and c.is_required
      and not exists(select 1 from public.item_values v where v.org_id=new.org_id and v.item_id=new.id and v.column_key=c.key and public.board_column_value_is_valid(v.org_id,v.item_id,v.column_key,v.value_jsonb))
  ) then raise exception 'required column value missing' using errcode='23514'; end if;
  return new;
end $$;
drop trigger if exists bbe178_require_values_on_item_create on public.items;
create constraint trigger bbe178_require_values_on_item_create after insert on public.items
  deferrable initially deferred for each row execute function public.enforce_required_values_on_item_create();

create table if not exists public.board_item_create_receipts(
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id),
  payload_hash text not null,
  item_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(org_id,request_id)
);
alter table public.board_item_create_receipts enable row level security;
create policy board_item_create_receipt_actor_read on public.board_item_create_receipts
  for select to authenticated using(actor_id=auth.uid() and public.is_org_member(org_id));

create or replace function public.create_board_item_with_values(
  p_org_id uuid,p_board_id uuid,p_group_id uuid,p_title text,p_assigned_to uuid,
  p_values jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_hash text; v_prior public.board_item_create_receipts; v_item uuid; v_key text; v_value jsonb; v_role text; v_scope text;
begin
  if v_actor is null or p_request_id is null or jsonb_typeof(coalesce(p_values,'{}'))<>'object' then raise exception 'invalid item create' using errcode='22023'; end if;
  if not public.is_org_member(p_org_id) or not public.effective_permission(p_org_id,'work.item_upsert') then raise exception 'item create permission denied' using errcode='42501'; end if;
  select role::text,scope::text into v_role,v_scope from public.org_members where org_id=p_org_id and user_id=v_actor and status='active';
  if not exists(select 1 from public.boards where id=p_board_id and org_id=p_org_id) then raise exception 'board not found' using errcode='P0002'; end if;
  if p_group_id is not null and not exists(select 1 from public.board_groups where id=p_group_id and board_id=p_board_id and org_id=p_org_id) then raise exception 'group not found' using errcode='P0002'; end if;
  if p_assigned_to is not null and not exists(select 1 from public.org_members where org_id=p_org_id and user_id=p_assigned_to and status='active') then raise exception 'assignee not active' using errcode='42501'; end if;
  if v_role not in ('owner','admin') and v_scope<>'all' and p_assigned_to is distinct from v_actor then raise exception 'assignment scope denied' using errcode='42501'; end if;
  v_hash:=encode(digest(concat_ws(':',p_board_id,p_group_id,p_title,p_assigned_to,coalesce(p_values,'{}')::text),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.board_item_create_receipts where org_id=p_org_id and request_id=p_request_id;
  if found then if v_prior.actor_id<>v_actor or v_prior.payload_hash<>v_hash then raise exception 'request_id payload mismatch' using errcode='22023'; end if; return jsonb_build_object('accepted',true,'replayed',true,'itemId',v_prior.item_id); end if;
  if exists(select 1 from public.board_columns c where c.org_id=p_org_id and c.board_id=p_board_id and c.archived_at is null and c.is_required and not (coalesce(p_values,'{}')?c.key)) then raise exception 'required column value missing' using errcode='23514'; end if;
  insert into public.items(org_id,board_id,group_id,title,assigned_to,sort_order) values(p_org_id,p_board_id,p_group_id,nullif(btrim(p_title),''),p_assigned_to,(select coalesce(max(sort_order),-1)+1 from public.items where org_id=p_org_id and board_id=p_board_id)) returning id into v_item;
  for v_key,v_value in select key,value from jsonb_each(coalesce(p_values,'{}')) loop
    insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,v_item,v_key,v_value);
  end loop;
  insert into public.board_item_create_receipts values(p_org_id,p_request_id,v_actor,v_hash,v_item,now());
  return jsonb_build_object('accepted',true,'replayed',false,'itemId',v_item);
end $$;

create or replace function public.dispatch_due_board_column_date_schedules(p_limit integer default 50)
returns table(schedule_id uuid,inserted boolean) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row public.board_column_date_schedules; v_inserted integer;
begin
  for v_row in select s.* from public.board_column_date_schedules s where s.status='scheduled' and s.scheduled_for<=clock_timestamp() order by s.scheduled_for for update of s skip locked limit greatest(1,least(coalesce(p_limit,50),100)) loop
    if not exists(select 1 from public.org_members m join public.orgs o on o.id=m.org_id where m.org_id=v_row.org_id and m.user_id=v_row.target_user_id and m.status='active' and o.status='active') then
      update public.board_column_date_schedules set status='cancelled',cancelled_at=now(),updated_at=now() where id=v_row.id and status='scheduled';
      schedule_id:=v_row.id; inserted:=false; return next; continue;
    end if;
    update public.board_column_date_schedules set status='claimed',updated_at=now() where id=v_row.id and status='scheduled';
    insert into public.notifications(org_id,user_id,type,title,body,target_type,target_id,actor_id,is_action,dedupe_key)
      values(v_row.org_id,v_row.target_user_id,'date_schedule',case v_row.kind when 'deadline' then '마감 일정이 도착했습니다' when 'reminder' then '예약한 알림이 도착했습니다' else '날짜 알림이 도착했습니다' end,null,'item',v_row.item_id,v_row.created_by,false,'board-date-schedule:'||v_row.id::text)
      on conflict(org_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_inserted=row_count;
    update public.board_column_date_schedules set status='fired',updated_at=now() where id=v_row.id and status='claimed';
    schedule_id:=v_row.id; inserted:=v_inserted=1; return next;
  end loop;
end $$;

do $$ declare v_parent record; begin
  if not exists(select 1 from pg_roles where rolname='moawork_date_schedule_worker') then
    create role moawork_date_schedule_worker login password null nobypassrls noinherit;
  end if;
  if exists(
    select 1 from pg_roles where rolname='moawork_date_schedule_worker'
      and (rolsuper or rolinherit or rolcreaterole or rolcreatedb or rolreplication or rolbypassrls or not rolcanlogin)
  ) then
    raise exception 'moawork_date_schedule_worker has unsafe role attributes';
  end if;
  for v_parent in
    select parent.rolname
    from pg_auth_members membership
    join pg_roles member on member.oid=membership.member
    join pg_roles parent on parent.oid=membership.roleid
    where member.rolname='moawork_date_schedule_worker'
  loop
    execute format('revoke %I from moawork_date_schedule_worker',v_parent.rolname);
  end loop;
end $$;

revoke all on function public.board_column_value_is_valid(uuid,uuid,text,jsonb),public.create_board_item_with_values(uuid,uuid,uuid,text,uuid,jsonb,uuid),public.dispatch_due_board_column_date_schedules(integer) from public,anon,authenticated,service_role,moawork_outbox_worker,moawork_date_schedule_worker;
grant execute on function public.create_board_item_with_values(uuid,uuid,uuid,text,uuid,jsonb,uuid) to authenticated;
grant execute on function public.dispatch_due_board_column_date_schedules(integer) to moawork_date_schedule_worker;
revoke all on public.board_item_create_receipts from public,anon,authenticated,service_role;
grant select on public.board_item_create_receipts to authenticated;

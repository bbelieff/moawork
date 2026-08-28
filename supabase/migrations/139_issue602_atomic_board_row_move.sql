-- moa-migration-guard: logical_key=139_issue602_atomic_board_row_move predecessor=138_issue605_board_summary_settings digest=37d0c23509e9a7870144d78abbf06c25688908b537858f1907aa7449d79e03f6 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '139_issue602_atomic_board_row_move',
  p_file_name => '139_issue602_atomic_board_row_move.sql',
  p_file_digest => '37d0c23509e9a7870144d78abbf06c25688908b537858f1907aa7449d79e03f6',
  p_expected_predecessor => '138_issue605_board_summary_settings',
  p_executor => 'DG-03',
  p_thread_id => '01a02046-56a7-76c3-8b1f-08a71a7e557a',
  p_foundation => false
);

-- A NOLOGIN/BYPASSRLS owner is the unforgeable execution identity for row-order writes.
-- Existing postgres-owned SECURITY DEFINER functions therefore remain outside this boundary.
do $$
begin
  if current_user<>'postgres'
     or current_setting('server_version_num')::integer not between 170000 and 179999
     or not exists(select 1 from pg_roles where rolname='postgres' and not rolsuper and rolcreaterole and rolbypassrls)
     or not exists(select 1 from pg_roles where oid=10 and rolname='supabase_admin' and rolsuper) then
    raise exception 'unsupported issue602 migration executor' using errcode='42501';
  end if;
  if not exists(select 1 from pg_roles where rolname='moawork_row_order_writer') then
    create role moawork_row_order_writer nologin noinherit bypassrls;
  end if;
end $$;
-- PostgreSQL requires the migration runner to be able to SET ROLE before it may
-- transfer function ownership. Keep that capability only for this transaction.
-- PostgreSQL 17 also retains the creator-admin grant made by the bootstrap
-- superuser; the terminal self-audit proves that unavoidable row is inert and
-- is the writer's only membership.
do $$
begin
  execute format('grant moawork_row_order_writer to %I with set true, inherit false',current_user);
end $$;
revoke moawork_row_order_writer from anon,authenticated,service_role;
grant usage,create on schema public to moawork_row_order_writer;
grant usage on schema auth to moawork_row_order_writer;
grant execute on function auth.uid() to moawork_row_order_writer;
grant execute on function public.effective_permission(uuid,text) to moawork_row_order_writer;
grant execute on function public.board_column_value_editable(uuid,uuid,text) to moawork_row_order_writer;
grant execute on function public.board_column_value_is_valid(uuid,uuid,text,jsonb) to moawork_row_order_writer;

alter table public.boards add column row_order_version bigint not null default 0;
revoke update(row_order_version) on table public.boards from public,anon,authenticated,service_role;

create or replace function public.guard_board_row_order_version_direct_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'moawork_row_order_writer' then
    raise exception 'board row order version is RPC-only' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_board_row_order_version_direct_write() from public,anon,authenticated,service_role;

create trigger boards_row_order_version_rpc_only
before update of row_order_version on public.boards
for each row execute function public.guard_board_row_order_version_direct_write();

-- Row position is an RPC-owned invariant. Keep every unrelated item field writable through
-- the existing RLS path, but remove table-wide UPDATE before granting the non-position columns.
revoke update on table public.items from public,anon,authenticated,service_role;
do $$
declare v_columns text;
begin
  select string_agg(format('%I',a.attname),',' order by a.attnum) into v_columns
    from pg_attribute a
   where a.attrelid='public.items'::regclass and a.attnum>0 and not a.attisdropped
     and a.attname not in ('board_id','group_id','sort_order');
  if v_columns is null then raise exception 'items columns unavailable'; end if;
  execute format('grant update(%s) on table public.items to anon,authenticated,service_role',v_columns);
end $$;

create or replace function public.guard_board_row_position_direct_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'moawork_row_order_writer' then
    raise exception 'board row position is RPC-only' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_board_row_position_direct_write() from public,anon,authenticated,service_role;

create trigger items_row_position_rpc_only
before update of board_id,group_id,sort_order on public.items
for each row execute function public.guard_board_row_position_direct_write();

create table public.board_row_move_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id,request_id)
);
alter table public.board_row_move_requests enable row level security;
alter table public.board_row_move_requests force row level security;
revoke all on table public.board_row_move_requests from public,anon,authenticated,service_role;
grant select,insert on table public.board_row_move_requests to moawork_row_order_writer;
grant select on table public.orgs,public.org_members,public.boards,public.board_groups,public.items,public.board_columns to moawork_row_order_writer;
grant update(row_order_version,updated_at) on table public.boards to moawork_row_order_writer;
grant update(board_id,group_id,sort_order,updated_at) on table public.items to moawork_row_order_writer;
grant select,insert on table public.item_values to moawork_row_order_writer;
grant update(value_jsonb) on table public.item_values to moawork_row_order_writer;
grant update(sort_order) on table public.board_columns to moawork_row_order_writer;

-- The outer value+move RPC is reachable from the Data API, so it must enforce the same
-- canonical cell boundary as BoardsService before entering either mutation. The existing
-- frontier validator remains authoritative for required/custom validation. This private
-- adapter adds editability and canonical persisted JSON/type/option checks that the app
-- normally performs before calling the repository.
create or replace function public.issue602_board_cell_value_is_valid(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_column_key text,
  p_value jsonb
) returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_col public.board_columns;
  v_type text;
  v_text text;
  v_options jsonb;
  v_numeric numeric;
  v_double double precision;
begin
  select c.* into v_col
    from public.items i
    join public.boards b on b.id=i.board_id and b.org_id=i.org_id
    join public.board_columns c on c.org_id=i.org_id and c.board_id=i.board_id
      and c.key=p_column_key and c.archived_at is null
   where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id
     and b.id=p_board_id and b.org_id=p_org_id and not b.is_system
   for share of i,b,c;
  if not found or v_col.is_readonly or v_col.source::text='calc'
     or not public.board_column_value_editable(p_org_id,p_item_id,p_column_key)
     or not public.board_column_value_is_valid(p_org_id,p_item_id,p_column_key,p_value) then
    return false;
  end if;
  if p_value is null or p_value='null'::jsonb then return true; end if;

  v_type:=v_col.type::text;
  if v_type in ('text','longtext','phone','email','url','date','datetime','select','status') then
    if jsonb_typeof(p_value)<>'string' then return false; end if;
    v_text:=p_value#>>'{}';
    if v_text='' or v_text<>btrim(v_text)
       or (v_type='text' and char_length(v_text)>500)
       or (v_type='longtext' and char_length(v_text)>20000)
       or (v_type='phone' and (
         v_text !~ '^[0-9]+$'
         or (left(v_text,1)='0' and char_length(v_text) not between 9 and 11)
         or (left(v_text,1)<>'0' and char_length(v_text) not between 8 and 15)
         or (v_text like '0082%' and char_length(v_text)>12)
         or (v_text like '082%' and char_length(v_text)>11)
         or (v_text like '82%' and char_length(v_text)>11)
       ))
       or (v_type='email' and (char_length(v_text)>200 or v_text !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
       or (v_type='url' and (char_length(v_text)>2000 or v_text !~* '^https?://[^[:space:]]+$')) then
      return false;
    end if;
    if v_type='date' then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(v_text::date,'YYYY-MM-DD')<>v_text then return false; end if;
    elsif v_type='datetime' then
      if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
         or to_char(v_text::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>v_text then
        return false;
      end if;
    elsif v_type='email' then
      if v_text<>lower(v_text) then return false; end if;
    elsif v_type in ('select','status') then
      v_options:=coalesce(v_col.options_jsonb->'options',v_col.options_jsonb);
      if jsonb_typeof(v_options)='array' and jsonb_array_length(v_options)>0 and not exists(
        select 1 from jsonb_array_elements(v_options) option
         where option->>'id'=v_text and not coalesce((option->>'archived')::boolean,false)
      ) then return false; end if;
    end if;
  elsif v_type in ('number','money') then
    if jsonb_typeof(p_value)<>'number' then return false; end if;
    v_numeric:=(p_value#>>'{}')::numeric;
    v_double:=(p_value#>>'{}')::double precision;
    if p_value is distinct from to_jsonb(v_double) then return false; end if;
  elsif v_type='checkbox' then
    if jsonb_typeof(p_value)<>'boolean' then return false; end if;
  elsif v_type in ('multiselect','people') then
    if jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)=0 or exists(
      select 1 from jsonb_array_elements(p_value) element
       where jsonb_typeof(element)<>'string' or element#>>'{}'=''
    ) then return false; end if;
    if jsonb_array_length(p_value)<>(select count(distinct element#>>'{}') from jsonb_array_elements(p_value) element) then return false; end if;
    if v_type='multiselect' then
      v_options:=coalesce(v_col.options_jsonb->'options',v_col.options_jsonb);
      if jsonb_typeof(v_options)='array' and jsonb_array_length(v_options)>0 and exists(
        select 1 from jsonb_array_elements(p_value) element where not exists(
          select 1 from jsonb_array_elements(v_options) option
           where option->>'id'=element#>>'{}' and not coalesce((option->>'archived')::boolean,false)
        )
      ) then return false; end if;
    end if;
  elsif v_type='person' then
    if jsonb_typeof(p_value)<>'string' and not (
      jsonb_typeof(p_value)='array' and jsonb_array_length(p_value)>0 and not exists(
        select 1 from jsonb_array_elements(p_value) element
         where jsonb_typeof(element)<>'string' or element#>>'{}'=''
      )
    ) then return false; end if;
    if jsonb_typeof(p_value)='string' and p_value#>>'{}'='' then return false; end if;
  elsif v_type='file' then
    if jsonb_typeof(p_value)<>'array' or jsonb_array_length(p_value)=0 or exists(
      select 1 from jsonb_array_elements(p_value) element
       where jsonb_typeof(element)<>'object'
          or (select count(*) from jsonb_object_keys(element))<>4
          or not (element ?& array['path','name','size','mime'])
          or jsonb_typeof(element->'path')<>'string' or nullif(element->>'path','') is null
          or jsonb_typeof(element->'name')<>'string'
          or jsonb_typeof(element->'size')<>'number'
          or jsonb_typeof(element->'mime')<>'string'
    ) then return false; end if;
  elsif v_type='calc' then
    return false;
  elsif v_type='other_info' then
    -- The exact versioned object contract is owned by board_column_value_is_valid.
    return true;
  else
    return false;
  end if;
  return true;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return false;
end;
$$;
revoke all on function public.issue602_board_cell_value_is_valid(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
alter function public.issue602_board_cell_value_is_valid(uuid,uuid,uuid,text,jsonb) owner to moawork_row_order_writer;

-- Existing trusted automations and installers run as postgres-owned SECURITY DEFINER
-- functions. They may request a move only through this private, owner-isolated helper;
-- direct UPDATE remains rejected by the trigger above. The helper intentionally has no
-- Data API grant and performs the same whole-board ordering/version invariant.
create or replace function public.issue602_move_board_item_private(
  p_org_id uuid,
  p_item_id uuid,
  p_expected_source_board_id uuid,
  p_expected_source_group_id uuid,
  p_target_board_id uuid,
  p_target_group_id uuid,
  p_before_item_id uuid,
  p_target_position integer default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_board_id uuid;
  v_source_group_id uuid;
  v_target_version bigint;
  v_source_ids uuid[]:='{}'::uuid[];
  v_target_ids uuid[]:='{}'::uuid[];
  v_original_target_ids uuid[]:='{}'::uuid[];
  v_at integer;
begin
  if p_org_id is null or p_item_id is null or p_expected_source_board_id is null
     or p_target_board_id is null or p_target_group_id is null then
    raise exception 'trusted row move input required' using errcode='22023';
  end if;
  if p_before_item_id=p_item_id then
    raise exception 'trusted row move self target' using errcode='22023';
  end if;
  if p_before_item_id is not null and p_target_position is not null then
    raise exception 'trusted row move has competing positions' using errcode='22023';
  end if;
  if p_target_position is not null and p_target_position<0 then
    raise exception 'trusted row move position invalid' using errcode='22023';
  end if;

  -- One tenant-scoped lock makes multi-board trusted moves deadlock-free.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':trusted-row-order',0));
  select i.board_id,i.group_id into v_source_board_id,v_source_group_id
    from public.items i
   where i.id=p_item_id and i.org_id=p_org_id and i.deleted_at is null
   for update;
  if not found or v_source_board_id<>p_expected_source_board_id
     or v_source_group_id is distinct from p_expected_source_group_id then
    raise exception 'trusted row move source changed' using errcode='40001';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_target_board_id and b.org_id=p_org_id)
     or not exists(select 1 from public.board_groups g where g.id=p_target_group_id and g.org_id=p_org_id and g.board_id=p_target_board_id) then
    raise exception 'trusted row move target unavailable' using errcode='22023';
  end if;
  if p_before_item_id is not null and not exists(
    select 1 from public.items i where i.id=p_before_item_id and i.org_id=p_org_id
      and i.board_id=p_target_board_id and i.group_id=p_target_group_id and i.deleted_at is null
  ) then raise exception 'trusted row move anchor unavailable' using errcode='22023'; end if;

  perform 1 from public.boards b where b.org_id=p_org_id
    and b.id in (v_source_board_id,p_target_board_id) order by b.id for update;
  perform 1 from public.items i where i.org_id=p_org_id and i.deleted_at is null
    and ((i.board_id=v_source_board_id and i.group_id is not distinct from v_source_group_id)
      or (i.board_id=p_target_board_id and i.group_id=p_target_group_id))
    order by i.board_id,i.group_id nulls first,i.sort_order,i.id for update;

  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_original_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_target_board_id
      and i.group_id=p_target_group_id and i.deleted_at is null;
  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_target_board_id
      and i.group_id=p_target_group_id and i.deleted_at is null and i.id<>p_item_id;
  if p_target_position is not null then v_at:=least(p_target_position,cardinality(v_target_ids))+1;
  elsif p_before_item_id is null then v_at:=cardinality(v_target_ids)+1;
  else v_at:=array_position(v_target_ids,p_before_item_id); end if;
  if v_at is null then raise exception 'trusted row move anchor unavailable' using errcode='22023'; end if;
  v_target_ids:=coalesce(v_target_ids[1:v_at-1],'{}'::uuid[])||array[p_item_id]||coalesce(v_target_ids[v_at:cardinality(v_target_ids)],'{}'::uuid[]);

  if v_source_board_id=p_target_board_id
     and v_source_group_id is not distinct from p_target_group_id
     and v_target_ids=v_original_target_ids then
    select b.row_order_version into v_target_version from public.boards b
     where b.id=p_target_board_id and b.org_id=p_org_id;
    return v_target_version;
  end if;
  if v_source_board_id<>p_target_board_id or v_source_group_id is distinct from p_target_group_id then
    select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_source_ids
      from public.items i where i.org_id=p_org_id and i.board_id=v_source_board_id
        and i.group_id is not distinct from v_source_group_id and i.deleted_at is null and i.id<>p_item_id;
  end if;

  update public.items i set board_id=p_target_board_id,group_id=p_target_group_id,
      sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
    from unnest(v_target_ids) with ordinality ordered(id,ordinality)
   where i.id=ordered.id and i.org_id=p_org_id;
  if v_source_board_id<>p_target_board_id or v_source_group_id is distinct from p_target_group_id then
    update public.items i set sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
      from unnest(v_source_ids) with ordinality ordered(id,ordinality)
     where i.id=ordered.id and i.org_id=p_org_id and i.board_id=v_source_board_id;
  end if;
  update public.boards b set row_order_version=b.row_order_version+1,updated_at=clock_timestamp()
   where b.org_id=p_org_id and b.id in (v_source_board_id,p_target_board_id);
  select b.row_order_version into v_target_version from public.boards b
   where b.id=p_target_board_id and b.org_id=p_org_id;
  return v_target_version;
end;
$$;
revoke all on function public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
alter function public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer) owner to moawork_row_order_writer;
set role moawork_row_order_writer;
grant execute on function public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer) to postgres;
reset role;

-- Definition installers receive a narrow server-owned reconciliation command instead of
-- borrowing the user row-reorder RPC. The board source, manager scope and exact source
-- group are recomputed before the private helper is entered.
create or replace function public.reconcile_board_definition_item_group(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_expected_source_group_id uuid,
  p_target_group_id uuid
) returns bigint
language plpgsql security definer set search_path=''
as $$
declare v_actor uuid:=auth.uid();v_role text;v_scope text;v_source text;
begin
  select m.role::text,m.scope::text into v_role,v_scope from public.org_members m
    join public.orgs o on o.id=m.org_id where m.org_id=p_org_id and m.user_id=v_actor
      and m.status='active' and o.status='active';
  select b.source into v_source from public.boards b
   where b.id=p_board_id and b.org_id=p_org_id and not b.is_system;
  if v_actor is null or v_role is null or not (v_role in ('owner','admin') or v_scope='all')
     or not (v_source like 'core.default-tab/%' or v_source like 'pack.%/%') then
    raise exception 'definition group reconciliation denied' using errcode='42501';
  end if;
  return public.issue602_move_board_item_private(
    p_org_id,p_item_id,p_board_id,p_expected_source_group_id,p_board_id,p_target_group_id,null
  );
end;
$$;
alter function public.reconcile_board_definition_item_group(uuid,uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.reconcile_board_definition_item_group(uuid,uuid,uuid,uuid,uuid) from public,anon,service_role;
grant execute on function public.reconcile_board_definition_item_group(uuid,uuid,uuid,uuid,uuid) to authenticated;

-- Preserve the trusted automation API, but route its validated position write through
-- the private invariant owner. The surrounding request/condition transaction is unchanged.
do $migration$
begin
if to_regprocedure('public.execute_trusted_board_automation(text)') is not null then
execute $ddl$
create or replace function public.execute_trusted_board_automation(p_execution_key text)
returns table(status text, error_code text, visited_rule_ids jsonb)
language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  request_row public.board_automation_execution_requests%rowtype;
  rule_row public.board_automation_rules%rowtype;
  status_value jsonb; next_trace jsonb; result jsonb; failure_code text;
begin
  if nullif(btrim(p_execution_key), '') is null then
    return query select 'rejected'::text, 'malformed'::text, '[]'::jsonb; return;
  end if;
  select * into request_row from public.board_automation_execution_requests
   where execution_key=p_execution_key for update;
  if not found then return query select 'rejected'::text,'missing'::text,'[]'::jsonb; return; end if;
  if request_row.state<>'pending' then
    return query select 'duplicate'::text,coalesce(request_row.outcome->>'error_code',request_row.state),request_row.visited_rule_ids; return;
  end if;
  begin
    select rule.* into rule_row from public.board_automation_rules rule
      join public.items item on item.id=request_row.item_id
      join public.board_groups target on target.id=rule.to_group_id
     where rule.id=request_row.rule_id and rule.enabled and rule.org_id=request_row.org_id
       and item.org_id=request_row.org_id and item.board_id=rule.board_id
       and target.org_id=request_row.org_id and target.board_id=rule.board_id;
    if not found then raise exception 'trusted automation scope is no longer valid' using errcode='23514'; end if;
    select value_jsonb into status_value from public.item_values
     where item_id=request_row.item_id and org_id=request_row.org_id and column_key=rule_row.status_column_key;
    if request_row.visited_rule_ids ? rule_row.id::text or jsonb_array_length(request_row.visited_rule_ids)>=32 then
      result:=jsonb_build_object('status','blocked','error_code','automation_loop_blocked');
      update public.board_automation_execution_requests set state='blocked',outcome=result,terminal_at=now()
       where execution_key=request_row.execution_key;
      return query select 'blocked'::text,'automation_loop_blocked'::text,request_row.visited_rule_ids; return;
    end if;
    if request_row.source_column_key is distinct from rule_row.status_column_key
       or request_row.source_label_id is distinct from rule_row.trigger_label_id
       or coalesce(status_value->>'label_id','') is distinct from rule_row.trigger_label_id
       or exists(
         select 1 from jsonb_array_elements(rule_row.conditions) condition
         left join lateral (
           select value_jsonb from public.item_values where item_id=request_row.item_id
             and org_id=request_row.org_id and column_key=condition->>'column_key'
         ) current_value on true
         where not public.automation_condition_matches(current_value.value_jsonb,condition)
       ) then
      next_trace:=request_row.visited_rule_ids;
      result:=jsonb_build_object('status','blocked','error_code','status_or_condition_not_current');
      update public.board_automation_execution_requests set state='blocked',outcome=result,terminal_at=now()
       where execution_key=request_row.execution_key;
      return query select 'blocked'::text,'status_or_condition_not_current'::text,next_trace; return;
    end if;
    next_trace:=request_row.visited_rule_ids||jsonb_build_array(rule_row.id::text);
    perform public.issue602_move_board_item_private(
      request_row.org_id,request_row.item_id,rule_row.board_id,request_row.from_group_id,
      rule_row.board_id,rule_row.to_group_id,null
    );
    result:=jsonb_build_object('status','succeeded');
    update public.board_automation_execution_requests
       set state='succeeded',outcome=result,terminal_at=now(),visited_rule_ids=next_trace
     where execution_key=request_row.execution_key;
    return query select 'succeeded'::text,null::text,next_trace;
  exception when others then
    get stacked diagnostics failure_code=returned_sqlstate;
    update public.board_automation_execution_requests
       set state='failed',outcome=jsonb_build_object('status','failed','error_code',failure_code),terminal_at=now()
     where execution_key=request_row.execution_key;
    return query select 'failed'::text,failure_code,request_row.visited_rule_ids;
  end;
end
$function$;
$ddl$;
end if;
end
$migration$;

-- The canonical new-lead transition may cross boards. Its deal transition remains
-- unchanged; the item relocation now normalizes both source and destination ordering.
do $migration$
begin
if to_regprocedure('public.advance_new_lead_to_contact(uuid,uuid)') is not null then
execute $ddl$
create or replace function public.advance_new_lead_to_contact(p_item_id uuid,p_request_id uuid)
returns table(status text,deal_id uuid,company_id uuid,reason text)
language plpgsql security definer set search_path='' as $function$
declare
  v_actor uuid:=auth.uid(); v_org uuid; v_deal uuid; v_assigned uuid; v_source text;
  v_source_board uuid; v_source_group uuid; v_role text; v_scope text; v_destination uuid;
  v_destination_count bigint; v_group uuid; v_status text; v_company uuid; v_reason text;
  v_existing public.contact_pipeline_transitions%rowtype;
begin
  if v_actor is null then raise exception 'new lead advance denied' using errcode='42501'; end if;
  select i.org_id,i.deal_id,i.assigned_to,b.source,i.board_id,i.group_id
    into v_org,v_deal,v_assigned,v_source,v_source_board,v_source_group
    from public.items i join public.boards b on b.org_id=i.org_id and b.id=i.board_id
   where i.id=p_item_id and i.deleted_at is null for update of i;
  if not found or v_deal is null then raise exception 'new lead item unavailable' using errcode='22023'; end if;
  select m.role::text,m.scope::text into v_role,v_scope from public.org_members m
    join public.orgs o on o.id=m.org_id where m.org_id=v_org and m.user_id=v_actor
      and m.status='active' and o.status='active';
  if not found or not public.effective_permission(v_org,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'new lead advance denied' using errcode='42501';
  end if;
  select count(*),(array_agg(b.id order by b.id))[1] into v_destination_count,v_destination
    from public.boards b where b.org_id=v_org and b.source='core.default-tab/contact';
  if v_destination_count<>1 then raise exception 'contact destination unavailable' using errcode='22023'; end if;
  select g.id into v_group from public.board_groups g where g.org_id=v_org and g.board_id=v_destination
   order by g.sort_order,g.id limit 1;
  if v_group is null then raise exception 'contact destination group unavailable' using errcode='22023'; end if;
  select * into v_existing from public.contact_pipeline_transitions t where t.org_id=v_org and t.request_id=p_request_id;
  if found then
    if v_existing.kind<>'lead_to_contact' or v_existing.deal_id is distinct from v_deal
       or (v_existing.source_item_id is not null and v_existing.source_item_id<>p_item_id) then
      raise exception 'transition request target mismatch' using errcode='22023';
    end if;
    if v_existing.status='committed' then
      if v_source<>'core.default-tab/contact' then raise exception 'committed transition destination mismatch' using errcode='22023'; end if;
      return query select v_existing.status,v_existing.deal_id,
        (select d.company_id from public.deals d where d.org_id=v_org and d.id=v_deal),null::text;
      return;
    end if;
  end if;
  if v_source<>'core.default-tab/new-lead' then raise exception 'new lead source unavailable' using errcode='22023'; end if;
  select t.status,t.deal_id,t.company_id,t.reason into v_status,v_deal,v_company,v_reason
    from public.advance_new_lead_to_contact(v_org,v_deal,p_request_id) t;
  if v_status='committed' then
    update public.contact_pipeline_transitions t set source_item_id=p_item_id
     where t.org_id=v_org and t.request_id=p_request_id;
    perform public.issue602_move_board_item_private(v_org,p_item_id,v_source_board,v_source_group,v_destination,v_group,null);
  end if;
  return query select v_status,v_deal,v_company,v_reason;
end
$function$;
$ddl$;
end if;
end
$migration$;

-- Notice-tab repair retains its additive schema contract. Duplicate/legacy groups are
-- drained item-by-item through the private move helper before deletion.
do $migration$
begin
if to_regprocedure('public.bbe151_ensure_notice_tab(uuid)') is not null then
execute $ddl$
create or replace function public.bbe151_ensure_notice_tab(p_org_id uuid)
returns table(board_id uuid,created boolean)
language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_actor uuid:=auth.uid(); v_board uuid; v_created boolean:=false;
  v_completed uuid; v_default_group uuid; v_move record;
begin
  if v_actor is null or not public.is_org_member(p_org_id) then raise exception 'organization membership required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':core.default-tab/notice',0));
  select id into v_board from public.boards where org_id=p_org_id and source='core.default-tab/notice';
  if v_board is null then
    insert into public.boards(org_id,name,description,icon,source,sort_order,created_by)
    values(p_org_id,'공지사항','공문과 지원사업 공지를 그룹별로 관리합니다.','📢','core.default-tab/notice',(select count(*) from public.boards where org_id=p_org_id),v_actor)
    returning id into v_board; v_created:=true;
  end if;
  update public.boards set name='공지사항',description='공문과 지원사업 공지를 그룹별로 관리합니다.',icon='📢',is_system=false,source='core.default-tab/notice',updated_at=now() where id=v_board;
  insert into public.board_groups(org_id,board_id,name,color,sort_order)
    select p_org_id,v_board,x.name,x.color,x.ord from (values
      ('📂 매 월 공문리뉴얼','#0073a8',0),('소상공인 직대 접수 대기 업체','#8348b8',1),('특례보증','#00796b',2),('지원사업','#fdab3d',3),('공지 완료','#ffcb00',4)
    ) x(name,color,ord) where not exists(select 1 from public.board_groups g where g.board_id=v_board and g.name=x.name);
  update public.board_groups g set color=x.color,sort_order=x.ord from (values
    ('📂 매 월 공문리뉴얼','#0073a8',0),('소상공인 직대 접수 대기 업체','#8348b8',1),('특례보증','#00796b',2),('지원사업','#fdab3d',3),('공지 완료','#ffcb00',4)
  ) x(name,color,ord) where g.board_id=v_board and g.name=x.name;
  select bg.id into v_default_group from public.board_groups bg where bg.board_id=v_board and bg.name='📂 매 월 공문리뉴얼' order by bg.id limit 1;
  select bg.id into v_completed from public.board_groups bg where bg.board_id=v_board and bg.name='공지 완료' order by bg.id limit 1;
  for v_move in
    with ranked as (
      select g.id,g.name,row_number() over(partition by g.name order by g.id) rn,first_value(g.id) over(partition by g.name order by g.id) keeper
      from public.board_groups g where g.board_id=v_board
    ), extras as (
      select r.id,case when r.name in ('📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료') then r.keeper else v_default_group end target
      from ranked r where r.rn>1 or r.name not in ('📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료')
    ) select i.id item_id,i.group_id source_group,e.target target_group
      from public.items i join extras e on e.id=i.group_id
     where i.org_id=p_org_id and i.board_id=v_board order by i.sort_order,i.id
  loop
    perform public.issue602_move_board_item_private(p_org_id,v_move.item_id,v_board,v_move.source_group,v_board,v_move.target_group,null);
  end loop;
  with ranked as (
    select g.id,g.name,row_number() over(partition by g.name order by g.id) rn from public.board_groups g where g.board_id=v_board
  ) delete from public.board_groups g using ranked r where g.id=r.id and (r.rn>1 or r.name not in ('📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료'));
  insert into public.board_columns(org_id,board_id,key,label,type,source,options_jsonb,sort_order,width,right_pinned,move_rule_jsonb,is_readonly) values
    (p_org_id,v_board,'audience','대상','people','act',null,0,140,false,null,false),
    (p_org_id,v_board,'read_count','읽음','calc','calc',null,1,90,false,null,true),
    (p_org_id,v_board,'author','작성자','person','auto',null,2,110,false,null,true),
    (p_org_id,v_board,'official_pdf','공문PDF','file','in',null,3,130,false,null,false),
    (p_org_id,v_board,'summary','내용 정리','longtext','in',null,4,220,false,null,false),
    (p_org_id,v_board,'low_score_companies','점수 미달인 업체','select','in',null,5,150,false,null,false),
    (p_org_id,v_board,'tax_delinquent_companies','세금 미납인 업체','select','in',null,6,150,false,null,false),
    (p_org_id,v_board,'not_selected_companies','미선정 업체','select','in',null,7,140,false,null,false),
    (p_org_id,v_board,'status','상태','status','act','{"options":[{"id":"작업 중","label":"작업 중","order":0,"color":"#c4c4c4"},{"id":"공지완료","label":"공지완료","order":1,"color":"#ffcb00"}]}'::jsonb,8,110,true,jsonb_build_object('공지완료',v_completed::text),false),
    (p_org_id,v_board,'created_on','작성일','date','auto',null,9,120,false,null,true)
  on conflict on constraint board_columns_board_id_key_key do update set label=excluded.label,type=excluded.type,source=excluded.source,options_jsonb=excluded.options_jsonb,sort_order=excluded.sort_order,width=excluded.width,right_pinned=excluded.right_pinned,move_rule_jsonb=excluded.move_rule_jsonb,is_readonly=excluded.is_readonly;
  delete from public.board_columns c where c.board_id=v_board and c.key not in ('audience','read_count','author','official_pdf','summary','low_score_companies','tax_delinquent_companies','not_selected_companies','status','created_on');
  return query select v_board,v_created;
end
$function$;
$ddl$;
end if;
end
$migration$;

-- The contract-work command keeps its existing receipt/version/outbox transaction. Only
-- move_item delegates the position mutation to the private ordering invariant.
do $migration$
begin
if to_regprocedure('public.execute_work_management_command(uuid,uuid,uuid,text,integer,uuid,jsonb)') is not null then
execute $ddl$
create or replace function public.execute_work_management_command(
  p_org_id uuid,p_board_id uuid,p_item_id uuid,p_operation text,
  p_expected_version integer,p_request_id uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $function$
declare
  v_actor uuid:=auth.uid(); v_role public.member_role; v_scope public.member_scope;
  v_result jsonb; v_version integer:=0; v_group uuid; v_column uuid; v_item uuid;
  v_position integer; v_key text; v_value jsonb; v_source_group uuid;
begin
  if p_expected_version is null then raise exception 'expected work item version is required' using errcode='22004'; end if;
  if v_actor is null or p_org_id is null or p_board_id is null or p_request_id is null
     or not public.is_org_member(p_org_id) then raise exception 'active workspace membership required' using errcode='42501'; end if;
  if not exists(select 1 from public.boards where id=p_board_id and org_id=p_org_id and source='core.default-tab/contract-work')
    then raise exception 'contract work board not found' using errcode='P0002'; end if;
  select role,scope into strict v_role,v_scope from public.org_members
   where org_id=p_org_id and user_id=v_actor and status='active';
  select result_jsonb into v_result from public.work_command_receipts where org_id=p_org_id and request_id=p_request_id;
  if found then return v_result||jsonb_build_object('replayed',true); end if;
  if p_item_id is not null then
    if not exists(select 1 from public.items where id=p_item_id and org_id=p_org_id and board_id=p_board_id
      and (v_role in ('owner','admin') or v_scope='all' or assigned_to=v_actor))
      then raise exception 'work item permission denied' using errcode='42501'; end if;
    insert into public.work_item_versions(org_id,item_id) values(p_org_id,p_item_id) on conflict(item_id) do nothing;
    select version into v_version from public.work_item_versions where item_id=p_item_id for update;
    if v_version<>p_expected_version then raise exception 'stale work item version' using errcode='40001'; end if;
  elsif v_role not in ('owner','admin') then raise exception 'work structure permission denied' using errcode='42501'; end if;
  if v_role not in ('owner','admin') and p_operation='delete_item' then raise exception 'work item deletion permission denied' using errcode='42501'; end if;
  if v_role not in ('owner','admin') and p_operation='set_field'
     and not ((p_payload->>'field')=any(array['title','workflow_status','due_date','group_id','institution','product','visit_application_date','review_period','inspection_date','guidance','reapply_date','d180','d365','link','update_entry'])) then
    raise exception 'work field permission denied' using errcode='42501';
  end if;
  case p_operation
    when 'set_field' then
      v_key:=p_payload->>'field'; v_value:=p_payload->'value';
      if v_key='title' then update public.items set title=trim(both '"' from v_value::text),updated_at=now() where id=p_item_id;
      elsif v_key='assigned_to' then
        if v_role not in ('owner','admin') then raise exception 'assignment permission denied' using errcode='42501'; end if;
        if nullif(trim(both '"' from v_value::text),'') is not null and not exists(select 1 from public.org_members where org_id=p_org_id and user_id=nullif(trim(both '"' from v_value::text),'')::uuid and status='active') then raise exception 'assignee is not an active member' using errcode='42501'; end if;
        update public.items set assigned_to=nullif(trim(both '"' from v_value::text),'')::uuid,updated_at=now() where id=p_item_id;
      elsif v_key='workflow_status' then update public.work_item_versions set workflow_status=trim(both '"' from v_value::text) where item_id=p_item_id;
      else
        if not exists(select 1 from public.board_columns where org_id=p_org_id and board_id=p_board_id and key=v_key and not is_readonly) then raise exception 'mutable work column not found' using errcode='42501'; end if;
        insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,v_key,v_value)
          on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb;
      end if;
    when 'set_due_date' then update public.work_item_versions set due_date=nullif(p_payload->>'due_date','')::date where item_id=p_item_id;
    when 'append_update' then insert into public.work_item_updates(org_id,item_id,body,actor) values(p_org_id,p_item_id,p_payload->>'body',v_actor);
    when 'move_item' then
      if not (p_payload?'group_id') then raise exception 'target group is required' using errcode='22023'; end if;
      v_position:=case when p_payload?'position' then (p_payload->>'position')::integer else null end;
      if v_position is not null and v_position<0 then raise exception 'work row position invalid' using errcode='22023'; end if;
      select i.group_id into strict v_source_group from public.items i where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id;
      perform public.issue602_move_board_item_private(
        p_org_id,p_item_id,p_board_id,v_source_group,p_board_id,
        (p_payload->>'group_id')::uuid,null,v_position
      );
    when 'delete_item' then delete from public.items where id=p_item_id;
    when 'create_item' then
      if p_payload?'group_id' and not exists(select 1 from public.board_groups where id=(p_payload->>'group_id')::uuid and org_id=p_org_id and board_id=p_board_id) then raise exception 'target group not found' using errcode='P0002'; end if;
      insert into public.items(org_id,board_id,group_id,title,assigned_to,sort_order)
      values(p_org_id,p_board_id,nullif(p_payload->>'group_id','')::uuid,p_payload->>'name',v_actor,
        (select coalesce(max(sort_order),-1)+1 from public.items where board_id=p_board_id)) returning id into v_item;
      insert into public.work_item_versions(org_id,item_id) values(p_org_id,v_item);
    when 'create_group' then insert into public.board_groups(org_id,board_id,name,color,sort_order)
      values(p_org_id,p_board_id,p_payload->>'name','#579bfc',(select coalesce(max(sort_order),-1)+1 from public.board_groups where board_id=p_board_id));
    when 'rename_group' then update public.board_groups set name=p_payload->>'name' where id=(p_payload->>'group_id')::uuid and board_id=p_board_id and org_id=p_org_id;
    when 'delete_group' then delete from public.board_groups where id=(p_payload->>'group_id')::uuid and board_id=p_board_id and org_id=p_org_id;
    when 'reorder_group' then update public.board_groups set sort_order=(p_payload->>'position')::int where id=(p_payload->>'group_id')::uuid and board_id=p_board_id and org_id=p_org_id;
    when 'create_column' then
      v_key:='custom_'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
      insert into public.board_columns(org_id,board_id,key,label,type,source,sort_order)
      values(p_org_id,p_board_id,v_key,p_payload->>'name',case p_payload->>'kind' when 'amount' then 'money'::public.field_type when 'percent' then 'number'::public.field_type when 'year' then 'number'::public.field_type when 'system_date' then 'date'::public.field_type when 'date_range' then 'text'::public.field_type when 'virtual' then 'text'::public.field_type when 'title' then 'text'::public.field_type else (p_payload->>'kind')::public.field_type end,'in',(select coalesce(max(sort_order),-1)+1 from public.board_columns where board_id=p_board_id));
    when 'rename_column' then update public.board_columns set label=p_payload->>'name' where board_id=p_board_id and org_id=p_org_id and key=p_payload->>'column_key';
    when 'delete_column' then delete from public.board_columns where board_id=p_board_id and org_id=p_org_id and key=p_payload->>'column_key';
    when 'reorder_column' then update public.board_columns set sort_order=(p_payload->>'position')::int where board_id=p_board_id and org_id=p_org_id and key=p_payload->>'column_key';
    when 'save_personal_view' then insert into public.board_views(org_id,board_id,user_id,name,kind,filters_jsonb,shared)
      values(p_org_id,p_board_id,v_actor,p_payload->>'name',p_payload->>'kind',coalesce(p_payload->'predicate','{}'),false);
    else raise exception 'unsupported work operation';
  end case;
  if p_item_id is not null and p_operation<>'delete_item' then update public.work_item_versions set version=version+1,updated_at=now() where item_id=p_item_id returning version into v_version; end if;
  v_result:=jsonb_build_object('accepted',true,'replayed',false,'version',v_version);
  insert into public.work_command_receipts(org_id,request_id,actor,board_id,operation,result_jsonb) values(p_org_id,p_request_id,v_actor,p_board_id,p_operation,v_result);
  insert into public.work_command_outbox(org_id,request_id,board_id,item_id,event_type,payload,actor) values(p_org_id,p_request_id,p_board_id,case when p_operation='delete_item' then null else coalesce(p_item_id,v_item) end,'work.'||p_operation,p_payload,v_actor);
  insert into public.audit_logs(org_id,actor,action,target_type,target_id,meta) values(p_org_id,v_actor,'work.'||p_operation,'board',p_board_id,jsonb_build_object('request_id',p_request_id));
  return v_result;
end
$function$;
$ddl$;
end if;
end
$migration$;

create or replace function public.move_board_row_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_target_group_id uuid,
  p_before_item_id uuid,
  p_expected_version bigint,
  p_request_id uuid
) returns table(
  item_id uuid,
  target_group_id uuid,
  before_item_id uuid,
  version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_scope text;
  v_source_group uuid;
  v_version bigint;
  v_payload jsonb;
  v_prior public.board_row_move_requests%rowtype;
  v_source_ids uuid[]:='{}'::uuid[];
  v_target_ids uuid[]:='{}'::uuid[];
  v_original_target_ids uuid[]:='{}'::uuid[];
  v_at integer;
  v_result jsonb;
begin
  if v_actor is null or p_org_id is null or p_board_id is null or p_item_id is null
     or p_expected_version is null or p_expected_version<0 or p_request_id is null then
    raise exception 'row move input required' using errcode='22023';
  end if;
  if p_before_item_id is not null and p_before_item_id=p_item_id then
    raise exception 'row move self target' using errcode='22023';
  end if;
  select m.role::text,m.scope::text into v_role,v_scope
    from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null or not public.effective_permission(p_org_id,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all') then
    raise exception 'row move permission denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and not b.is_system) then
    raise exception 'board unavailable' using errcode='42501';
  end if;
  v_payload:=jsonb_build_object('board_id',p_board_id,'item_id',p_item_id,'target_group_id',p_target_group_id,'before_item_id',p_before_item_id,'expected_version',p_expected_version);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select r.* into v_prior from public.board_row_move_requests r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.board_id<>p_board_id or v_prior.payload<>v_payload then
      raise exception 'row move replay conflict' using errcode='22023';
    end if;
    return query select (v_prior.result->>'itemId')::uuid,
      nullif(v_prior.result->>'targetGroupId','')::uuid,
      nullif(v_prior.result->>'beforeItemId','')::uuid,
      (v_prior.result->>'version')::bigint,true;
    return;
  end if;

  if p_target_group_id is not null and not exists(
    select 1 from public.board_groups g where g.id=p_target_group_id and g.org_id=p_org_id and g.board_id=p_board_id
  ) then raise exception 'target group unavailable' using errcode='22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_board_id::text,0));
  select b.row_order_version into v_version from public.boards b
   where b.id=p_board_id and b.org_id=p_org_id and not b.is_system for update;
  if not found then raise exception 'board unavailable' using errcode='42501'; end if;
  if v_version<>p_expected_version then raise exception 'row move stale version' using errcode='40001'; end if;

  select i.group_id into v_source_group
    from public.items i
   where i.id=p_item_id and i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null
   for update;
  if not found then
    raise exception 'row move item unavailable' using errcode='42501';
  end if;
  if p_before_item_id is not null and not exists(
    select 1 from public.items i where i.id=p_before_item_id and i.org_id=p_org_id and i.board_id=p_board_id
      and i.deleted_at is null and i.group_id is not distinct from p_target_group_id
  ) then raise exception 'row move anchor unavailable' using errcode='22023'; end if;

  perform 1 from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null
    and (i.group_id is not distinct from v_source_group or i.group_id is not distinct from p_target_group_id)
    order by i.group_id nulls first,i.sort_order,i.id for update;
  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_original_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null
      and i.group_id is not distinct from p_target_group_id;
  select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_target_ids
    from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null
      and i.id<>p_item_id and i.group_id is not distinct from p_target_group_id;
  if p_before_item_id is null then v_at:=cardinality(v_target_ids)+1;
  else v_at:=array_position(v_target_ids,p_before_item_id); end if;
  if v_at is null then raise exception 'row move anchor unavailable' using errcode='22023'; end if;
  v_target_ids:=coalesce(v_target_ids[1:v_at-1],'{}'::uuid[])||array[p_item_id]||coalesce(v_target_ids[v_at:cardinality(v_target_ids)],'{}'::uuid[]);
  if v_source_group is not distinct from p_target_group_id and v_target_ids=v_original_target_ids then
    return query select p_item_id,p_target_group_id,p_before_item_id,v_version,false;
    return;
  end if;
  if v_source_group is distinct from p_target_group_id then
    select coalesce(array_agg(i.id order by i.sort_order,i.id),'{}'::uuid[]) into v_source_ids
      from public.items i where i.org_id=p_org_id and i.board_id=p_board_id and i.deleted_at is null
        and i.id<>p_item_id and i.group_id is not distinct from v_source_group;
  end if;

  update public.items i set group_id=p_target_group_id,sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
    from unnest(v_target_ids) with ordinality ordered(id,ordinality)
   where i.id=ordered.id and i.org_id=p_org_id and i.board_id=p_board_id;
  if v_source_group is distinct from p_target_group_id then
    update public.items i set sort_order=(ordered.ordinality-1)::integer,updated_at=clock_timestamp()
      from unnest(v_source_ids) with ordinality ordered(id,ordinality)
     where i.id=ordered.id and i.org_id=p_org_id and i.board_id=p_board_id;
  end if;
  v_version:=v_version+1;
  update public.boards set row_order_version=v_version,updated_at=clock_timestamp()
   where id=p_board_id and org_id=p_org_id;
  v_result:=jsonb_build_object('itemId',p_item_id,'targetGroupId',coalesce(p_target_group_id::text,''),'beforeItemId',coalesce(p_before_item_id::text,''),'version',v_version);
  insert into public.board_row_move_requests(org_id,request_id,board_id,actor_id,payload,result)
  values(p_org_id,p_request_id,p_board_id,v_actor,v_payload,v_result);
  return query select p_item_id,p_target_group_id,p_before_item_id,v_version,false;
end;
$$;

revoke all on function public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid) from public,anon,service_role;
grant execute on function public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid) to authenticated;
alter function public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid) owner to moawork_row_order_writer;

create or replace function public.set_board_item_values_with_atomic_move(
  p_org_id uuid,
  p_board_id uuid,
  p_item_id uuid,
  p_values jsonb,
  p_target_group_id uuid,
  p_before_item_id uuid,
  p_expected_version bigint,
  p_request_id uuid
) returns table(
  item_id uuid,
  target_group_id uuid,
  before_item_id uuid,
  version bigint,
  replayed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_move record;
  v_payload jsonb;
  v_prior public.board_row_move_requests%rowtype;
  v_result jsonb;
begin
  if v_actor is null or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'cell value object required' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('kind','value_move','board_id',p_board_id,'item_id',p_item_id,
    'target_group_id',p_target_group_id,'before_item_id',p_before_item_id,
    'expected_version',p_expected_version,'values',p_values);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select r.* into v_prior from public.board_row_move_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.actor_id<>v_actor or v_prior.board_id<>p_board_id or v_prior.payload<>v_payload then
      raise exception 'value move replay conflict' using errcode='22023';
    end if;
    return query select (v_prior.result->>'itemId')::uuid,
      nullif(v_prior.result->>'targetGroupId','')::uuid,
      nullif(v_prior.result->>'beforeItemId','')::uuid,
      (v_prior.result->>'version')::bigint,true;
    return;
  end if;

  if exists(
    select 1 from jsonb_each(p_values) value
     where value.key='' or not public.issue602_board_cell_value_is_valid(
       p_org_id,p_board_id,p_item_id,value.key,value.value
     )
  ) then raise exception 'cell value is not editable or valid' using errcode='22023'; end if;

  select * into v_move from public.move_board_row_atomic(
    p_org_id,p_board_id,p_item_id,p_target_group_id,p_before_item_id,
    p_expected_version,gen_random_uuid()
  );

  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select p_org_id,p_item_id,value.key,value.value from jsonb_each(p_values) value
  on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb;
  update public.items set updated_at=clock_timestamp()
   where id=p_item_id and org_id=p_org_id and board_id=p_board_id;

  v_result:=jsonb_build_object('itemId',v_move.item_id,'targetGroupId',coalesce(v_move.target_group_id::text,''),
    'beforeItemId',coalesce(v_move.before_item_id::text,''),'version',v_move.version);
  insert into public.board_row_move_requests(org_id,request_id,board_id,actor_id,payload,result)
  values(p_org_id,p_request_id,p_board_id,v_actor,v_payload,v_result);

  return query select v_move.item_id,v_move.target_group_id,v_move.before_item_id,
    v_move.version,v_move.replayed;
end;
$$;
revoke all on function public.set_board_item_values_with_atomic_move(uuid,uuid,uuid,jsonb,uuid,uuid,bigint,uuid) from public,anon,service_role;
grant execute on function public.set_board_item_values_with_atomic_move(uuid,uuid,uuid,jsonb,uuid,uuid,bigint,uuid) to authenticated;
alter function public.set_board_item_values_with_atomic_move(uuid,uuid,uuid,jsonb,uuid,uuid,bigint,uuid) owner to moawork_row_order_writer;

create or replace function public.reorder_board_columns_atomic(
  p_org_id uuid,
  p_board_id uuid,
  p_column_ids uuid[]
) returns setof public.board_columns
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or p_org_id is null or p_board_id is null or p_column_ids is null then
    raise exception 'column order input required' using errcode='22023';
  end if;
  if not public.effective_permission(p_org_id,'structure.column_manage')
     or not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and not b.is_system) then
    raise exception 'column order permission denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_board_id::text,602));
  if cardinality(p_column_ids)<>(select count(*) from public.board_columns c where c.org_id=p_org_id and c.board_id=p_board_id and c.archived_at is null)
     or cardinality(p_column_ids)<>(select count(distinct id) from unnest(p_column_ids) id)
     or exists(select 1 from unnest(p_column_ids) requested(id) where not exists(select 1 from public.board_columns c where c.id=requested.id and c.org_id=p_org_id and c.board_id=p_board_id and c.archived_at is null)) then
    raise exception 'column order mismatch' using errcode='22023';
  end if;
  update public.board_columns c set sort_order=(ordered.ordinality-1)::integer
    from unnest(p_column_ids) with ordinality ordered(id,ordinality)
   where c.id=ordered.id and c.org_id=p_org_id and c.board_id=p_board_id;
  return query select c.* from public.board_columns c where c.org_id=p_org_id and c.board_id=p_board_id and c.archived_at is null order by c.sort_order,c.id;
end;
$$;
revoke all on function public.reorder_board_columns_atomic(uuid,uuid,uuid[]) from public,anon,service_role;
grant execute on function public.reorder_board_columns_atomic(uuid,uuid,uuid[]) to authenticated;
alter function public.reorder_board_columns_atomic(uuid,uuid,uuid[]) owner to moawork_row_order_writer;

revoke create on schema public from moawork_row_order_writer;
do $$
begin
  execute format('revoke moawork_row_order_writer from %I',current_user);
end $$;

do $$
declare
  v_proc oid:=to_regprocedure('public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid)');
  v_value_proc oid:=to_regprocedure('public.set_board_item_values_with_atomic_move(uuid,uuid,uuid,jsonb,uuid,uuid,bigint,uuid)');
  v_column_proc oid:=to_regprocedure('public.reorder_board_columns_atomic(uuid,uuid,uuid[])');
  v_private_proc oid:=to_regprocedure('public.issue602_move_board_item_private(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer)');
  v_cell_proc oid:=to_regprocedure('public.issue602_board_cell_value_is_valid(uuid,uuid,uuid,text,jsonb)');
  v_frontier_value_proc oid:=to_regprocedure('public.board_column_value_is_valid(uuid,uuid,text,jsonb)');
  v_reconcile_proc oid:=to_regprocedure('public.reconcile_board_definition_item_group(uuid,uuid,uuid,uuid,uuid)');
begin
  if v_proc is null
    or v_value_proc is null
    or v_column_proc is null
    or v_private_proc is null
    or v_cell_proc is null
    or v_frontier_value_proc is null
    or v_reconcile_proc is null
    or exists(select 1 from pg_proc where oid in (v_proc,v_value_proc,v_column_proc,v_private_proc,v_cell_proc,v_reconcile_proc) and not prosecdef)
    or exists(select 1 from pg_proc where oid in (v_proc,v_value_proc,v_column_proc,v_private_proc,v_cell_proc,v_reconcile_proc) and proconfig is distinct from array['search_path=""']::text[])
    or exists(select 1 from pg_proc where oid in (v_proc,v_value_proc,v_column_proc,v_private_proc,v_cell_proc) and pg_get_userbyid(proowner)<>'moawork_row_order_writer')
    or exists(select 1 from pg_proc where oid=v_reconcile_proc and pg_get_userbyid(proowner)<>'postgres')
    or exists(select 1 from pg_roles where rolname='moawork_row_order_writer' and (rolcanlogin or rolinherit or not rolbypassrls))
    or (select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname='moawork_row_order_writer')<>1
    or not exists(
      select 1 from pg_auth_members membership
      join pg_roles writer on writer.oid=membership.roleid
      join pg_roles member on member.oid=membership.member
      join pg_roles grantor on grantor.oid=membership.grantor
      where writer.rolname='moawork_row_order_writer'
        and member.rolname='postgres'
        and grantor.oid=10 and grantor.rolname='supabase_admin'
        and membership.admin_option
        and not membership.set_option
        and not membership.inherit_option
    )
    or has_schema_privilege('moawork_row_order_writer','public','CREATE')
    or has_function_privilege('anon',v_proc,'EXECUTE')
    or has_function_privilege('service_role',v_proc,'EXECUTE')
    or not has_function_privilege('authenticated',v_proc,'EXECUTE')
    or has_function_privilege('anon',v_value_proc,'EXECUTE')
    or has_function_privilege('service_role',v_value_proc,'EXECUTE')
    or not has_function_privilege('authenticated',v_value_proc,'EXECUTE')
    or has_function_privilege('anon',v_column_proc,'EXECUTE')
    or has_function_privilege('service_role',v_column_proc,'EXECUTE')
    or not has_function_privilege('authenticated',v_column_proc,'EXECUTE')
    or has_function_privilege('anon',v_private_proc,'EXECUTE')
    or has_function_privilege('authenticated',v_private_proc,'EXECUTE')
    or has_function_privilege('service_role',v_private_proc,'EXECUTE')
    or not has_function_privilege('postgres',v_private_proc,'EXECUTE')
    or has_function_privilege('anon',v_cell_proc,'EXECUTE')
    or has_function_privilege('authenticated',v_cell_proc,'EXECUTE')
    or has_function_privilege('service_role',v_cell_proc,'EXECUTE')
    or has_function_privilege('anon',v_frontier_value_proc,'EXECUTE')
    or has_function_privilege('authenticated',v_frontier_value_proc,'EXECUTE')
    or has_function_privilege('service_role',v_frontier_value_proc,'EXECUTE')
    or not has_function_privilege('moawork_row_order_writer',v_frontier_value_proc,'EXECUTE')
    or has_function_privilege('anon',v_reconcile_proc,'EXECUTE')
    or has_function_privilege('service_role',v_reconcile_proc,'EXECUTE')
    or not has_function_privilege('authenticated',v_reconcile_proc,'EXECUTE')
    or position('issue602_move_board_item_private' in pg_get_functiondef(v_reconcile_proc))=0
    or has_column_privilege('anon','public.boards','row_order_version','UPDATE')
    or has_column_privilege('authenticated','public.boards','row_order_version','UPDATE')
    or has_column_privilege('service_role','public.boards','row_order_version','UPDATE')
    or has_column_privilege('anon','public.items','group_id','UPDATE')
    or has_column_privilege('authenticated','public.items','group_id','UPDATE')
    or has_column_privilege('service_role','public.items','group_id','UPDATE')
    or has_column_privilege('anon','public.items','sort_order','UPDATE')
    or has_column_privilege('authenticated','public.items','sort_order','UPDATE')
    or has_column_privilege('service_role','public.items','sort_order','UPDATE')
    or has_column_privilege('anon','public.items','board_id','UPDATE')
    or has_column_privilege('authenticated','public.items','board_id','UPDATE')
    or has_column_privilege('service_role','public.items','board_id','UPDATE')
    or not has_column_privilege('authenticated','public.items','title','UPDATE')
    or not has_column_privilege('authenticated','public.items','assigned_to','UPDATE')
    or not exists(select 1 from pg_trigger where tgrelid='public.boards'::regclass and tgname='boards_row_order_version_rpc_only' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgrelid='public.items'::regclass and tgname='items_row_position_rpc_only' and not tgisinternal)
    or not exists(select 1 from pg_class where oid='public.board_row_move_requests'::regclass and relrowsecurity and relforcerowsecurity)
    or exists(select 1 from pg_policy where polrelid='public.board_row_move_requests'::regclass)
  then raise exception 'unsafe issue602 row move boundary'; end if;

  if (to_regprocedure('public.execute_trusted_board_automation(text)') is not null
       and position('issue602_move_board_item_private' in pg_get_functiondef(to_regprocedure('public.execute_trusted_board_automation(text)')))=0)
     or (to_regprocedure('public.execute_work_management_command(uuid,uuid,uuid,text,integer,uuid,jsonb)') is not null
       and position('issue602_move_board_item_private' in pg_get_functiondef(to_regprocedure('public.execute_work_management_command(uuid,uuid,uuid,text,integer,uuid,jsonb)')))=0)
     or (to_regprocedure('public.bbe151_ensure_notice_tab(uuid)') is not null
       and position('issue602_move_board_item_private' in pg_get_functiondef(to_regprocedure('public.bbe151_ensure_notice_tab(uuid)')))=0)
     or (to_regprocedure('public.advance_new_lead_to_contact(uuid,uuid)') is not null
       and position('issue602_move_board_item_private' in pg_get_functiondef(to_regprocedure('public.advance_new_lead_to_contact(uuid,uuid)')))=0)
  then raise exception 'trusted position writer not routed through issue602 invariant'; end if;
end $$;

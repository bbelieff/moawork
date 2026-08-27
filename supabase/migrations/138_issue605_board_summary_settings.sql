-- moa-migration-guard: logical_key=138_issue605_board_summary_settings predecessor=137_issue601_other_info_consumer digest=8497280628f46362828f9f623da47248593e6a9f08f6cf6b9d14e0565e1d9ae3 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '138_issue605_board_summary_settings',
  p_file_name => '138_issue605_board_summary_settings.sql',
  p_file_digest => '8497280628f46362828f9f623da47248593e6a9f08f6cf6b9d14e0565e1d9ae3',
  p_expected_predecessor => '137_issue601_other_info_consumer',
  p_executor => 'DG-07',
  p_thread_id => '01a02046-57fc-7141-bb41-ccf13704b618',
  p_foundation => false
);

create or replace function public.board_summary_config_is_valid(p_config jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_config) <> 'array' or jsonb_array_length(p_config) > 3 then return false; end if;
  if exists (
    select 1 from jsonb_array_elements(p_config) entry
     where jsonb_typeof(entry) <> 'object'
        or (select count(*) from jsonb_object_keys(entry)) <> 3
        or not (entry ?& array['id','kind','columnKey'])
        or jsonb_typeof(entry->'id') <> 'string'
        or jsonb_typeof(entry->'kind') <> 'string'
        or jsonb_typeof(entry->'columnKey') <> 'string'
        or btrim(entry->>'id') = '' or char_length(entry->>'id') > 160
        or btrim(entry->>'columnKey') = '' or char_length(entry->>'columnKey') > 160
        or entry->>'kind' not in ('distribution','sum')
  ) then return false; end if;
  select count(*) into v_count from jsonb_array_elements(p_config);
  if (select count(distinct entry->>'id') from jsonb_array_elements(p_config) entry) <> v_count then return false; end if;
  if (select count(distinct (entry->>'kind') || ':' || (entry->>'columnKey')) from jsonb_array_elements(p_config) entry) <> v_count then return false; end if;
  return true;
end;
$$;

revoke all on function public.board_summary_config_is_valid(jsonb) from public, anon, authenticated, service_role;
-- CHECK constraints execute with the row writer's privileges. The helper is
-- pure/immutable and exposes no rows, so legitimate legacy row writers may
-- execute it while the summary column itself remains RPC-only below.
grant execute on function public.board_summary_config_is_valid(jsonb) to anon, authenticated, service_role;

alter table public.boards
  add column summary_config_jsonb jsonb not null default '[]'::jsonb;
alter table public.boards
  add constraint boards_summary_config_shape_check
  check (public.board_summary_config_is_valid(summary_config_jsonb));

-- Existing broad legacy grants must not silently include the new summary column.
-- Replace them with the exact pre-138 column set, preserving old behavior while
-- keeping summary writes RPC-only.
revoke update on table public.boards from anon, service_role;
grant update(id,org_id,name,description,icon,is_system,source,sort_order,created_by,created_at,updated_at,detail_layout_jsonb)
  on table public.boards to anon, service_role;
revoke update(summary_config_jsonb) on table public.boards from authenticated;

create or replace function public.guard_board_summary_config_direct_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user <> 'postgres' then
    raise exception 'board summary config is RPC-only' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_board_summary_config_direct_write() from public,anon,authenticated,service_role;

create trigger boards_summary_config_rpc_only
before update of summary_config_jsonb on public.boards
for each row execute function public.guard_board_summary_config_direct_write();

create table public.board_summary_setting_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  actor_id uuid not null references public.users(id) on delete restrict,
  payload jsonb not null,
  result_config jsonb not null check (public.board_summary_config_is_valid(result_config)),
  created_at timestamptz not null default clock_timestamp(),
  primary key (org_id, request_id)
);
alter table public.board_summary_setting_requests enable row level security;
alter table public.board_summary_setting_requests force row level security;
revoke all on table public.board_summary_setting_requests from public,anon,authenticated,service_role;

create or replace function public.apply_board_summary_settings(
  p_org_id uuid,
  p_board_id uuid,
  p_request_id uuid,
  p_intent jsonb
) returns table(config jsonb,replayed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_prior public.board_summary_setting_requests%rowtype;
  v_current jsonb;
  v_next jsonb;
  v_entries jsonb[];
  v_index integer;
  v_target integer;
  v_direction integer;
  v_metric jsonb;
begin
  if v_actor is null or p_org_id is null or p_board_id is null or p_request_id is null then
    raise exception 'board summary input required' using errcode='22023';
  end if;
  if jsonb_typeof(p_intent) <> 'object' then
    raise exception 'board summary intent invalid' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.org_members m join public.orgs o on o.id=m.org_id
     where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active'
  ) or not public.effective_permission(p_org_id,'structure.tab_manage') then
    raise exception 'board summary permission denied' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.boards b
     where b.id=p_board_id and b.org_id=p_org_id and not b.is_system
  ) then raise exception 'board unavailable' using errcode='42501'; end if;

  v_payload := jsonb_build_object('board_id',p_board_id,'intent',p_intent);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text,0));
  select r.* into v_prior from public.board_summary_setting_requests r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.actor_id <> v_actor or v_prior.board_id <> p_board_id or v_prior.payload <> v_payload then
      raise exception 'board summary request replay conflict' using errcode='22023';
    end if;
    return query select v_prior.result_config,true;
    return;
  end if;

  select b.summary_config_jsonb into v_current from public.boards b
   where b.id=p_board_id and b.org_id=p_org_id and not b.is_system for update;
  if not found then raise exception 'board unavailable' using errcode='42501'; end if;
  if not public.board_summary_config_is_valid(v_current) then
    raise exception 'stored board summary config invalid' using errcode='22023';
  end if;
  if p_intent->>'type'='add' then
    if (select count(*) from jsonb_object_keys(p_intent))<>2 or not (p_intent ?& array['type','metric']) then
      raise exception 'board summary add intent invalid' using errcode='22023';
    end if;
    v_metric:=p_intent->'metric';
    if not public.board_summary_config_is_valid(jsonb_build_array(v_metric)) then
      raise exception 'board summary metric invalid' using errcode='22023';
    end if;
    if not exists (
      select 1 from public.board_columns c
       where c.org_id=p_org_id and c.board_id=p_board_id
         and c.key=v_metric->>'columnKey' and c.archived_at is null
         and not coalesce(c.summary_hidden,false)
         and ((v_metric->>'kind'='distribution' and c.type::text in ('select','status'))
           or (v_metric->>'kind'='sum' and c.type::text in ('number','money')))
    ) then raise exception 'board summary target invalid' using errcode='22023'; end if;
    if jsonb_array_length(v_current)>=3 then raise exception 'board summary max three' using errcode='22023'; end if;
    v_next:=v_current || jsonb_build_array(v_metric);
  elsif p_intent->>'type' in ('remove','move') then
    if p_intent->>'type'='remove' then
      if (select count(*) from jsonb_object_keys(p_intent))<>2 or not (p_intent ?& array['type','metricId'])
        or jsonb_typeof(p_intent->'metricId')<>'string' then
        raise exception 'board summary remove intent invalid' using errcode='22023';
      end if;
    else
      if (select count(*) from jsonb_object_keys(p_intent))<>3 or not (p_intent ?& array['type','metricId','direction'])
        or jsonb_typeof(p_intent->'metricId')<>'string' or jsonb_typeof(p_intent->'direction')<>'number'
        or p_intent->>'direction' not in ('-1','1') then
        raise exception 'board summary move intent invalid' using errcode='22023';
      end if;
    end if;
    select array_agg(entry order by ord)
      into v_entries
      from jsonb_array_elements(v_current) with ordinality valueset(entry,ord);
    select ord::integer into v_index from jsonb_array_elements(v_current) with ordinality valueset(entry,ord)
     where entry->>'id'=p_intent->>'metricId';
    if v_index is null then raise exception 'board summary metric not found' using errcode='22023'; end if;
    if p_intent->>'type'='remove' then
      select coalesce(jsonb_agg(entry order by ord),'[]'::jsonb) into v_next
        from jsonb_array_elements(v_current) with ordinality valueset(entry,ord)
       where ord<>v_index;
    else
      v_metric:=v_entries[v_index];
      if not exists (
        select 1 from public.board_columns c
         where c.org_id=p_org_id and c.board_id=p_board_id
           and c.key=v_metric->>'columnKey' and c.archived_at is null
           and not coalesce(c.summary_hidden,false)
           and ((v_metric->>'kind'='distribution' and c.type::text in ('select','status'))
             or (v_metric->>'kind'='sum' and c.type::text in ('number','money')))
      ) then raise exception 'board summary move target unavailable' using errcode='22023'; end if;
      v_direction:=(p_intent->>'direction')::integer;
      v_target:=v_index+v_direction;
      if v_target<1 or v_target>coalesce(array_length(v_entries,1),0) then
        raise exception 'board summary move out of range' using errcode='22023';
      end if;
      v_entries[v_index]:=v_entries[v_target]; v_entries[v_target]:=v_metric;
      v_next:=to_jsonb(v_entries);
    end if;
  else
    raise exception 'board summary intent invalid' using errcode='22023';
  end if;

  if not public.board_summary_config_is_valid(v_next) then
    raise exception 'board summary config invalid' using errcode='22023';
  end if;
  update public.boards set summary_config_jsonb=v_next,updated_at=clock_timestamp()
   where id=p_board_id and org_id=p_org_id;
  insert into public.board_summary_setting_requests(org_id,request_id,board_id,actor_id,payload,result_config)
  values(p_org_id,p_request_id,p_board_id,v_actor,v_payload,v_next);
  return query select v_next,false;
end;
$$;

revoke all on function public.apply_board_summary_settings(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.apply_board_summary_settings(uuid,uuid,uuid,jsonb) to authenticated;

do $$
declare v_proc oid:=to_regprocedure('public.apply_board_summary_settings(uuid,uuid,uuid,jsonb)');
begin
  if v_proc is null
    or exists(select 1 from pg_proc where oid=v_proc and (not prosecdef or proconfig is distinct from array['search_path=""']::text[]))
    or has_function_privilege('anon',v_proc,'EXECUTE')
    or has_function_privilege('service_role',v_proc,'EXECUTE')
    or not has_function_privilege('authenticated',v_proc,'EXECUTE')
    or has_column_privilege('anon','public.boards','summary_config_jsonb','UPDATE')
    or has_column_privilege('authenticated','public.boards','summary_config_jsonb','UPDATE')
    or has_column_privilege('service_role','public.boards','summary_config_jsonb','UPDATE')
    or not exists(select 1 from pg_trigger where tgrelid='public.boards'::regclass and tgname='boards_summary_config_rpc_only' and not tgisinternal)
    or not exists(select 1 from pg_class where oid='public.board_summary_setting_requests'::regclass and relrowsecurity and relforcerowsecurity)
    or exists(select 1 from pg_policy where polrelid='public.board_summary_setting_requests'::regclass)
  then raise exception 'unsafe issue605 board summary boundary'; end if;
end $$;

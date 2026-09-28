-- moa-migration-guard: logical_key=158_row_order_actor_helper predecessor=157_row_order_writer_auth_access digest=4da5dc0cbf1a9820bcd247fffbc2652b98ebe6b6f898b024408632ab46e1253e foundation=false
select public.begin_guarded_migration(
  p_logical_key => '158_row_order_actor_helper', p_file_name => '158_row_order_actor_helper.sql',
  p_file_digest => '4da5dc0cbf1a9820bcd247fffbc2652b98ebe6b6f898b024408632ab46e1253e', p_expected_predecessor => '157_row_order_writer_auth_access',
  p_executor => 'Codex', p_thread_id => 'v17-row-writer-auth-helper', p_foundation => false
);

-- Hosted postgres has auth USAGE without grant option. Migration 157's schema
-- GRANT can therefore warn without granting. Keep auth.uid() as the actor source;
-- only this private, argument-free helper crosses that schema boundary.
do $executor$
begin
  if current_user <> 'postgres' or not has_schema_privilege(current_user,'auth','USAGE')
     or not has_function_privilege(current_user,'auth.uid()','EXECUTE') then
    raise exception 'row actor helper requires the existing postgres auth access';
  end if;
end;
$executor$;

create function public.row_order_actor_uid()
returns uuid language sql stable security definer set search_path = ''
as $$ select auth.uid() $$;
alter function public.row_order_actor_uid() owner to postgres;
revoke all on function public.row_order_actor_uid() from public,anon,authenticated,service_role;
grant execute on function public.row_order_actor_uid() to moawork_row_order_writer;

-- Same temporary owner-edit boundary as 153; no permanent membership or schema
-- CREATE grant. Snapshot and verify ACLs/owners and every other body character.
do $repair$
declare
  v_oids oid[] := array[
    'public.move_board_row_atomic(uuid,uuid,uuid,uuid,uuid,bigint,uuid)'::regprocedure::oid,
    'public.set_board_item_values_with_atomic_move(uuid,uuid,uuid,jsonb,uuid,uuid,bigint,uuid)'::regprocedure::oid,
    'public.reorder_board_columns_atomic(uuid,uuid,uuid[])'::regprocedure::oid
  ];
  v_writer oid := 'moawork_row_order_writer'::regrole::oid;
  v_before jsonb; v_after jsonb; v_members jsonb; v_sources jsonb := '{}'::jsonb;
  v_create boolean; v_definitions text[] := '{}'::text[];
  v_proc record; v_definition text;
begin
  if not exists(select 1 from pg_roles where oid=v_writer and not rolcanlogin and not rolsuper and not rolinherit)
     or exists(select 1 from pg_proc where oid=any(v_oids) and (proowner<>v_writer or not prosecdef)) then
    raise exception 'unexpected row writer boundary';
  end if;
  select jsonb_agg(jsonb_build_array(oid,proowner,proacl::text,proconfig) order by oid) into v_before
    from pg_proc where oid=any(v_oids);
  select coalesce(jsonb_agg(to_jsonb(m) order by m.member,m.grantor),'[]'::jsonb) into v_members
    from pg_auth_members m where m.roleid=v_writer;
  v_create := has_schema_privilege(v_writer,'public','CREATE');
  for v_proc in select oid,prosrc,pg_get_functiondef(oid) definition from pg_proc where oid=any(v_oids) order by oid loop
    if regexp_count(v_proc.prosrc,'auth[.]uid[(][)]') <> 1
       or regexp_count(v_proc.definition,'auth[.]uid[(][)]') <> 1 then
      raise exception 'expected exactly one auth.uid() call in %',v_proc.oid::regprocedure;
    end if;
    v_definitions := array_append(v_definitions,replace(v_proc.definition,'auth.uid()','public.row_order_actor_uid()'));
    v_sources := v_sources || jsonb_build_object(v_proc.oid::text,replace(v_proc.prosrc,'auth.uid()','public.row_order_actor_uid()'));
  end loop;
  if cardinality(v_definitions) <> 3 then raise exception 'expected three row RPC definitions'; end if;
  execute format('grant moawork_row_order_writer to %I with set true, inherit false',current_user);
  if not v_create then grant create on schema public to moawork_row_order_writer; end if;
  set local role moawork_row_order_writer;
  foreach v_definition in array v_definitions loop execute v_definition; end loop;
  reset role;
  if not v_create then revoke create on schema public from moawork_row_order_writer; end if;
  execute format('revoke moawork_row_order_writer from %I',current_user);
  select jsonb_agg(jsonb_build_array(oid,proowner,proacl::text,proconfig) order by oid) into v_after
    from pg_proc where oid=any(v_oids);
  if v_after is distinct from v_before
     or has_schema_privilege(v_writer,'public','CREATE') is distinct from v_create
     or (select coalesce(jsonb_agg(to_jsonb(m) order by m.member,m.grantor),'[]'::jsonb) from pg_auth_members m where m.roleid=v_writer) is distinct from v_members
     or exists(select 1 from pg_proc where oid=any(v_oids) and prosrc is distinct from v_sources->>oid::text)
     or has_function_privilege('anon','public.row_order_actor_uid()','EXECUTE')
     or has_function_privilege('authenticated','public.row_order_actor_uid()','EXECUTE')
     or has_function_privilege('service_role','public.row_order_actor_uid()','EXECUTE')
     or not has_function_privilege(v_writer,'public.row_order_actor_uid()','EXECUTE') then
    raise exception 'row actor helper changed the protected boundary';
  end if;
end;
$repair$;

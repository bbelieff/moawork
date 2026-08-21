-- moa-migration-guard: logical_key=121_bbe236_board_column_date_validator_execute predecessor=120_bbe273_new_lead_full_intake digest=6516cce9087095159cef29a377ab2b25c8fa2b3fb875b0fbf861930fb97aecf7 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '121_bbe236_board_column_date_validator_execute',
  p_file_name => '121_bbe236_board_column_date_validator_execute.sql',
  p_file_digest => '6516cce9087095159cef29a377ab2b25c8fa2b3fb875b0fbf861930fb97aecf7',
  p_expected_predecessor => '120_bbe273_new_lead_full_intake',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- CHECK expressions execute as the writing role. Migration 115 deliberately
-- closed direct access to this pure validator, which also made every
-- authenticated board_columns insert/update evaluate the CHECK as 42501.
revoke all on function public.board_column_date_settings_is_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.board_column_date_settings_is_valid(jsonb)
  to authenticated;

do $$
declare
  v_signature text;
  v_proc oid;
  v_public_execute boolean;
begin
  foreach v_signature in array array[
    'public.board_column_access_policy_is_valid(jsonb)',
    'public.board_column_validation_is_valid(jsonb)',
    'public.board_column_metadata_is_valid(jsonb,jsonb,jsonb)',
    'public.board_column_date_settings_is_valid(jsonb)'
  ] loop
    v_proc := to_regprocedure(v_signature);
    if v_proc is null then
      raise exception 'missing board column validator: %', v_signature;
    end if;

    select exists (
      select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_proc and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) into v_public_execute;

    if not has_function_privilege('authenticated', v_proc, 'EXECUTE')
      or has_function_privilege('anon', v_proc, 'EXECUTE')
      or has_function_privilege('service_role', v_proc, 'EXECUTE')
      or v_public_execute then
      raise exception 'unexpected board column validator ACL: %', v_signature;
    end if;

    if exists (
      select 1 from pg_proc p
      where p.oid = v_proc
        and (p.prosecdef or p.proconfig is distinct from array['search_path=public, pg_temp']::text[])
    ) then
      raise exception 'unexpected board column validator execution properties: %', v_signature;
    end if;
  end loop;

  set local role authenticated;
  if not public.board_column_date_settings_is_valid('{}'::jsonb) then
    raise exception 'authenticated date settings validator probe returned false';
  end if;
  reset role;
end $$;

comment on constraint board_columns_date_settings_valid on public.board_columns is
  'BBE-176 date settings validation. This CHECK runs as the writing role, so authenticated must retain EXECUTE on board_column_date_settings_is_valid (BBE-236).';

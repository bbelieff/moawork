-- moa-migration-guard: logical_key=159_row_order_validator_access predecessor=158_row_order_actor_helper digest=aa1eaf560cd04926af9d34cf51d62cb6485dfa29afa1194c2dee7e21046a80e6 foundation=false
select public.begin_guarded_migration(
  p_logical_key => '159_row_order_validator_access', p_file_name => '159_row_order_validator_access.sql',
  p_file_digest => 'aa1eaf560cd04926af9d34cf51d62cb6485dfa29afa1194c2dee7e21046a80e6', p_expected_predecessor => '158_row_order_actor_helper',
  p_executor => 'Codex', p_thread_id => 'v17-row-writer-validator-access', p_foundation => false
);

-- CHECK expressions run as the row writer even when only an unrelated order
-- column changes. These five immutable SECURITY INVOKER functions validate
-- their JSON arguments only. Metadata validation calls the two nested helpers.
-- Keep RPC ownership, actor checks, schema/table grants and public ACLs intact.
do $boundary$
begin
  if current_user <> 'postgres' or not exists (
    select 1 from pg_roles where rolname='moawork_row_order_writer'
      and not rolcanlogin and not rolsuper and not rolinherit and rolbypassrls
  ) or exists (
    select 1 from pg_proc where oid = any(array[
      'public.board_summary_config_is_valid(jsonb)'::regprocedure::oid,
      'public.board_column_metadata_is_valid(jsonb,jsonb,jsonb)'::regprocedure::oid,
      'public.board_column_validation_is_valid(jsonb)'::regprocedure::oid,
      'public.board_column_access_policy_is_valid(jsonb)'::regprocedure::oid,
      'public.board_column_date_settings_is_valid(jsonb)'::regprocedure::oid
    ]) and (proowner <> 'postgres'::regrole or prosecdef or provolatile <> 'i' or prorettype <> 'boolean'::regtype)
  ) then
    raise exception 'unexpected row writer validator boundary' using errcode='42501';
  end if;
end;
$boundary$;

grant execute on function public.board_summary_config_is_valid(jsonb) to moawork_row_order_writer;
grant execute on function public.board_column_metadata_is_valid(jsonb,jsonb,jsonb) to moawork_row_order_writer;
grant execute on function public.board_column_validation_is_valid(jsonb) to moawork_row_order_writer;
grant execute on function public.board_column_access_policy_is_valid(jsonb) to moawork_row_order_writer;
grant execute on function public.board_column_date_settings_is_valid(jsonb) to moawork_row_order_writer;

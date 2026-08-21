-- moa-migration-guard: logical_key=109_bbe268_migration_frontier_bridge predecessor=108_bbe244_list_my_workspaces digest=72caa9819ba4a1a05ec06c380cd23768d3c46687c3b46469212e92742e6f56b0 foundation=false bridge_repo_predecessor=108_bbe199_org_logo

select public.begin_guarded_migration(
  p_logical_key => '109_bbe268_migration_frontier_bridge',
  p_file_name => '109_bbe268_migration_frontier_bridge.sql',
  p_file_digest => '72caa9819ba4a1a05ec06c380cd23768d3c46687c3b46469212e92742e6f56b0',
  p_expected_predecessor => '108_bbe244_list_my_workspaces',
  p_executor => 'DG-07',
  p_thread_id => '01a02046-57fc-7141-bb41-ccf13704b618',
  p_foundation => false
);

do $bridge$
declare
  v_max_prefix integer;
begin
  if not exists (
    select 1
      from public.migration_apply_guard
     where logical_key = '108_bbe244_list_my_workspaces'
       and file_name = '108_bbe244_list_my_workspaces.sql'
       and file_digest = '04e0b7f28387941c213a2c2758c8f751fde329cc17ce6c90213900daec00a4bc'
       and expected_predecessor = '107_bbe244_workspace_deletion_request'
  ) then
    raise exception using errcode = '23514', message = 'hosted frontier identity mismatch';
  end if;

  if not exists (
    select 1
      from public.migration_apply_guard
     where logical_key = '098_bbe199_org_logo'
       and file_name = '098_bbe199_org_logo.sql'
       and file_digest = '04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8'
       and expected_predecessor = '095_bbe172_new_lead_contact_transition'
  ) then
    raise exception using errcode = '23514', message = 'repository frontier equivalent is missing';
  end if;

  select max((substring(logical_key from '^[0-9]{3}'))::integer)
    into v_max_prefix
    from public.migration_apply_guard
   where logical_key <> '109_bbe268_migration_frontier_bridge';

  if v_max_prefix is distinct from 108 then
    raise exception using errcode = '23514', message = 'hosted frontier advanced before bridge';
  end if;
end;
$bridge$;

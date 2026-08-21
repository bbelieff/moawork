-- moa-migration-guard: logical_key=109_bbe268_migration_frontier_bridge predecessor=108_bbe244_list_my_workspaces digest=0b42d0edb56a0c362aec05638a7a2e63ebb20a55c7f04589224f6c20ade0f91c foundation=false bridge_repo_predecessor=108_bbe199_org_logo

do $bridge$
declare
  v_file_digest constant text := '0b42d0edb56a0c362aec05638a7a2e63ebb20a55c7f04589224f6c20ade0f91c';
  v_max_prefix integer;
  v_repo_ok boolean;
  v_hosted_ok boolean;
begin
  perform pg_advisory_xact_lock(1297040711, 188);
  if exists (select 1 from public.migration_apply_guard where logical_key='109_bbe268_migration_frontier_bridge') then raise exception using errcode='23505', message='migration logical key already applied'; end if;
  select exists (select 1 from public.migration_apply_guard where logical_key='108_bbe199_org_logo' and file_name='108_bbe199_org_logo.sql' and file_digest='911962c8b94e61192c5dd6faa21f59afce652581de851f0987e5ddc5e8ffd3b8' and expected_predecessor='107_bbe242_board_column_check_execute_restore') into v_repo_ok;
  select
    exists (select 1 from public.migration_apply_guard where logical_key='098_bbe199_org_logo' and file_name='098_bbe199_org_logo.sql' and file_digest='04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8' and expected_predecessor='095_bbe172_new_lead_contact_transition')
    and exists (select 1 from public.migration_apply_guard where logical_key='098_bbe215_today_kpi_definitions' and file_digest='574e35fae8acd5bbec27a0ed43dfceb0aa833843c291249c392179503b194a61' and expected_predecessor='097_bbe201_new_lead_field_write_restore')
    and exists (select 1 from public.migration_apply_guard where logical_key='099_bbe235_work_board_projection' and file_digest='a289e67cad159ccc6937dfb6505d248993451d1b62c2ae12c204408ac5dbd6e8' and expected_predecessor='098_bbe215_today_kpi_definitions')
    and exists (select 1 from public.migration_apply_guard where logical_key='100_bbe236_company_csv_import' and file_digest='386eb1b07c46900a781e614864f563094193d9afe313c3a1427a267adf0cfd75' and expected_predecessor='099_bbe235_work_board_projection')
    and exists (select 1 from public.migration_apply_guard where logical_key='101_bbe238_notice_board_unlock' and file_digest='c83e6f3407646109c7b5bf3e387860ab61d40515f698d9fe16fe993eda62fe5a' and expected_predecessor='100_bbe236_company_csv_import')
    and exists (select 1 from public.migration_apply_guard where logical_key='102_bbe239_board_item_files_storage' and file_digest='555518005c270ce5ea9141fb13e1ded35f641144ac41863448fda32ad3811c38' and expected_predecessor='101_bbe238_notice_board_unlock')
    and exists (select 1 from public.migration_apply_guard where logical_key='103_bbe240_deal_ledger_vat_wiring' and file_digest='866de2fb1741325d0f95b53c1160b0b05cbf3f90ba2a03f1a13bb2e60fcd4f0b' and expected_predecessor='102_bbe239_board_item_files_storage')
    and exists (select 1 from public.migration_apply_guard where logical_key='104_bbe240_deals_fee_terms' and file_digest='8b864d7609a18ea78eb59f04f038112c57f5a42ef7cb0f27f637296b84920205' and expected_predecessor='103_bbe240_deal_ledger_vat_wiring')
    and exists (select 1 from public.migration_apply_guard where logical_key='105_bbe240_reserve_ledger_workspace_slug' and file_digest='3d36f8d3eea65fa91c8354b78de620eb6b3aa73f8e5194c1bc19672aa5a6ca95' and expected_predecessor='104_bbe240_deals_fee_terms')
    and exists (select 1 from public.migration_apply_guard where logical_key='106_bbe242_board_column_check_execute_restore' and file_digest='8f0c1215c0d87045490c09312fd73caa114c9eca7e90119b77dbc72cb9d06791' and expected_predecessor='105_bbe240_reserve_ledger_workspace_slug')
    and exists (select 1 from public.migration_apply_guard where logical_key='107_bbe244_workspace_deletion_request' and file_digest='d1ef91a17c0467fb450e3ce68348a1ee1bda0d892fcb7f6cc6cad6131eb25c1c' and expected_predecessor='106_bbe242_board_column_check_execute_restore')
    and exists (select 1 from public.migration_apply_guard where logical_key='108_bbe244_list_my_workspaces' and file_name='108_bbe244_list_my_workspaces.sql' and file_digest='04e0b7f28387941c213a2c2758c8f751fde329cc17ce6c90213900daec00a4bc' and expected_predecessor='107_bbe244_workspace_deletion_request') into v_hosted_ok;
  if v_repo_ok = v_hosted_ok then raise exception using errcode='23514', message='exactly one recognized migration frontier is required'; end if;
  select max((substring(logical_key from '^[0-9]{3}'))::integer) into v_max_prefix from public.migration_apply_guard;
  if v_max_prefix is distinct from 108 then raise exception using errcode='23514', message='migration frontier advanced before bridge'; end if;
  insert into public.migration_apply_guard(logical_key,file_name,file_digest,expected_predecessor,executor,thread_id,applied_at) values (
    '109_bbe268_migration_frontier_bridge',
    '109_bbe268_migration_frontier_bridge.sql',
    v_file_digest,
    '108_bbe244_list_my_workspaces','DG-07','01a02046-57fc-7141-bb41-ccf13704b618',clock_timestamp()
  );
end;
$bridge$;

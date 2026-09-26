-- moa-migration-guard: logical_key=157_row_order_writer_auth_access predecessor=156_consultation_workflow digest=966c53ac48110f6063c164ce76a2c911769f727581bcb6b81e7fc8c65b4f7afb foundation=false
select public.begin_guarded_migration(
  p_logical_key => '157_row_order_writer_auth_access', p_file_name => '157_row_order_writer_auth_access.sql',
  p_file_digest => '966c53ac48110f6063c164ce76a2c911769f727581bcb6b81e7fc8c65b4f7afb', p_expected_predecessor => '156_consultation_workflow',
  p_executor => 'Codex', p_thread_id => 'v17-row-writer-auth-repair', p_foundation => false
);

-- #797: restore only the auth helper ACLs originally granted by migration 139.
-- SECURITY DEFINER row-move/value-move RPCs execute auth.uid() as this private
-- owner. BYPASSRLS does not provide schema USAGE or function EXECUTE privileges.
-- Hosted QA observed missing auth USAGE; when/how the ACL drifted is unknown.
-- No table grants, role membership/attributes, RPC owner/body or client ACL changes.
do $writer_boundary$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'moawork_row_order_writer'
      and not rolcanlogin and not rolsuper and not rolinherit
  ) then
    raise exception 'unexpected private row writer role boundary';
  end if;
end;
$writer_boundary$;

grant usage on schema auth to moawork_row_order_writer;
grant execute on function auth.uid() to moawork_row_order_writer;

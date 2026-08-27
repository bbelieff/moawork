-- moa-migration-guard: logical_key=136_issue620_app_meta_internal predecessor=135_issue599_assignment_ui_hardening digest=182333838379d8b26dc80a4ef6a9f8318c14801d205189c4edc553d7206338f8 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '136_issue620_app_meta_internal',
  p_file_name => '136_issue620_app_meta_internal.sql',
  p_file_digest => '182333838379d8b26dc80a4ef6a9f8318c14801d205189c4edc553d7206338f8',
  p_expected_predecessor => '135_issue599_assignment_ui_hardening',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

revoke all on table public.app_meta from public, anon, authenticated, service_role;

alter table public.app_meta enable row level security;
alter table public.app_meta force row level security;

do $$
declare
  v_role text;
  v_privilege text;
begin
  if (select c.relowner::regrole::text <> 'postgres'
        from pg_class c
       where c.oid = 'public.app_meta'::regclass) then
    raise exception 'unsafe_issue620_app_meta_owner';
  end if;

  if not exists (
    select 1
      from pg_class c
     where c.oid = 'public.app_meta'::regclass
       and c.relrowsecurity
       and c.relforcerowsecurity
  ) then
    raise exception 'unsafe_issue620_app_meta_rls';
  end if;

  if exists (
    select 1
      from pg_policy p
     where p.polrelid = 'public.app_meta'::regclass
  ) then
    raise exception 'unsafe_issue620_app_meta_policy';
  end if;

  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(v_role, 'public.app_meta', v_privilege) then
        raise exception 'unsafe_issue620_app_meta_acl role=% privilege=%', v_role, v_privilege;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     where c.oid = 'public.app_meta'::regclass
       and acl.grantee = 0
       and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ) then
    raise exception 'unsafe_issue620_app_meta_public_acl';
  end if;
end;
$$;

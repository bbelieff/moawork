-- moa-migration-guard: logical_key=130_issue571_departments predecessor=129_issue558_dispatch_lineage_notifications digest=0204a0e3fc66275013f716741a14002f9090d2ec3154e7de64f5744461c80732 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '130_issue571_departments',
  p_file_name => '130_issue571_departments.sql',
  p_file_digest => '0204a0e3fc66275013f716741a14002f9090d2ec3154e7de64f5744461c80732',
  p_expected_predecessor => '129_issue558_dispatch_lineage_notifications',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- #571 — 050/076의 정본 부서 모델을 그대로 소비한다.
-- `departments`와 `department_members`는 050에서 만들어졌고 076에서
-- hosted drift까지 복구됐다. 이 migration은 새 표나 예시 부서를 만들지 않는다.
-- 기존 고객 행을 update/delete/insert하지 않고, 읽기 RLS·ACL과 owner 전용 RPC
-- 권한만 additive하게 재확인한다.

alter table public.departments enable row level security;
alter table public.department_members enable row level security;

drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments
  for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists department_members_read on public.department_members;
create policy department_members_read on public.department_members
  for select to authenticated
  using (public.is_org_member(org_id));

-- 직접 쓰기는 허용하지 않는다. 조직 변경은 050의 감사·재실행 방지 owner RPC만 쓴다.
revoke all on table public.departments, public.department_members from public, anon, authenticated;
grant select on table public.departments, public.department_members to authenticated;

revoke all on function public.create_org_department(uuid, uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.move_org_department(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.set_org_department_head(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.archive_org_department(uuid, uuid, uuid) from public, anon;
revoke all on function public.assign_org_department_member(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.unassign_org_department_member(uuid, uuid, uuid) from public, anon;
grant execute on function public.create_org_department(uuid, uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.move_org_department(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.set_org_department_head(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.archive_org_department(uuid, uuid, uuid) to authenticated;
grant execute on function public.assign_org_department_member(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.unassign_org_department_member(uuid, uuid, uuid) to authenticated;

do $$
declare
  v_function regprocedure;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departments' and column_name = 'key'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'departments' and column_name = 'archived_at'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'department_members' and column_name = 'dept_id'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'department_members' and column_name = 'is_primary'
  ) then
    raise exception 'canonical 050/076 department model is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.department_members'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) like '%(dept_id, org_id)%departments(id, org_id)%'
  ) then
    raise exception 'department_members tenant-safe composite foreign key is missing';
  end if;

  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'departments' and rowsecurity
  ) or not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'department_members' and rowsecurity
  ) then
    raise exception 'department RLS must be enabled';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'departments'
      and policyname = 'departments_read' and cmd = 'SELECT'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'department_members'
      and policyname = 'department_members_read' and cmd = 'SELECT'
  ) then
    raise exception 'department read policies are missing';
  end if;

  if not has_table_privilege('authenticated', 'public.departments', 'SELECT')
    or not has_table_privilege('authenticated', 'public.department_members', 'SELECT')
    or has_table_privilege('authenticated', 'public.departments', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.department_members', 'INSERT,UPDATE,DELETE') then
    raise exception 'department table ACL is not read-only for authenticated';
  end if;

  foreach v_function in array array[
    'public.create_org_department(uuid,uuid,text,text,uuid,uuid)'::regprocedure,
    'public.move_org_department(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.set_org_department_head(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.archive_org_department(uuid,uuid,uuid)'::regprocedure,
    'public.assign_org_department_member(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.unassign_org_department_member(uuid,uuid,uuid)'::regprocedure
  ] loop
    if not has_function_privilege('authenticated', v_function, 'EXECUTE')
      or has_function_privilege('anon', v_function, 'EXECUTE') then
      raise exception 'department owner RPC ACL is invalid: %', v_function;
    end if;
  end loop;
end
$$;

-- moa-migration-guard: logical_key=133_issue571_department_management_ui predecessor=132_issue574_cloud_folder_link digest=93c301fabb296036437ae5430d183691070769fa6b5c173395e96704f207f1d8 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '133_issue571_department_management_ui',
  p_file_name => '133_issue571_department_management_ui.sql',
  p_file_digest => '93c301fabb296036437ae5430d183691070769fa6b5c173395e96704f207f1d8',
  p_expected_predecessor => '132_issue574_cloud_folder_link',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- #571 — 050/076의 canonical departments/department_members만 소비한다.
-- 고객 부서·구성원 행을 백필하거나 변경하지 않는다. UI에 없던 이름변경과
-- owner/admin 관리 경계를 audited RPC로 추가한다.

alter table public.org_department_audit
  drop constraint if exists org_department_audit_operation_check;
alter table public.org_department_audit
  add constraint org_department_audit_operation_check check (operation in (
    'department_created', 'department_moved', 'department_renamed', 'department_head_set',
    'department_archived', 'department_member_assigned', 'department_member_removed'
  ));

create or replace function public.org_department_require_manager(p_org_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null
     or not exists (
       select 1
         from public.org_members m
         join public.orgs o on o.id = m.org_id
        where m.org_id = p_org_id and m.user_id = v_actor
          and m.status = 'active' and m.role in ('owner', 'admin')
          and o.status = 'active'
     ) then
    raise exception 'organization manager required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.manage_org_department_create(
  p_org_id uuid,
  p_parent_id uuid,
  p_name text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_name text := btrim(p_name);
  v_id uuid := gen_random_uuid();
  v_metadata jsonb;
begin
  v_actor := public.org_department_require_manager(p_org_id);
  if v_name = '' or length(v_name) > 80 then
    raise exception 'department name required' using errcode = '22023';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.departments
     where id = p_parent_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'parent department not found' using errcode = '23503';
  end if;
  v_metadata := jsonb_build_object('parent_id', p_parent_id, 'name', v_name);
  if public.org_department_audit_replay('department_created', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  insert into public.departments(id, org_id, parent_id, name, key, created_by)
  values (v_id, p_org_id, p_parent_id, v_name, 'dept-' || replace(v_id::text, '-', ''), v_actor);
  insert into public.org_department_audit(
    org_id, actor_user_id, operation, target_dept_id, request_id, metadata
  ) values (
    p_org_id, v_actor, 'department_created', v_id, p_request_id, v_metadata
  );
  return jsonb_build_object('accepted', true, 'replayed', false, 'id', v_id);
end;
$$;

create or replace function public.manage_org_department_rename(
  p_org_id uuid,
  p_dept_id uuid,
  p_name text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_name text := btrim(p_name);
  v_metadata jsonb;
begin
  v_actor := public.org_department_require_manager(p_org_id);
  if v_name = '' or length(v_name) > 80 then
    raise exception 'department name required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.departments
     where id = p_dept_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'department not found' using errcode = '23503';
  end if;
  v_metadata := jsonb_build_object('dept_id', p_dept_id, 'name', v_name);
  if public.org_department_audit_replay('department_renamed', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  update public.departments
     set name = v_name, updated_at = now()
   where id = p_dept_id and org_id = p_org_id and archived_at is null;
  insert into public.org_department_audit(
    org_id, actor_user_id, operation, target_dept_id, request_id, metadata
  ) values (
    p_org_id, v_actor, 'department_renamed', p_dept_id, p_request_id, v_metadata
  );
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

create or replace function public.manage_org_department_move(
  p_org_id uuid,
  p_dept_id uuid,
  p_new_parent_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_metadata jsonb;
begin
  v_actor := public.org_department_require_manager(p_org_id);
  if not exists (
    select 1 from public.departments
     where id = p_dept_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'department not found' using errcode = '23503';
  end if;
  if p_new_parent_id = p_dept_id then
    raise exception 'department cannot be its own parent' using errcode = '22023';
  end if;
  if p_new_parent_id is not null and not exists (
    select 1 from public.departments
     where id = p_new_parent_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'parent department not found' using errcode = '23503';
  end if;
  v_metadata := jsonb_build_object('dept_id', p_dept_id, 'new_parent_id', p_new_parent_id);
  if public.org_department_audit_replay('department_moved', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  update public.departments
     set parent_id = p_new_parent_id, updated_at = now()
   where id = p_dept_id and org_id = p_org_id and archived_at is null;
  insert into public.org_department_audit(
    org_id, actor_user_id, operation, target_dept_id, request_id, metadata
  ) values (
    p_org_id, v_actor, 'department_moved', p_dept_id, p_request_id, v_metadata
  );
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

create or replace function public.manage_org_department_member(
  p_org_id uuid,
  p_user_id uuid,
  p_dept_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_operation text := case when p_dept_id is null then 'department_member_removed' else 'department_member_assigned' end;
  v_metadata jsonb := jsonb_build_object('dept_id', p_dept_id, 'user_id', p_user_id);
begin
  v_actor := public.org_department_require_manager(p_org_id);
  if not exists (
    select 1 from public.org_members
     where org_id = p_org_id and user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active member required' using errcode = '42501';
  end if;
  if p_dept_id is not null and not exists (
    select 1 from public.departments
     where id = p_dept_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'department not found' using errcode = '23503';
  end if;
  if public.org_department_audit_replay(v_operation, p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;

  if p_dept_id is null then
    delete from public.department_members
     where org_id = p_org_id and user_id = p_user_id and is_primary
       and not exists (
         select 1 from public.departments d
          where d.id = department_members.dept_id and d.org_id = p_org_id
            and d.head_user_id = p_user_id
       );
    update public.department_members
       set is_primary = false
     where org_id = p_org_id and user_id = p_user_id and is_primary;
  else
    delete from public.department_members
     where org_id = p_org_id and user_id = p_user_id and is_primary and dept_id <> p_dept_id
       and not exists (
         select 1 from public.departments d
          where d.id = department_members.dept_id and d.org_id = p_org_id
            and d.head_user_id = p_user_id
       );
    update public.department_members
       set is_primary = false
     where org_id = p_org_id and user_id = p_user_id and is_primary and dept_id <> p_dept_id;
    insert into public.department_members(org_id, dept_id, user_id, role, is_primary)
    values (p_org_id, p_dept_id, p_user_id, 'member', true)
    on conflict (dept_id, user_id) do update set is_primary = true;
  end if;

  insert into public.org_department_audit(
    org_id, actor_user_id, operation, target_dept_id, target_user_id, request_id, metadata
  ) values (
    p_org_id, v_actor, v_operation, p_dept_id, p_user_id, p_request_id, v_metadata
  );
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

revoke all on function public.org_department_require_manager(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.manage_org_department_create(uuid, uuid, text, uuid)
  from public, anon, service_role;
revoke all on function public.manage_org_department_rename(uuid, uuid, text, uuid)
  from public, anon, service_role;
revoke all on function public.manage_org_department_move(uuid, uuid, uuid, uuid)
  from public, anon, service_role;
revoke all on function public.manage_org_department_member(uuid, uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.manage_org_department_create(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.manage_org_department_rename(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.manage_org_department_move(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.manage_org_department_member(uuid, uuid, uuid, uuid) to authenticated;

do $$
declare v_function regprocedure;
begin
  foreach v_function in array array[
    'public.manage_org_department_create(uuid,uuid,text,uuid)'::regprocedure,
    'public.manage_org_department_rename(uuid,uuid,text,uuid)'::regprocedure,
    'public.manage_org_department_move(uuid,uuid,uuid,uuid)'::regprocedure,
    'public.manage_org_department_member(uuid,uuid,uuid,uuid)'::regprocedure
  ] loop
    if not has_function_privilege('authenticated', v_function, 'EXECUTE')
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'department manager RPC ACL is invalid: %', v_function;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'public.org_department_require_manager(uuid)', 'EXECUTE')
     or not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'manage_org_department_%'
          and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']::text[]
     ) then
    raise exception 'department manager helper/function boundary is invalid';
  end if;
end
$$;

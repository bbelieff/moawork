-- ORG-DEPARTMENTS-035 (BBE-119)
-- 설계 정본: docs/design/조직·보고체계_설계_v1.md
--
-- "부서 트리가 진짜고, 보고선은 거기서 자동으로 유도된다. 사람마다 보고 대상을
--  손으로 지정하지 않는다." 013의 member_hierarchy_assignments(reports_to_user_id)
-- 는 폐기하지 않고 그대로 둔다 — 이제부터는 «예외 지정»(§1-3 ①) 용도로만 쓴다.
-- 이 파일은 013 을 수정하지 않는다(신규 마이그레이션 원칙). 그 테이블에 읽기
-- 정책만 새로 추가한다(§ 하단) — 지금까지 어디서도 select 되지 않던 죽은 쓰기 전용
-- 경로였고, 이 카드가 처음으로 그 값을 실제로 읽어 쓴다.

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  parent_id uuid references public.departments(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  -- member_scoped_permission_bindings.scope_key 와 같은 문법 — 부서 key 를 그대로
  -- 권한 범위 키로 재사용할 수 있게(§1-1 note).
  key text not null check (key ~ '^[a-z0-9][a-z0-9:_./-]{0,95}$'),
  head_user_id uuid references public.users(id) on delete set null,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key),
  check (parent_id is distinct from id)
);

create index if not exists departments_org_parent_idx on public.departments(org_id, parent_id);

-- 소속 — 겸직 허용(N:N), 주부서 1개(부분 유니크). role 은 department_members 안의
-- 정보용 라벨이고, 보고선 계산·«현재 부서장» 판정은 departments.head_user_id 가
-- 유일한 정본이다(set_org_department_head 가 두 값을 동기화한다).
create table if not exists public.department_members (
  org_id uuid not null references public.orgs(id) on delete cascade,
  dept_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('head', 'member')),
  is_primary boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (dept_id, user_id)
);

create unique index if not exists department_members_primary_per_user_idx
  on public.department_members(org_id, user_id) where is_primary;
create index if not exists department_members_org_idx on public.department_members(org_id);

alter table public.departments enable row level security;
alter table public.department_members enable row level security;
revoke all on table public.departments, public.department_members from public, anon, authenticated;

-- 순환 방지 — 부서를 자기 자손 밑으로 옮길 수 없다(§4-2). INSERT 도 잡는다:
-- gen_random_uuid() 기본값은 BEFORE INSERT 트리거가 NEW 를 보기 전에 이미 채워져
-- 있으므로 NEW.id 비교가 신규 행에도 유효하다.
create or replace function public.departments_prevent_cycle()
returns trigger language plpgsql as $$
declare v_cursor uuid;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'department cannot be its own parent' using errcode = '22023';
  end if;
  v_cursor := new.parent_id;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'department move would create a cycle' using errcode = '22023';
    end if;
    select parent_id into v_cursor from public.departments where id = v_cursor;
  end loop;
  return new;
end;
$$;

create trigger departments_prevent_cycle_trg
  before insert or update of parent_id on public.departments
  for each row execute function public.departments_prevent_cycle();

-- 감사 — 013 의 member_hierarchy_authz_audit 과 같은 모양이지만 부서 단위 작업이라
-- 별도 테이블로 둔다(기존 테이블의 operation CHECK 를 건드리지 않기 위해서이기도 하다).
create table if not exists public.org_department_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  operation text not null check (operation in (
    'department_created', 'department_moved', 'department_head_set',
    'department_archived', 'department_member_assigned', 'department_member_removed'
  )),
  target_dept_id uuid references public.departments(id) on delete set null,
  target_user_id uuid references public.users(id) on delete set null,
  request_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (actor_user_id, operation, request_id)
);
alter table public.org_department_audit enable row level security;
revoke all on table public.org_department_audit from public, anon, authenticated;

create or replace function public.org_department_audit_replay(
  p_operation text, p_request_id uuid, p_org_id uuid, p_metadata jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.org_department_audit%rowtype;
begin
  if p_request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
  select * into v_existing from public.org_department_audit
   where actor_user_id = auth.uid() and operation = p_operation and request_id = p_request_id;
  if not found then return false; end if;
  if v_existing.org_id = p_org_id and v_existing.metadata = p_metadata then return true; end if;
  raise exception 'idempotency key reuse with different request' using errcode = '22023';
end;
$$;

-- 부서 생성. 013 의 member_hierarchy_authz_require_owner 를 그대로 재사용한다
-- (protected workspace owner 게이트 — 이 카드에서 새로 정의하지 않는다).
create or replace function public.create_org_department(
  p_org_id uuid, p_parent_id uuid, p_name text, p_key text, p_head_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_name text := btrim(p_name); v_key text := lower(btrim(p_key));
  v_id uuid; v_metadata jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if v_name = '' then raise exception 'department name required' using errcode = '22023'; end if;
  if p_parent_id is not null and not exists (
    select 1 from public.departments where id = p_parent_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'parent department not found' using errcode = '23503';
  end if;
  if p_head_user_id is not null and not exists (
    select 1 from public.org_members where org_id = p_org_id and user_id = p_head_user_id and status = 'active'
  ) then
    raise exception 'head must be an active member' using errcode = '42501';
  end if;
  v_metadata := jsonb_build_object('parent_id', p_parent_id, 'name', v_name, 'key', v_key, 'head_user_id', p_head_user_id);
  if public.org_department_audit_replay('department_created', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  insert into public.departments(org_id, parent_id, name, key, head_user_id, created_by)
  values (p_org_id, p_parent_id, v_name, v_key, p_head_user_id, v_actor)
  returning id into v_id;
  if p_head_user_id is not null then
    insert into public.department_members(org_id, dept_id, user_id, role, is_primary)
    values (p_org_id, v_id, p_head_user_id, 'head', true)
    on conflict (dept_id, user_id) do update set role = 'head';
  end if;
  insert into public.org_department_audit(org_id, actor_user_id, operation, target_dept_id, request_id, metadata)
  values (p_org_id, v_actor, 'department_created', v_id, p_request_id, v_metadata);
  return jsonb_build_object('accepted', true, 'replayed', false, 'id', v_id);
end;
$$;

-- 부서 이동 — 순환 검사는 departments_prevent_cycle_trg 가 UPDATE 시점에 건다.
create or replace function public.move_org_department(
  p_org_id uuid, p_dept_id uuid, p_new_parent_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_metadata jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if not exists (select 1 from public.departments where id = p_dept_id and org_id = p_org_id) then
    raise exception 'department not found' using errcode = '23503';
  end if;
  if p_new_parent_id is not null and not exists (
    select 1 from public.departments where id = p_new_parent_id and org_id = p_org_id and archived_at is null
  ) then
    raise exception 'target parent not found' using errcode = '23503';
  end if;
  v_metadata := jsonb_build_object('new_parent_id', p_new_parent_id);
  if public.org_department_audit_replay('department_moved', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  update public.departments set parent_id = p_new_parent_id, updated_at = now()
   where id = p_dept_id and org_id = p_org_id;
  insert into public.org_department_audit(org_id, actor_user_id, operation, target_dept_id, request_id, metadata)
  values (p_org_id, v_actor, 'department_moved', p_dept_id, p_request_id, v_metadata);
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- 부서장 지정/해제(null=공석). 지정 대상은 이미 그 부서 소속이어야 한다 —
-- "부서에 없는 사람을 장으로 앉히는" 불일치를 막는다.
create or replace function public.set_org_department_head(
  p_org_id uuid, p_dept_id uuid, p_head_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_prev_head uuid; v_metadata jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if not exists (select 1 from public.departments where id = p_dept_id and org_id = p_org_id and archived_at is null) then
    raise exception 'department not found' using errcode = '23503';
  end if;
  if p_head_user_id is not null and not exists (
    select 1 from public.department_members where org_id = p_org_id and dept_id = p_dept_id and user_id = p_head_user_id
  ) then
    raise exception 'head must already be a member of this department' using errcode = '22023';
  end if;
  v_metadata := jsonb_build_object('head_user_id', p_head_user_id);
  if public.org_department_audit_replay('department_head_set', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  select head_user_id into v_prev_head from public.departments where id = p_dept_id;
  update public.departments set head_user_id = p_head_user_id, updated_at = now()
   where id = p_dept_id and org_id = p_org_id;
  if v_prev_head is not null and v_prev_head is distinct from p_head_user_id then
    update public.department_members set role = 'member'
     where org_id = p_org_id and dept_id = p_dept_id and user_id = v_prev_head;
  end if;
  if p_head_user_id is not null then
    update public.department_members set role = 'head'
     where org_id = p_org_id and dept_id = p_dept_id and user_id = p_head_user_id;
  end if;
  insert into public.org_department_audit(org_id, actor_user_id, operation, target_dept_id, target_user_id, request_id, metadata)
  values (p_org_id, v_actor, 'department_head_set', p_dept_id, p_head_user_id, p_request_id, v_metadata);
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- 부서 보관 — 하위 부서·소속 인원이 남아있으면 거부한다(§4-3 "먼저 옮기세요").
create or replace function public.archive_org_department(
  p_org_id uuid, p_dept_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_metadata jsonb := '{}'::jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if exists (select 1 from public.departments where org_id = p_org_id and parent_id = p_dept_id and archived_at is null) then
    raise exception 'move child departments first' using errcode = '23503';
  end if;
  if exists (select 1 from public.department_members where org_id = p_org_id and dept_id = p_dept_id) then
    raise exception 'move members out first' using errcode = '23503';
  end if;
  if public.org_department_audit_replay('department_archived', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  update public.departments set archived_at = now(), updated_at = now()
   where id = p_dept_id and org_id = p_org_id;
  insert into public.org_department_audit(org_id, actor_user_id, operation, target_dept_id, request_id, metadata)
  values (p_org_id, v_actor, 'department_archived', p_dept_id, p_request_id, v_metadata);
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- 주부서 배정 — 겸직(§1-2)은 스키마상 허용되지만, 이 RPC 는 MVP 화면(카드를 다른
-- 부서로 옮기기)에 맞춰 «주부서 교체»만 다룬다. 이전 주부서 행은 지운다(같은 사람이
-- 두 개의 is_primary 를 가질 수 없다 — 부분 유니크 인덱스와도 일치).
create or replace function public.assign_org_department_member(
  p_org_id uuid, p_dept_id uuid, p_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_metadata jsonb;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if not exists (select 1 from public.org_members where org_id = p_org_id and user_id = p_user_id and status = 'active') then
    raise exception 'active member required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.departments where id = p_dept_id and org_id = p_org_id and archived_at is null) then
    raise exception 'department not found' using errcode = '23503';
  end if;
  v_metadata := jsonb_build_object('dept_id', p_dept_id);
  if public.org_department_audit_replay('department_member_assigned', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  delete from public.department_members
   where org_id = p_org_id and user_id = p_user_id and is_primary and dept_id <> p_dept_id;
  insert into public.department_members(org_id, dept_id, user_id, role, is_primary)
  values (p_org_id, p_dept_id, p_user_id, 'member', true)
  on conflict (dept_id, user_id) do update set is_primary = true;
  insert into public.org_department_audit(org_id, actor_user_id, operation, target_dept_id, target_user_id, request_id, metadata)
  values (p_org_id, v_actor, 'department_member_assigned', p_dept_id, p_user_id, p_request_id, v_metadata);
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- 소속 해제 — 미배정 풀로(§4-3). 부서장이었다면 그 자리는 공석이 된다(자동 승계 없음).
create or replace function public.unassign_org_department_member(
  p_org_id uuid, p_user_id uuid, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid; v_metadata jsonb := jsonb_build_object('unassigned', true);
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if public.org_department_audit_replay('department_member_removed', p_request_id, p_org_id, v_metadata) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;
  update public.departments set head_user_id = null, updated_at = now()
   where org_id = p_org_id and head_user_id = p_user_id;
  delete from public.department_members where org_id = p_org_id and user_id = p_user_id and is_primary;
  insert into public.org_department_audit(org_id, actor_user_id, operation, target_user_id, request_id, metadata)
  values (p_org_id, v_actor, 'department_member_removed', p_user_id, p_request_id, v_metadata);
  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- 읽기 — 조직 구성원이면 누구나(쓰기만 대표 전용). RLS 는 앱 UUID 로 조직 경계를
-- 건다; 이 화면 자체는 조직 전체가 보는 조직도라 팀장/사원도 읽어야 한다.
create policy departments_read on public.departments for select to authenticated
  using (public.is_org_member(org_id));
create policy department_members_read on public.department_members for select to authenticated
  using (public.is_org_member(org_id));
grant select on public.departments, public.department_members to authenticated;

-- 013 의 예외 테이블 — 지금까지 어디서도 select 되지 않았다(쓰기 전용 죽은 경로).
-- 이 카드가 처음으로 읽어서 §1-3 ①의 «예외 지정» 입력으로 쓴다.
create policy member_hierarchy_assignments_read on public.member_hierarchy_assignments for select to authenticated
  using (public.is_org_member(org_id));
grant select on public.member_hierarchy_assignments to authenticated;

revoke all on function public.org_department_audit_replay(text, uuid, uuid, jsonb) from public, anon, authenticated;
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

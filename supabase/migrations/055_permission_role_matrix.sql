-- PERM-ROLE-MATRIX-035 (BBE-122)
-- 권한 = 역할 4종(소유자/관리자/팀장/멤버) × 24항목(목업 실측 — 카드 제목 "22항목"은 낡은 값) 토글
-- + 개인 예외. 차단이 허용을 이긴다. 위험 5항목은 기록 필수. 조회 범위(scope)가 뷰보다 먼저 적용된다.
--
-- 새 장치를 만들지 않는다 — 013의 member_scoped_permission_bindings(개인 예외 allow/deny·viewer/editor)와
-- member_hierarchy_assignments(보고선)를 그대로 감싼다. 이 마이그레이션이 추가하는 것은
--   ① member_role 에 team_lead 값 (기존 owner/admin/member 3종 → 4종)
--   ② 역할별 기본 매트릭스(perm_baseline, 코드 상수) + 조직별 역할 오버라이드(org_role_permission_overrides)
--   ③ 위험 항목 실행 기록(org_permission_audit)
--   ④ 개인 예외를 member 외 역할까지 확장하는 새 RPC(기존 013 함수는 그대로 두고 건드리지 않는다)
--
-- 의도적으로 하지 않는 것: member_scope 에 'department' 값 추가, companies/deals 등 업무 테이블의
-- RLS 정책 변경. "팀장 = 내 부서 이하" 조회범위의 실제 행 단위 시행은 조직 트랙(BBE-119) 및 후속
-- 카드 몫으로 남긴다 — 이 카드 리스(app/src/lib/perm/**, app/src/components/member-organization/perm/**,
-- 본 파일)를 벗어나는 테이블 정책을 건드리면 동시 진행 중인 다른 트랙과 충돌한다.

-- ---------------------------------------------------------------------------
-- ① 역할 4종
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- ② 역할 기본 매트릭스(불변 상수) + 조직별 역할 오버라이드(가변)
-- ---------------------------------------------------------------------------

-- 목업 UI목업_워크스페이스_최종_v6.html 의 const PERM 배열을 그대로 옮긴 것.
-- app/src/lib/perm/matrix.ts 의 PERM_MATRIX 와 완전히 일치해야 하며, 드리프트는
-- app/src/lib/perm/matrix.test.ts 가 막는다(수동 대조표는 신뢰하지 않는다).
create or replace function public.perm_baseline()
returns table(
  perm_group text,
  scope_key text,
  label text,
  is_danger boolean,
  allowed_owner boolean,
  allowed_admin boolean,
  allowed_team_lead boolean,
  allowed_member boolean
)
language sql
immutable
as $$
  values
    ('업무','work.view_tabs','탭 보기',false,true,true,true,true),
    ('업무','work.item_upsert','항목 추가·수정',false,true,true,true,true),
    ('업무','work.assign_owner','담당자 지정',false,true,true,true,false),
    ('업무','work.item_delete','항목 삭제',false,true,true,false,false),
    ('업무','work.edit_others_items','다른 사람 담당 건 수정',false,true,true,true,false),
    ('구조','structure.column_manage','컬럼 추가·삭제',false,true,true,false,false),
    ('구조','structure.section_manage','아이템 추가·삭제',false,true,true,false,false),
    ('구조','structure.preset_edit','프리셋 편집',false,true,true,false,false),
    ('구조','structure.shared_view_save','공용 뷰 저장',false,true,true,true,false),
    ('구조','structure.tab_manage','탭 순서·이름',false,true,true,false,false),
    ('자동화 · 발송','automation.view','자동화 규칙 보기',false,true,true,true,true),
    ('자동화 · 발송','automation.edit','자동화 규칙 편집',false,true,true,false,false),
    ('자동화 · 발송','automation.send_message','문자·알림톡 발송',false,true,true,true,false),
    ('자동화 · 발송','automation.template_edit','발송 템플릿 편집',false,true,true,false,false),
    ('조직 · 공지','org.view_chart','조직도 보기',false,true,true,true,true),
    ('조직 · 공지','org.member_manage','조직원 초대·이동',false,true,true,false,false),
    ('조직 · 공지','org.grant_permission','권한 부여',false,true,true,false,false),
    ('조직 · 공지','org.dept_notice','부서 공지 발송',false,true,true,true,false),
    ('조직 · 공지','org.company_notice','전사 공지 발송',false,true,true,false,false),
    ('위험','danger.csv_export','CSV 내보내기',true,true,true,false,false),
    ('위험','danger.bulk_edit_delete','일괄 수정·삭제',true,true,false,false,false),
    ('위험','danger.view_accounting_amount','회계 금액 보기',true,true,true,true,false),
    ('위험','danger.year_end_archive','연말 아카이빙',true,true,false,false,false),
    ('위험','danger.data_import','데이터 가져오기·이관',true,true,false,false,false)
$$;

-- 조직이 기본 매트릭스에서 벗어나게 바꾼 것만 저장(희소 테이블). 소유자 행은 없다 — 불변.
create table if not exists public.org_role_permission_overrides (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  role        public.member_role not null,
  scope_key   text not null,
  allowed     boolean not null,
  updated_by  uuid not null references public.users(id) on delete restrict,
  updated_at  timestamptz not null default now(),
  primary key (org_id, role, scope_key),
  check (role <> 'owner')
);

-- 위험 5항목 실행 기록 + 매트릭스·예외 변경 기록(공용 1테이블).
create table if not exists public.org_permission_audit (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  target_user_id uuid references public.users(id) on delete restrict,
  operation    text not null check (operation in (
                 'org_role_permission_set',
                 'member_permission_exception_bound',
                 'risky_action_recorded'
               )),
  scope_key    text not null,
  request_id   uuid not null,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  unique (actor_user_id, operation, scope_key, request_id)
);

alter table public.org_role_permission_overrides enable row level security;
alter table public.org_permission_audit enable row level security;
revoke all on table public.org_role_permission_overrides, public.org_permission_audit
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- ③ 판정 — 역할 기본값 → 조직 오버라이드 → 개인 예외(차단이 허용을 이김) 순으로 병합
-- ---------------------------------------------------------------------------
create or replace function public.effective_permission(p_org_id uuid, p_scope_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_baseline boolean;
  v_override boolean;
  v_exception text;
begin
  if v_actor is null or p_org_id is null or p_scope_key is null then
    return false;
  end if;

  select m.role into v_role
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';

  if v_role is null then
    return false;
  end if;
  if v_role = 'owner' then
    return true; -- 소유자 권한은 끌 수 없다(목업 tglPerm 과 동일 규칙)
  end if;

  select case v_role
           when 'admin' then allowed_admin
           when 'team_lead' then allowed_team_lead
           else allowed_member
         end
    into v_baseline
    from public.perm_baseline()
   where scope_key = p_scope_key;

  if v_baseline is null then
    return false; -- 알 수 없는 scope_key 는 닫힘(화이트리스트 밖)
  end if;

  select allowed into v_override
    from public.org_role_permission_overrides
   where org_id = p_org_id and role = v_role and scope_key = p_scope_key;

  select decision into v_exception
    from public.member_scoped_permission_bindings
   where org_id = p_org_id and subject_user_id = v_actor and scope_key = p_scope_key;

  if v_exception = 'deny' then return false; end if;
  if v_exception = 'allow' then return true; end if;

  return coalesce(v_override, v_baseline);
end;
$$;

-- ---------------------------------------------------------------------------
-- ④ 쓰기 RPC — 전부 소유자 전용(013 의 member_hierarchy_authz_require_owner 재사용)
-- ---------------------------------------------------------------------------
create or replace function public.write_org_role_permission(
  p_org_id uuid,
  p_role public.member_role,
  p_scope_key text,
  p_allowed boolean,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_known boolean;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  if p_role = 'owner' then
    raise exception 'owner permission is immutable' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;

  select true into v_known from public.perm_baseline() where scope_key = p_scope_key;
  if v_known is null then
    raise exception 'unknown scope key' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.org_permission_audit
     where actor_user_id = v_actor and operation = 'org_role_permission_set'
       and scope_key = p_scope_key and request_id = p_request_id
  ) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;

  insert into public.org_role_permission_overrides(org_id, role, scope_key, allowed, updated_by)
  values (p_org_id, p_role, p_scope_key, p_allowed, v_actor)
  on conflict (org_id, role, scope_key)
  do update set allowed = excluded.allowed, updated_by = excluded.updated_by, updated_at = now();

  insert into public.org_permission_audit(org_id, actor_user_id, target_user_id, operation, scope_key, request_id, metadata)
  values (p_org_id, v_actor, null, 'org_role_permission_set', p_scope_key, p_request_id,
          jsonb_build_object('role', p_role, 'allowed', p_allowed));

  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- 개인 예외 — 013 의 bind_workspace_lower_member_permission 은 role='member' 대상만 허용해서
-- 그대로 둔다(수정 금지). 이 함수는 소유자가 아닌 모든 활성 역할을 대상으로 같은 기존 테이블
-- (member_scoped_permission_bindings)에 쓰는 확장판이다 — "있는 장치를 감싼다"는 목업 주석 그대로.
create or replace function public.bind_workspace_member_permission_exception(
  p_org_id uuid,
  p_target_user_id uuid,
  p_scope_key text,
  p_decision text,
  p_access_level text,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_decision text := lower(btrim(p_decision));
  v_access text := lower(btrim(p_access_level));
  v_known boolean;
begin
  v_actor := public.member_hierarchy_authz_require_owner(p_org_id);
  perform public.member_hierarchy_authz_require_active_nonowner(p_org_id, p_target_user_id, v_actor);

  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;
  if v_decision not in ('allow','deny') or v_access not in ('viewer','editor') then
    raise exception 'valid exception decision required' using errcode = '22023';
  end if;

  select true into v_known from public.perm_baseline() where scope_key = p_scope_key;
  if v_known is null then
    raise exception 'unknown scope key' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.org_permission_audit
     where actor_user_id = v_actor and operation = 'member_permission_exception_bound'
       and scope_key = p_scope_key and request_id = p_request_id
  ) then
    return jsonb_build_object('accepted', true, 'replayed', true);
  end if;

  insert into public.member_scoped_permission_bindings(org_id, subject_user_id, scope_key, decision, access_level, updated_by)
  values (p_org_id, p_target_user_id, p_scope_key, v_decision, v_access, v_actor)
  on conflict (org_id, subject_user_id, scope_key)
  do update set decision = excluded.decision, access_level = excluded.access_level,
    updated_by = excluded.updated_by, updated_at = now();

  insert into public.org_permission_audit(org_id, actor_user_id, target_user_id, operation, scope_key, request_id, metadata)
  values (p_org_id, v_actor, p_target_user_id, 'member_permission_exception_bound', p_scope_key, p_request_id,
          jsonb_build_object('decision', v_decision, 'access_level', v_access));

  return jsonb_build_object('accepted', true, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- ⑤ 위험 항목 실행 기록 — 위험 5항목은 반드시 기록한다(목업 "위험 구역" 주석).
--    실제 CSV 내보내기·일괄삭제 등 기능이 호출하는 원시 함수. 그 기능 배선은 각 소유 카드 몫.
-- ---------------------------------------------------------------------------
create or replace function public.record_risky_action(
  p_org_id uuid,
  p_scope_key text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_is_danger boolean;
  v_allowed boolean;
begin
  if v_actor is null or p_org_id is null then
    raise exception 'authenticated org member required' using errcode = '42501';
  end if;

  select is_danger into v_is_danger from public.perm_baseline() where scope_key = p_scope_key;
  if v_is_danger is null then
    raise exception 'unknown scope key' using errcode = '22023';
  end if;
  if not v_is_danger then
    raise exception 'not a risk-tracked scope key' using errcode = '22023';
  end if;

  v_allowed := public.effective_permission(p_org_id, p_scope_key);
  if not v_allowed then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  insert into public.org_permission_audit(org_id, actor_user_id, target_user_id, operation, scope_key, request_id, metadata)
  values (p_org_id, v_actor, null, 'risky_action_recorded', p_scope_key, gen_random_uuid(), coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object('recorded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- ⑥ 읽기 RPC — 관리 화면(조직관리 → 권한)용. 소유자·관리자만.
-- ---------------------------------------------------------------------------
create or replace function public.read_org_permission_matrix(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_matrix jsonb;
  v_exceptions jsonb;
begin
  if v_actor is null or p_org_id is null then
    raise exception 'authenticated org member required' using errcode = '42501';
  end if;

  select m.role into v_role
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';

  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'owner or admin required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'group', b.perm_group,
      'scopeKey', b.scope_key,
      'label', b.label,
      'danger', b.is_danger,
      'allowed', jsonb_build_object(
        'owner', true,
        'admin', coalesce((select o1.allowed from public.org_role_permission_overrides o1
                            where o1.org_id = p_org_id and o1.role = 'admin' and o1.scope_key = b.scope_key), b.allowed_admin),
        'team_lead', coalesce((select o2.allowed from public.org_role_permission_overrides o2
                            where o2.org_id = p_org_id and o2.role = 'team_lead' and o2.scope_key = b.scope_key), b.allowed_team_lead),
        'member', coalesce((select o3.allowed from public.org_role_permission_overrides o3
                            where o3.org_id = p_org_id and o3.role = 'member' and o3.scope_key = b.scope_key), b.allowed_member)
      )
    ) order by b.perm_group, b.scope_key), '[]'::jsonb)
    into v_matrix
  from public.perm_baseline() b;

  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', e.subject_user_id::text,
      'scopeKey', e.scope_key,
      'decision', e.decision,
      'accessLevel', e.access_level
    )), '[]'::jsonb)
    into v_exceptions
  from public.member_scoped_permission_bindings e
  where e.org_id = p_org_id;

  return jsonb_build_object('matrix', v_matrix, 'exceptions', v_exceptions);
end;
$$;

-- ---------------------------------------------------------------------------
-- 권한 부여
-- ---------------------------------------------------------------------------
grant execute on function public.perm_baseline() to authenticated;
grant execute on function public.effective_permission(uuid, text) to authenticated;
grant execute on function public.write_org_role_permission(uuid, public.member_role, text, boolean, uuid) to authenticated;
grant execute on function public.bind_workspace_member_permission_exception(uuid, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.record_risky_action(uuid, text, jsonb) to authenticated;
grant execute on function public.read_org_permission_matrix(uuid) to authenticated;

-- D24 + BBE-119: 조회 범위를 뷰 필터보다 먼저 적용하고 숨긴 건수를 함께 돌려준다.
-- 기존 items RLS/is_org_member 함수는 수정하지 않고, 이 좁은 SECURITY DEFINER RPC가
-- 활성 멤버십과 tenant/dept 경계를 직접 재검증한다.
create or replace function public.read_permission_scoped_work_items(
  p_org_id uuid,
  p_view_assignee uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_scope public.member_scope;
  v_visible jsonb;
  v_hidden integer;
begin
  if v_actor is null or p_org_id is null then
    raise exception 'active workspace membership required' using errcode = '42501';
  end if;
  select m.role, m.scope into v_role, v_scope
    from public.org_members m join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id and m.user_id = v_actor
     and m.status = 'active' and o.status = 'active';
  if v_role is null or not public.effective_permission(p_org_id, 'work.view_tabs') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  with recursive actor_departments as (
    select dm.dept_id from public.department_members dm
     where dm.org_id = p_org_id and dm.user_id = v_actor and dm.is_primary
    union all
    select d.id from public.departments d join actor_departments parent on d.parent_id = parent.dept_id
     where d.org_id = p_org_id and d.archived_at is null
  ), scoped_users as (
    select distinct dm.user_id from public.department_members dm
     join actor_departments ad on ad.dept_id = dm.dept_id
    where dm.org_id = p_org_id
  ), org_items as (
    select i.id, i.assigned_to from public.items i
     where i.org_id = p_org_id
  ), scope_visible as materialized (
    select r.id, r.assigned_to from org_items r
     where v_role in ('owner', 'admin') or v_scope = 'all'
        or (v_role = 'team_lead' or v_scope = 'department')
           and r.assigned_to in (select user_id from scoped_users)
        or v_role = 'member' and v_scope = 'assigned' and r.assigned_to = v_actor
  ), viewed as (
    select s.id from scope_visible s
     where p_view_assignee is null or s.assigned_to = p_view_assignee
  ), requested_view_count as (
    select count(*)::integer as count from org_items i
     where p_view_assignee is null or i.assigned_to = p_view_assignee
  )
  select coalesce(jsonb_agg(v.id order by v.id), '[]'::jsonb),
         (select count from requested_view_count) - count(*)
    into v_visible, v_hidden from viewed v;

  return jsonb_build_object('itemIds', v_visible, 'hiddenCount', v_hidden);
end;
$$;

revoke all on function public.perm_baseline() from public, anon;
revoke all on function public.effective_permission(uuid, text) from public, anon;
revoke all on function public.write_org_role_permission(uuid, public.member_role, text, boolean, uuid) from public, anon;
revoke all on function public.bind_workspace_member_permission_exception(uuid, uuid, text, text, text, uuid) from public, anon;
revoke all on function public.record_risky_action(uuid, text, jsonb) from public, anon;
revoke all on function public.read_org_permission_matrix(uuid) from public, anon;
revoke all on function public.read_permission_scoped_work_items(uuid, uuid) from public, anon;
grant execute on function public.read_permission_scoped_work_items(uuid, uuid) to authenticated;

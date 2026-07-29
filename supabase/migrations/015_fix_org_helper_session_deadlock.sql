-- ===================================================================
-- 015_fix_org_helper_session_deadlock.sql
-- BUG-0004 — 조직 격리 헬퍼가 상시 false 를 반환해 전면 차단되는 문제 수정
-- ===================================================================
--
-- 【증상】
--   011_member_account_ops.sql 이 조직 격리 헬퍼 4종을
--     is_org_member / org_role / org_scope / is_protected_workspace_owner
--   재정의하면서 앞에 public.member_account_session_valid() 를 선행 조건으로 걸었다.
--
--   그 함수는 current_setting('request.jwt.claim.session_id', true) 가 비면 즉시 false 다.
--   그런데 그 클레임을 채우는 배선이 저장소 어디에도 없다(실측, main 1744d9f 기준):
--     - custom access token hook            supabase/ 전체  0건
--     - session_id 클레임을 설정하는 SQL     0건 (011 은 current_setting 으로 읽기만 한다)
--     - 앱의 JWT 클레임 주입                 0건 (RPC 인자 p_session_id 는 JWT 와 무관하다)
--     - 011 이후 되돌린 마이그레이션          0건 (012·013 에 재정의 없음)
--
--   → 헬퍼 4종이 항상 false → RLS 활성 26 테이블의 기반이 무너진다.
--     이것은 침입 차단이 아니라 **정상 사용자 전원이 자기 조직 데이터조차 못 보는 전면 장애**다.
--     앱이 Supabase 미연결(인메모리 폴백)인 동안에는 SQL 이 실행되지 않아 무증상이며,
--     이 마이그레이션이 프로덕션 DB 에 적용되는 순간 처음 드러난다.
--
-- 【수정】
--   헬퍼 4종에서 세션 선행 조건만 제거하고, 006_public_workspace_entry.sql 이 넣은
--   fail-closed 강화(membership.status='active' AND organization.status='active')는 그대로 둔다.
--   즉 006 정의로 되돌리는 것이며, 001 의 느슨한 정의로 되돌아가는 것이 아니다.
--
-- 【관심사 분리 — 세션 무효화 기능은 버리지 않는다】
--   member_account_session_valid() 자체는 유지한다(삭제하지 않는다).
--   세션 검사는 그것이 실제로 의미를 갖는 곳 — member account 전용 RPC — 에서 계속 쓰인다.
--   조직 격리(RLS 기반)와 세션 수명 관리는 다른 관심사이며, 후자를 전자의 전제로 삼으면
--   배선 하나가 비는 순간 테넌시 전체가 잠긴다. 이번이 그 사례다.
--
-- 【재강화 조건】
--   session_id 클레임을 채우는 배선(예: Supabase custom access token hook)이 실제로 들어오고,
--   그 배선이 검증된 뒤에는 헬퍼에 세션 조건을 다시 얹어도 된다.
--   그때는 반드시 배선과 헬퍼 변경을 **같은 PR** 에 담고, 실DB 침투테스트로 확인할 것.
--
-- 판정·근거: docs/coordination/T10-gate-checklist.md §11 (BUG-0004)
-- ===================================================================

-- 조직 멤버 여부 — RLS 활성 테이블 대부분이 이 헬퍼를 기반으로 삼는다.
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
    where membership.org_id = p_org
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.status = 'active'
  );
$$;

-- 조직 내 역할(owner/admin/member) — 역할 경계 정책이 참조한다.
create or replace function public.org_role(p_org uuid)
returns public.member_role language sql stable security definer set search_path = public, pg_temp as $$
  select membership.role
  from public.org_members membership
  join public.orgs organization on organization.id = membership.org_id
  where membership.org_id = p_org
    and membership.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active';
$$;

-- 담당범위(all/assigned) — 멤버가 본인 담당만 보게 하는 정책이 참조한다.
create or replace function public.org_scope(p_org uuid)
returns public.member_scope language sql stable security definer set search_path = public, pg_temp as $$
  select membership.scope
  from public.org_members membership
  join public.orgs organization on organization.id = membership.org_id
  where membership.org_id = p_org
    and membership.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active';
$$;

-- 보호 대상 워크스페이스 소유자 — 소유자 전용 파괴적 조작을 가른다.
create or replace function public.is_protected_workspace_owner(p_org_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.org_members membership
    join public.orgs organization on organization.id = membership.org_id
    where membership.org_id = p_org_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.scope = 'all'
      and membership.status = 'active'
      and organization.status = 'active'
  );
$$;

-- 실행 권한은 의도적으로 건드리지 않는다.
-- 실측: 001·006·011 어디에도 이 4종에 대한 revoke/grant 가 없다(기본 권한을 쓴다).
-- 여기서 권한 경계를 새로 그으면 BUG-0004 와 무관한 접근 경로를 깨뜨릴 수 있으므로,
-- 이 마이그레이션은 함수 본문(세션 선행 조건 제거)만 바꾼다.

-- =====================================================================
-- 017_fix_is_platform_admin_role_axis.sql
--   is_platform_admin() 이 예약된 플랫폼 관리자를 인식하지 못하는 버그 수정
--
-- 증상: beliefkimkim@gmail.com 로그인 → 진입(신청) 화면에 갇힘. 소속이 0이라
--       회사에 못 들어가고, 어드민 화면도 열리지 않는다.
--       DB 는 "정상"으로 보인다 — app_admins 에 행이 있고 is_platform = true 다.
--
-- 원인: 006 의 is_platform_admin() 이 **`role = 'admin'`** 을 요구한다.
--       그런데 app_admins.role 은 "플랫폼 등급"이 아니라 **가입 시 부여할 tenant 역할**이다
--       (005 정의: `role text not null default 'owner'`, 주석 "그 사용자를 owner +
--        플랫폼 관리자로 자동 부여"). 그래서 005 가 예약한 유일한 관리자는 role='owner' 이고,
--       `role = 'admin'` 조건에 걸려 **항상 false** 가 나온다.
--       두 축을 한 컬럼으로 오해한 것이 원인이다:
--         · is_platform  = 플랫폼 관리자 여부   ← 이게 플랫폼 축
--         · role         = 부여할 tenant 역할   ← 이건 회사 축
--
-- 조치: 플랫폼 판정을 `is_platform` **단독**으로 한다. role 은 보지 않는다.
--       (role 을 'admin' 으로 바꾸는 방식은 택하지 않았다 — 그러면 belie 가 회사를
--        만들 때 owner 가 아니라 admin 으로 들어가 005 의 의도가 깨진다.)
--
-- 성격: 함수 1개 재정의(create or replace). 테이블·RLS 정책·is_org_member() 무수정.
--       시그니처·권한(revoke/grant)·security definer·search_path 모두 006 그대로 유지.
-- =====================================================================

create or replace function public.is_platform_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from auth.users auth_user
    join public.app_admins platform_admin
      on lower(platform_admin.email) = lower(auth_user.email)
    where auth_user.id = auth.uid()
      and platform_admin.is_platform is true
      -- role 조건 제거: role 은 tenant 역할 축이고 플랫폼 축은 is_platform 이다.
  );
$$;

-- 006 과 동일한 접근 통제를 재확인(재정의로 초기화되는 환경 대비, 멱등).
revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

-- =====================================================================
-- 014_platform_metrics_daily.sql — 플랫폼 제품지표 야간 배치 스냅샷 (C4 · T04)
--
-- 성격 : additive. 001~013 무수정. 비밀값·PII 없음.
-- 목적 : 스티키니스(DAU/MAU)·휴면·신규딜을 조직×일 단위로 **미리 집계**해 둔다.
--
-- 왜 스냅샷인가 (P0-AUTHZ-CONTRACT 정합):
--   O5 — 플랫폼 권한은 tenant RLS 를 우회하지 않는다.
--   공격테스트 11 — Platform-only 사용자의 tenant table SELECT 는 0 이어야 한다.
--   따라서 어드민 화면이 전 조직 원본(activities/deals)을 실시간으로 훑는 구조는
--   구조적으로 금지된다. 대신 배치가 service_role 로 집계해 **개인정보 없는 수치만**
--   이 표에 적재하고, 콘솔은 이 표만 읽는다.
--
-- 이 표에 넣지 않는 것: user_id, 이메일, 딜 제목, 활동 내용 등 식별자·원문.
--   저장하는 것은 전부 **개수와 비율**이다.
-- =====================================================================

create table if not exists platform_metrics_daily (
  -- 집계 대상 KST 날짜. 앱의 kstDayStartUtc/kstDayEndUtc 와 같은 경계를 쓴다.
  day           date not null,
  org_id        uuid not null references orgs(id) on delete cascade,

  -- 고유 활성 사용자 수 (창: DAU 1일, MAU 30일, 반열린 구간)
  dau           integer not null default 0 check (dau >= 0),
  mau           integer not null default 0 check (mau >= 0),
  -- DAU/MAU. DAU 창이 MAU 창의 부분집합이므로 0..1 을 벗어날 수 없다.
  stickiness    numeric(6,4) not null default 0 check (stickiness between 0 and 1),

  -- 멤버 분포. active + dormant + never_active = 조직 멤버 수.
  active_users  integer not null default 0 check (active_users >= 0),
  dormant_users integer not null default 0 check (dormant_users >= 0),

  new_deals     integer not null default 0 check (new_deals >= 0),

  -- 재집계(멱등 upsert) 추적용.
  computed_at   timestamptz not null default now(),

  primary key (day, org_id)
);

-- 콘솔은 "최근 N일"을 조회한다 → day 역순 인덱스.
create index if not exists platform_metrics_daily_day_idx
  on platform_metrics_daily (day desc);

alter table platform_metrics_daily enable row level security;

-- 읽기: 플랫폼 관리자만. 005 의 SECURITY DEFINER 함수로 판정한다
-- (app_admins 는 RLS 로 직접 조회가 막혀 있다).
-- ⚠ 이 표는 tenant 업무데이터가 아니라 집계 수치이므로 org 멤버십을 요구하지 않는다.
--    대신 플랫폼 관리자 외에는 어떤 행도 보이지 않는다.
create policy platform_metrics_daily_read
  on platform_metrics_daily
  for select
  using (
    auth.jwt() ->> 'email' is not null
    and public.app_admin_role(auth.jwt() ->> 'email') is not null
  );

-- 쓰기 정책은 두지 않는다 → anon/authenticated 는 INSERT/UPDATE/DELETE 불가.
-- 적재는 아래 SECURITY DEFINER 함수를 service_role(야간 배치)만 호출해 수행한다.
revoke insert, update, delete on platform_metrics_daily from anon, authenticated;

-- ---------------------------------------------------------------------
-- 멱등 upsert — 같은 (day, org_id) 를 다시 계산하면 덮어쓴다.
-- 배치 재실행·과거 날짜 재집계가 중복 행을 만들지 않게 한다.
-- ---------------------------------------------------------------------
create or replace function public.upsert_platform_metrics_daily(
  p_day           date,
  p_org_id        uuid,
  p_dau           integer,
  p_mau           integer,
  p_stickiness    numeric,
  p_active_users  integer,
  p_dormant_users integer,
  p_new_deals     integer
) returns void
language sql
security definer
set search_path = public
as $$
  insert into platform_metrics_daily as m (
    day, org_id, dau, mau, stickiness, active_users, dormant_users, new_deals, computed_at
  )
  values (
    p_day, p_org_id, p_dau, p_mau, p_stickiness, p_active_users, p_dormant_users, p_new_deals, now()
  )
  on conflict (day, org_id) do update
    set dau           = excluded.dau,
        mau           = excluded.mau,
        stickiness    = excluded.stickiness,
        active_users  = excluded.active_users,
        dormant_users = excluded.dormant_users,
        new_deals     = excluded.new_deals,
        computed_at   = now();
$$;

-- 배치 전용 — 일반 클라이언트는 호출할 수 없다.
revoke execute on function public.upsert_platform_metrics_daily(
  date, uuid, integer, integer, numeric, integer, integer, integer
) from public, anon, authenticated;

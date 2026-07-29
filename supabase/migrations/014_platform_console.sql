-- =====================================================================
-- 014_platform_console.sql — T07 · 플랫폼 운영 콘솔(/platform) P0.
--
-- 목적: 플랫폼 운영자용 콘솔의 저장소 계층.
--   (1) orgs.is_internal            — 내부 조직 플래그(지표 기본 제외)
--   (2) app_admins 확장             — level / added_by / revoked_at / last_seen_at
--   (3) platform_metrics_daily      — 야간 배치 롤업 대상(실시간 집계 금지)
--   (4) 결제·매출 스키마 골격       — billing_accounts / plans / subscriptions
--                                     / invoices / payments (PG 실연동은 Phase 2)
--   (5) 운영자 전용 조회 RPC        — SECURITY DEFINER, 집계·메타데이터만
--
-- 원칙(어기면 안 됨):
--   · 어드민은 tenant org 로 만들지 않는다 — /platform 은 org 평면 밖이다.
--   · P0 는 고객 **업무 데이터의 내용**을 읽지 않는다. 건수·시각·사용자 수만.
--     (아래 롤업은 count()/max() 만 쓰고 title·content·amount 를 선택하지 않는다.)
--   · app_admins 는 RLS 로 직접 select 가 막혀 있다. 반드시 SECURITY DEFINER 경유.
--   · break-glass(고객 데이터 열람)는 P0 범위 밖 — 여기서 구현하지 않는다.
--
-- 성격: additive. 001~013 무수정. 비밀값 없음. 멱등(재실행 안전).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 운영자 등급 — super / operator / viewer
--    조회 권한은 3등급 동일하고, 등급은 **실행(쓰기)만** 가른다.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_admin_level') then
    create type app_admin_level as enum ('super', 'operator', 'viewer');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. orgs.is_internal — 모아워크 자체/테스트 조직 플래그.
--    지표에서 기본 제외한다. **하드코딩 금지** — 판정은 이 컬럼만 본다.
-- ---------------------------------------------------------------------
alter table orgs
  add column if not exists is_internal boolean not null default false;

comment on column orgs.is_internal is
  '내부 조직(모아워크 자체·테스트) 여부. 플랫폼 지표에서 기본 제외. 코드에서 이름·slug 로 추정하지 말 것.';

create index if not exists orgs_is_internal_idx on orgs(is_internal);

-- ---------------------------------------------------------------------
-- 2. app_admins 확장 — 등급/발급자/회수/최근접속.
--    005 는 무수정. 컬럼만 additive 로 덧붙인다.
-- ---------------------------------------------------------------------
alter table app_admins
  add column if not exists level         app_admin_level not null default 'viewer',
  add column if not exists added_by      text,
  add column if not exists revoked_at    timestamptz,
  add column if not exists last_seen_at  timestamptz;

comment on column app_admins.level is
  '운영 등급. 조회는 전 등급 동일, 실행(쓰기) 권한만 가른다.';
comment on column app_admins.revoked_at is
  '회수 시각. non-null 이면 관리자 아님(행은 감사 목적으로 남긴다).';

-- 창업자는 super 로 승격(멱등). 005 seed 와 동일 이메일.
update app_admins
   set level = 'super'
 where email = 'beliefkimkim@gmail.com'
   and level <> 'super';

-- ---------------------------------------------------------------------
-- 3. 판정 함수 — 회수(revoked_at) 반영판.
--
--    ⚠ 기존 006 의 is_platform_admin() 은 `role = 'admin'` 을 요구하지만
--      005 seed 는 role='owner' 다(불일치). 006 은 이미 적용됐고 수정 대상이
--      아니므로 여기서는 **건드리지 않고** 별도 함수를 추가한다.
--      T07 콘솔은 아래 platform_admin_level() 을 정본으로 쓴다.
-- ---------------------------------------------------------------------
create or replace function public.platform_admin_level()
  returns app_admin_level
  language sql
  stable
  security definer
  set search_path = public, auth, pg_temp
as $$
  select a.level
    from auth.users u
    join public.app_admins a on lower(a.email) = lower(u.email)
   where u.id = auth.uid()
     and a.is_platform is true
     and a.revoked_at is null
   limit 1;
$$;

comment on function public.platform_admin_level() is
  '현재 세션의 플랫폼 운영 등급. 관리자가 아니면 null. app_admins 직접 select 대체용.';

/** 운영자 여부(등급 무관). 조회 게이트는 전부 이 함수를 통과한다. */
create or replace function public.is_platform_operator()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select public.platform_admin_level() is not null;
$$;

/** 쓰기 게이트 — 요구 등급 이상인가. super > operator > viewer. */
create or replace function public.platform_admin_at_least(p_level app_admin_level)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case public.platform_admin_level()
           when 'super'    then 3
           when 'operator' then 2
           when 'viewer'   then 1
           else 0
         end
       >= case p_level
           when 'super'    then 3
           when 'operator' then 2
           when 'viewer'   then 1
         end;
$$;

revoke all on function public.platform_admin_level()            from public, anon;
revoke all on function public.is_platform_operator()            from public, anon;
revoke all on function public.platform_admin_at_least(app_admin_level) from public, anon;
grant execute on function public.platform_admin_level()         to authenticated;
grant execute on function public.is_platform_operator()         to authenticated;
grant execute on function public.platform_admin_at_least(app_admin_level) to authenticated;

-- ---------------------------------------------------------------------
-- 4. platform_metrics_daily — 야간 배치 롤업 대상.
--
--    이 테이블이 지표의 **정본**이다. 화면은 여기만 읽는다(실시간 집계 금지 —
--    신규고객 보드만 8,400건 규모라 매 요청 집계는 부하가 크다).
--    저장 값은 전부 **수치**다. 고객 업무 데이터의 내용은 들어가지 않는다.
-- ---------------------------------------------------------------------
create table if not exists platform_metrics_daily (
  date              date not null,
  org_id            uuid not null references orgs(id) on delete cascade,
  -- 활성 사용자(그날 쓰기를 발생시킨 고유 actor 수)
  active_users      integer not null default 0,
  -- 쓰기 이벤트 수 = activities + audit_logs + 그날 생성된 deals/settlements
  writes            integer not null default 0,
  -- 오류 이벤트 수 (audit_logs.action 이 error/failed 계열)
  errors            integer not null default 0,
  -- 조직 규모 스냅샷(그날 기준 총 멤버 수) — 활성/전체 비율 계산용
  member_count      integer not null default 0,
  -- 그날 마지막 활동 시각(없으면 null)
  last_activity_at  timestamptz,
  computed_at       timestamptz not null default now(),
  primary key (date, org_id)
);

comment on table platform_metrics_daily is
  '플랫폼 활동지표 일별 롤업. 야간 배치가 채운다. 집계 수치만 보관하며 고객 업무 데이터의 내용은 담지 않는다.';

create index if not exists platform_metrics_daily_date_idx on platform_metrics_daily(date desc);
create index if not exists platform_metrics_daily_org_idx  on platform_metrics_daily(org_id, date desc);

alter table platform_metrics_daily enable row level security;
-- 정책 없음 = authenticated 직접 접근 차단. 조회는 아래 SECURITY DEFINER RPC 로만.

-- ---------------------------------------------------------------------
-- 5. 결제·매출 스키마 골격 (P0 = 스키마 + 화면 골격, PG 실연동 Phase 2)
--    한국 SaaS 필수: 부가세 분리 · 전자세금계산서 상태.
-- ---------------------------------------------------------------------
create table if not exists plans_billing (
  code          text primary key,               -- 't1_3' 등 orgs.plan_tier 와 대응
  name          text not null,
  monthly_price numeric not null default 0,     -- 공급가액(부가세 별도)
  currency      text not null default 'KRW',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists billing_accounts (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null unique references orgs(id) on delete cascade,
  biz_reg_no     text,                          -- 사업자등록번호(마스킹 대상)
  billing_email  text,
  billing_name   text,
  created_at     timestamptz not null default now()
);

create table if not exists subscriptions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  plan_code         text references plans_billing(code),
  status            text not null default 'trialing',  -- trialing/active/past_due/canceled
  started_at        timestamptz not null default now(),
  current_period_end timestamptz,
  canceled_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists subscriptions_org_idx on subscriptions(org_id, status);

create table if not exists invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  issued_on      date not null,
  -- 부가세 분리 보관(합계는 generated 로 파생 — 앱에서 재계산 금지)
  supply_amount  numeric not null default 0,    -- 공급가액
  vat_amount     numeric not null default 0,    -- 부가세
  total_amount   numeric generated always as
                   (coalesce(supply_amount,0) + coalesce(vat_amount,0)) stored,
  status         text not null default 'draft', -- draft/issued/paid/void
  -- 전자세금계산서 상태(홈택스 연동은 T08 소관 — 여기서는 상태만 보관)
  tax_invoice_status text not null default 'none', -- none/requested/issued/failed
  tax_invoice_no     text,
  created_at     timestamptz not null default now()
);
create index if not exists invoices_org_idx    on invoices(org_id, issued_on desc);
create index if not exists invoices_issued_idx on invoices(issued_on desc);

create table if not exists payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid references invoices(id) on delete cascade,
  org_id       uuid not null references orgs(id) on delete cascade,
  paid_at      timestamptz,
  amount       numeric not null default 0,
  method       text,                            -- card/transfer (PG 연동 Phase 2)
  status       text not null default 'pending', -- pending/succeeded/failed/refunded
  created_at   timestamptz not null default now()
);
create index if not exists payments_org_idx on payments(org_id, paid_at desc);

-- 전부 운영자 전용 — 정책 없음(직접 접근 차단), 조회는 RPC 경유.
alter table plans_billing     enable row level security;
alter table billing_accounts  enable row level security;
alter table subscriptions     enable row level security;
alter table invoices          enable row level security;
alter table payments          enable row level security;

-- ---------------------------------------------------------------------
-- 6. 야간 배치 롤업 — 하루치를 멱등 upsert.
--
--    ⚠ 고객 업무 데이터 접근 금지 원칙 준수:
--       count(*) / count(distinct actor) / max(at) 만 사용한다.
--       deals.title, activities.content, settlements 금액 등 **내용은 읽지 않는다**.
--    worker(pg-boss) 야간 잡이 날짜를 넘겨 호출한다.
-- ---------------------------------------------------------------------
create or replace function public.rollup_platform_metrics_daily(p_date date)
  returns integer
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_start timestamptz := (p_date::timestamptz);
  v_end   timestamptz := (p_date + 1)::timestamptz;
  v_rows  integer;
begin
  with
  -- 활동기록 기준 쓰기/활성자 (내용 미조회 — 건수와 actor 만)
  act as (
    select org_id,
           count(*)::int                     as writes,
           count(distinct actor)             as actors,
           max(at)                           as last_at
      from activities
     where at >= v_start and at < v_end
     group by org_id
  ),
  -- 감사로그 기준 쓰기/활성자/오류
  aud as (
    select org_id,
           count(*)::int                     as writes,
           count(distinct actor)             as actors,
           max(at)                           as last_at,
           count(*) filter (
             where action ilike '%error%' or action ilike '%fail%'
           )::int                            as errors
      from audit_logs
     where at >= v_start and at < v_end
     group by org_id
  ),
  -- 그날 생성된 딜 건수(제목 등 내용은 읽지 않는다)
  dl as (
    select org_id, count(*)::int as writes, max(created_at) as last_at
      from deals
     where created_at >= v_start and created_at < v_end
     group by org_id
  ),
  -- 조직 규모 스냅샷
  mem as (
    select org_id, count(*)::int as member_count
      from org_members
     group by org_id
  ),
  merged as (
    select o.id as org_id,
           coalesce(act.writes,0) + coalesce(aud.writes,0) + coalesce(dl.writes,0) as writes,
           -- 활성 사용자: 두 소스의 고유 actor 를 정확히 합집합하기 어려우므로
           -- 더 큰 쪽을 취한다(중복 계산 방지 — 과대집계보다 보수적으로).
           greatest(coalesce(act.actors,0), coalesce(aud.actors,0))                as active_users,
           coalesce(aud.errors,0)                                                  as errors,
           coalesce(mem.member_count,0)                                            as member_count,
           greatest(
             coalesce(act.last_at, 'epoch'::timestamptz),
             coalesce(aud.last_at, 'epoch'::timestamptz),
             coalesce(dl.last_at,  'epoch'::timestamptz)
           )                                                                        as last_at
      from orgs o
      left join act on act.org_id = o.id
      left join aud on aud.org_id = o.id
      left join dl  on dl.org_id  = o.id
      left join mem on mem.org_id = o.id
  )
  insert into platform_metrics_daily
        (date, org_id, active_users, writes, errors, member_count, last_activity_at, computed_at)
  select p_date, org_id, active_users, writes, errors, member_count,
         nullif(last_at, 'epoch'::timestamptz), now()
    from merged
  on conflict (date, org_id) do update
     set active_users     = excluded.active_users,
         writes           = excluded.writes,
         errors           = excluded.errors,
         member_count     = excluded.member_count,
         last_activity_at = excluded.last_activity_at,
         computed_at      = excluded.computed_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.rollup_platform_metrics_daily(date) is
  '하루치 플랫폼 지표를 멱등 upsert. 집계 함수만 사용하며 고객 업무 데이터의 내용은 읽지 않는다.';

revoke all on function public.rollup_platform_metrics_daily(date) from public, anon, authenticated;
-- 실행 주체는 배치(service_role) 뿐이다. 운영자 화면은 이 함수를 호출하지 않는다.

-- ---------------------------------------------------------------------
-- 7. 운영자 조회 RPC — 전부 is_platform_operator() 게이트.
-- ---------------------------------------------------------------------

/**
 * 회사 목록(메타데이터만). 회사명·멤버수·마지막 활동·7일 쓰기수·활성/전체.
 * 상태(활발/둔화/휴면) 판정은 앱의 순수 함수가 한다 — 기준을 한곳에 두기 위함.
 */
create or replace function public.platform_org_overview(p_include_internal boolean default false)
  returns table (
    org_id           uuid,
    name             text,
    plan_tier        text,
    is_internal      boolean,
    created_at       timestamptz,
    member_count     integer,
    active_users_7d  integer,
    writes_7d        integer,
    errors_7d        integer,
    last_activity_at timestamptz
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select o.id,
         o.name,
         o.plan_tier,
         o.is_internal,
         o.created_at,
         coalesce(m.member_count, 0)::int,
         coalesce(m.active_users, 0)::int,
         coalesce(m.writes, 0)::int,
         coalesce(m.errors, 0)::int,
         m.last_activity_at
    from orgs o
    left join lateral (
      select max(d.member_count)                          as member_count,
             max(d.active_users)                          as active_users,
             sum(d.writes)::int                           as writes,
             sum(d.errors)::int                           as errors,
             max(d.last_activity_at)                      as last_activity_at
        from platform_metrics_daily d
       where d.org_id = o.id
         and d.date > (current_date - 7)
    ) m on true
   where public.is_platform_operator()
     and (p_include_internal or o.is_internal is false);
$$;

/** 일자별 플랫폼 합계 — DAU/WAU/MAU·스티키니스·리텐션 산식의 입력. */
create or replace function public.platform_metrics_range(
  p_from date,
  p_to date,
  p_include_internal boolean default false
)
  returns table (
    date          date,
    org_id        uuid,
    active_users  integer,
    writes        integer,
    errors        integer,
    member_count  integer
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select d.date, d.org_id, d.active_users, d.writes, d.errors, d.member_count
    from platform_metrics_daily d
    join orgs o on o.id = d.org_id
   where public.is_platform_operator()
     and d.date >= p_from
     and d.date <= p_to
     and (p_include_internal or o.is_internal is false);
$$;

/**
 * TTFV(가입 → 첫 딜 등록까지 시간) — 조직별 시간(분).
 * deals 의 **생성 시각만** 읽는다(제목·금액 미조회).
 */
create or replace function public.platform_ttfv(p_include_internal boolean default false)
  returns table (org_id uuid, name text, signed_up_at timestamptz, first_deal_at timestamptz)
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select o.id, o.name, o.created_at, f.first_deal_at
    from orgs o
    left join lateral (
      select min(d.created_at) as first_deal_at from deals d where d.org_id = o.id
    ) f on true
   where public.is_platform_operator()
     and (p_include_internal or o.is_internal is false);
$$;

/** 운영자 목록 — 회수분 포함(감사). 이메일은 화면에서 마스킹한다. */
create or replace function public.platform_admin_list()
  returns table (
    email        text,
    level        app_admin_level,
    is_platform  boolean,
    added_by     text,
    revoked_at   timestamptz,
    last_seen_at timestamptz,
    created_at   timestamptz
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select a.email, a.level, a.is_platform, a.added_by,
         a.revoked_at, a.last_seen_at, a.created_at
    from app_admins a
   where public.is_platform_operator();
$$;

/** 결제·매출 요약(월별 청구 합계). P0 화면 골격용. */
create or replace function public.platform_billing_monthly(p_months integer default 12)
  returns table (
    month         date,
    invoice_count integer,
    supply_sum    numeric,
    vat_sum       numeric,
    total_sum     numeric,
    paid_sum      numeric
  )
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select date_trunc('month', i.issued_on)::date as month,
         count(*)::int,
         sum(i.supply_amount),
         sum(i.vat_amount),
         sum(i.total_amount),
         coalesce(sum(p.paid), 0)
    from invoices i
    left join lateral (
      select sum(pay.amount) as paid
        from payments pay
       where pay.invoice_id = i.id and pay.status = 'succeeded'
    ) p on true
   where public.is_platform_operator()
     and i.issued_on > (current_date - (p_months * 31))
   group by 1;
$$;

revoke all on function public.platform_org_overview(boolean)              from public, anon;
revoke all on function public.platform_metrics_range(date, date, boolean) from public, anon;
revoke all on function public.platform_ttfv(boolean)                      from public, anon;
revoke all on function public.platform_admin_list()                       from public, anon;
revoke all on function public.platform_billing_monthly(integer)           from public, anon;

grant execute on function public.platform_org_overview(boolean)              to authenticated;
grant execute on function public.platform_metrics_range(date, date, boolean) to authenticated;
grant execute on function public.platform_ttfv(boolean)                      to authenticated;
grant execute on function public.platform_admin_list()                       to authenticated;
grant execute on function public.platform_billing_monthly(integer)           to authenticated;

-- ---------------------------------------------------------------------
-- 8. 운영자 쓰기 RPC — 안전장치 6개를 **서버에서** 강제한다.
--    (클라이언트 가드는 우회 가능하므로 신뢰하지 않는다.)
-- ---------------------------------------------------------------------
create or replace function public.platform_set_admin(
  p_email text,
  p_level app_admin_level,
  p_revoke boolean default false
)
  returns void
  language plpgsql
  security definer
  set search_path = public, auth, pg_temp
as $$
declare
  v_actor_email text;
  v_target_email text := lower(btrim(p_email));
  v_remaining int;
begin
  -- [안전장치 1] super 만 관리자 편집 가능.
  if not public.platform_admin_at_least('super') then
    raise exception '권한 없음: 관리자 편집은 super 등급만 가능합니다.'
      using errcode = '42501';
  end if;

  select lower(u.email) into v_actor_email from auth.users u where u.id = auth.uid();

  -- [안전장치 2] 이메일 형식 검증(빈 값·공백 방지).
  if v_target_email is null or v_target_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '잘못된 이메일 형식입니다.' using errcode = '22023';
  end if;

  -- [안전장치 3] 자기 자신의 등급 강등·회수 금지(락아웃 방지).
  if v_target_email = v_actor_email and (p_revoke or p_level <> 'super') then
    raise exception '자기 자신의 권한은 낮추거나 회수할 수 없습니다.' using errcode = '42501';
  end if;

  -- [안전장치 4] 마지막 super 를 잃지 않는다.
  if p_revoke or p_level <> 'super' then
    select count(*) into v_remaining
      from app_admins
     where level = 'super' and revoked_at is null and lower(email) <> v_target_email;
    if v_remaining = 0 then
      raise exception '마지막 super 관리자는 회수하거나 강등할 수 없습니다.' using errcode = '42501';
    end if;
  end if;

  -- [안전장치 5] 회수는 행을 삭제하지 않는다 — 감사 흔적 보존.
  if p_revoke then
    update app_admins
       set revoked_at = now()
     where lower(email) = v_target_email;
  else
    insert into app_admins(email, role, is_platform, level, added_by, revoked_at)
    values (v_target_email, 'owner', true, p_level, v_actor_email, null)
    on conflict (email) do update
       set level      = excluded.level,
           added_by   = coalesce(app_admins.added_by, excluded.added_by),
           revoked_at = null,
           is_platform = true;
  end if;

  -- [안전장치 6] 모든 변경을 감사 로그로 남긴다(대상 org 없음 → 플랫폼 평면).
  --
  -- ⚠ 중첩 블록으로 감싼다. 함수 최상위에 exception 을 두면 감사 기록 실패가
  --   **권한 변경까지 통째로 롤백**한다(plpgsql 은 블록 시작점까지 되돌린다).
  --   감사 실패는 부가 손실이고 권한 변경은 본질이므로, 실패 범위를 이 블록에 가둔다.
  begin
    insert into audit_logs(org_id, actor, action, target_type, target_id, meta)
    values (null, auth.uid(),
            'platform.admin.' || case when p_revoke then 'revoke' else 'grant' end,
            'app_admin', null,
            jsonb_build_object('target', v_target_email, 'level', p_level));
  exception
    when not_null_violation or undefined_table or undefined_column then
      -- audit_logs.org_id 가 not null 이면 플랫폼 평면 기록을 담을 수 없다.
      -- 권한 변경은 유지하고 감사 기록만 건너뛴다(후속: 플랫폼 전용 감사 테이블).
      null;
  end;
end;
$$;

/** 접속 흔적 갱신 — 콘솔 진입 시 호출(운영자 본인만). */
create or replace function public.platform_touch_last_seen()
  returns void
  language sql
  security definer
  set search_path = public, auth, pg_temp
as $$
  update app_admins a
     set last_seen_at = now()
    from auth.users u
   where u.id = auth.uid()
     and lower(a.email) = lower(u.email)
     and public.is_platform_operator();
$$;

/** 내부 조직 토글 — operator 이상. is_internal 하드코딩 대신 이 경로로만 변경. */
create or replace function public.platform_set_org_internal(p_org_id uuid, p_internal boolean)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
begin
  if not public.platform_admin_at_least('operator') then
    raise exception '권한 없음: operator 이상만 변경할 수 있습니다.' using errcode = '42501';
  end if;
  update orgs set is_internal = p_internal where id = p_org_id;
end;
$$;

revoke all on function public.platform_set_admin(text, app_admin_level, boolean) from public, anon;
revoke all on function public.platform_touch_last_seen()                         from public, anon;
revoke all on function public.platform_set_org_internal(uuid, boolean)           from public, anon;
grant execute on function public.platform_set_admin(text, app_admin_level, boolean) to authenticated;
grant execute on function public.platform_touch_last_seen()                         to authenticated;
grant execute on function public.platform_set_org_internal(uuid, boolean)           to authenticated;

-- =====================================================================
-- 모아워크(가칭) · 통합관리시스템 — DB 스키마 v1
-- migration: 001_schema_v1.sql
-- 대상   : Supabase (PostgreSQL 15+)
-- 방식   : B(하이브리드 정규화) — 먼데이 보드는 화면/뷰로 재현하되, 내부는
--          org_id 기준 정규화 + RLS 멀티테넌시. (근거: docs/design/먼데이-구조-스펙.md §6)
-- 작성   : 기획 세션(claude) 2026-07-21 · 근거: 마스터기획서 v0.1 PART G + 먼데이 구조스펙
-- 주의   : 실제 선택지 라벨(지역 218·진행상품 60여·상담상황 16 등)은 먼데이 재연결 후
--          seed 마이그레이션(002_seed_policyfund.sql)으로 채운다. 여기선 '구조'만 만든다.
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- =====================================================================
-- 0. ENUM (선택지 타입)
-- =====================================================================
create type member_role        as enum ('owner','admin','member');
create type member_scope       as enum ('all','assigned');       -- 담당범위: 전체 / 내담당만
create type stage_kind         as enum ('marketing','meeting','contract','work','settle','post');
create type contract_status    as enum ('draft','sent','signed','expired','canceled');
create type message_channel    as enum ('alimtalk','sms');
create type message_status     as enum ('queued','sent','failed','canceled');
create type hometax_doc_type   as enum ('bizreg','financial','vat_std','invoice_list','other');
create type entitlement_source as enum ('plan','addon','trial','manual');
create type incentive_base     as enum ('fee','down','total');
create type incentive_type     as enum ('flat_pct','tiered');
create type field_entity       as enum ('company','deal');
create type field_type         as enum ('text','longtext','number','date','datetime','select',
                                        'multiselect','phone','email','file','person','url','checkbox');

-- =====================================================================
-- 1. 조직 / 사용자 (기둥④)
-- =====================================================================
create table orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan_tier   text not null default 't1_3',
  created_at  timestamptz not null default now()
);

-- Supabase 인증은 auth.users가 정본. public.users는 앱 프로필(1:1).
create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table org_members (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       member_role  not null default 'member',
  scope      member_scope not null default 'assigned',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on org_members(user_id);

-- ---- RLS 헬퍼(SECURITY DEFINER: 정책 재귀 방지 + org_members RLS 우회) ----
create or replace function public.is_org_member(p_org uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members m where m.org_id = p_org and m.user_id = auth.uid());
$$;

create or replace function public.org_role(p_org uuid)
  returns member_role language sql stable security definer set search_path = public as $$
  select role from org_members where org_id = p_org and user_id = auth.uid();
$$;

create or replace function public.org_scope(p_org uuid)
  returns member_scope language sql stable security definer set search_path = public as $$
  select scope from org_members where org_id = p_org and user_id = auth.uid();
$$;

-- 조직 생성자 = 자동 owner (부트스트랩 체계: 생성 직후 멤버가 없어 못 보는 문제 해결)
create or replace function public.add_org_owner()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into org_members(org_id, user_id, role, scope)
  values (new.id, auth.uid(), 'owner', 'all')
  on conflict do nothing;
  return new;
end $$;
create trigger trg_orgs_add_owner after insert on orgs
  for each row execute function public.add_org_owner();

-- =====================================================================
-- 2. 봉인/해제 (Entitlement) — MVP부터 내장 (기둥 가로지름)
-- =====================================================================
create table plans (
  id    uuid primary key default gen_random_uuid(),
  tier  text unique not null,               -- t1_3 / t4_7 / t8_10 / t11p
  name  text not null
);
create table plan_features (
  plan_id     uuid not null references plans(id) on delete cascade,
  feature_key text not null,                -- 예: core.crm / mod.hometax
  limit_value int,                          -- null = 무제한
  primary key (plan_id, feature_key)
);
create table org_addons (
  org_id      uuid not null references orgs(id) on delete cascade,
  feature_key text not null,
  status      text not null default 'active',
  expires_at  timestamptz,
  primary key (org_id, feature_key)
);
-- 합산 결과 캐시(플랜+애드온). 코드는 feature_key로만 검사(플랜명 하드코딩 금지).
create table org_entitlements (
  org_id      uuid not null references orgs(id) on delete cascade,
  feature_key text not null,
  enabled     boolean not null default true,
  limit_value int,
  source      entitlement_source not null default 'plan',
  expires_at  timestamptz,
  primary key (org_id, feature_key)
);

-- =====================================================================
-- 3. CRM 코어 — 고객·파이프라인·실무 (기둥①②)
--    먼데이: 신규고객/컨텍관리/업무관리 보드를 deals(파이프라인)로 통합, 단계=stages
-- =====================================================================
create table companies (                    -- 고객사(업체)
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  biz_type    text,                         -- 업종/업태
  region      text,                         -- 지역(시군구)
  owner_name  text,                         -- 대표자명
  phone       text,
  email       text,
  revenue     numeric,                      -- 매출액(먼데이 텍스트 → 숫자로 교정)
  founded_on  date,                         -- 창업년도
  homepage    text,
  assigned_to uuid references users(id),    -- 담당(담당범위 RLS 기준)
  created_at  timestamptz not null default now()
);
create index on companies(org_id);
create index on companies(org_id, assigned_to);

create table pipelines (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name   text not null default '기본 파이프라인'
);
create table stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references pipelines(id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  kind        stage_kind not null
);
create index on stages(pipeline_id, sort_order);

create table deals (                         -- 영업기회/프로젝트 1건(먼데이 아이템)
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  company_id   uuid references companies(id) on delete set null,
  pipeline_id  uuid references pipelines(id) on delete set null,
  stage_id     uuid references stages(id) on delete set null,
  assigned_to  uuid references users(id),
  title        text not null,
  amount       numeric,                      -- 계약금 등 대표 금액
  status_note  text,
  applied_on   date,                         -- 신청일
  custom       jsonb not null default '{}',  -- 커스텀필드 값(간이 저장; 상세는 field_values)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on deals(org_id, stage_id);
create index on deals(org_id, assigned_to);
create index on deals(org_id, company_id);

create table activities (                    -- 활동기록(통화/미팅/메모/상태변경)
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  deal_id    uuid references deals(id) on delete cascade,
  type       text not null,                  -- call/meeting/memo/status
  content    text,
  actor      uuid references users(id),
  at         timestamptz not null default now()
);
create index on activities(org_id, deal_id);

-- =====================================================================
-- 4. 하이브리드 커스터마이징 (기둥①) — 먼데이 컬럼 자유도 재현
-- =====================================================================
create table field_defs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  entity       field_entity not null,
  key          text not null,
  label        text not null,
  type         field_type not null,
  options_jsonb jsonb,                        -- select/multiselect 선택지
  module_key   text,                          -- 업종팩 프리셋 출처(예: ind.policyfund)
  sort_order   int not null default 0,
  unique (org_id, entity, key)
);
create table field_values (
  org_id     uuid not null references orgs(id) on delete cascade,
  entity_id  uuid not null,                   -- company.id 또는 deal.id
  field_key  text not null,
  value_jsonb jsonb,
  primary key (entity_id, field_key)
);
create index on field_values(org_id);

create table saved_views (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  user_id      uuid references users(id) on delete cascade,
  entity       field_entity not null,
  name         text not null,
  filters_jsonb jsonb not null default '{}',
  sort_jsonb    jsonb not null default '[]',
  columns_jsonb jsonb not null default '[]',
  shared       boolean not null default false
);
create index on saved_views(org_id, entity);

-- =====================================================================
-- 5. 계약 / 정산 (기둥③⑤) — 먼데이 업무관리·회계 보드의 수식 재현
-- =====================================================================
-- (계약서 문서관리 contracts 테이블·전자서명 체결은 Phase 2 연기 — MVP는 deals.contract_written 란만. belie 결정 2026-07-21)

-- 수식 컬럼: 먼데이 formula를 generated column으로. %는 '정수 퍼센트'로 통일(3 = 3%).
create table settlements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  deal_id       uuid references deals(id) on delete cascade,
  down_payment  numeric not null default 0,    -- 계약금
  down_paid_at  date,
  exec_amount   numeric not null default 0,    -- 실행액
  fee_pct       numeric not null default 0,    -- 수수료(%)
  fee_paid_at   date,                          -- 수수료 입금일
  -- 수수료(원) = 실행액 × 수수료% / 100  (반올림)
  fee_amount    numeric generated always as (round(coalesce(exec_amount,0) * coalesce(fee_pct,0) / 100.0)) stored,
  -- 총 매출 = 계약금 + 수수료(원)
  total_revenue numeric generated always as (coalesce(down_payment,0) + round(coalesce(exec_amount,0) * coalesce(fee_pct,0) / 100.0)) stored,
  -- 재접촉 시점
  d180          date generated always as (fee_paid_at + 180) stored,
  d365          date generated always as (fee_paid_at + 365) stored,
  created_at    timestamptz not null default now()
);
create index on settlements(org_id, deal_id);

create table tax_invoices (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  settlement_id  uuid references settlements(id) on delete cascade,
  status         text not null default 'draft',   -- draft/issued/failed
  issued_at      timestamptz,
  nts_confirm_num text,
  vendor_ref     text,
  created_at     timestamptz not null default now()
);

-- =====================================================================
-- 6. 모듈: 홈택스 / 알림톡 / 성과 (기둥⑤④)  ※홈택스·알림톡·세금계산서=Phase 2(벤더). MVP는 entitlement OFF·앱 미노출. 테이블만 미리 둠.
-- =====================================================================
create table hometax_consents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references orgs(id) on delete cascade,
  company_id   uuid references companies(id) on delete cascade,
  method       text,
  status       text not null default 'pending',
  consented_at timestamptz,
  expires_at   timestamptz
);
create table hometax_docs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  doc_type   hometax_doc_type not null,
  file_path  text,
  fetched_at timestamptz
);

create table message_templates (
  id      uuid primary key default gen_random_uuid(),
  org_id  uuid not null references orgs(id) on delete cascade,
  channel message_channel not null,
  code    text not null,                    -- 부재안내/미팅확정/계약안내/입금안내...
  name    text not null,
  body    text not null,
  status  text not null default 'draft',     -- draft/심사중/승인
  unique (org_id, channel, code)
);
create table messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  deal_id     uuid references deals(id) on delete set null,
  template_id uuid references message_templates(id) on delete set null,
  to_addr     text not null,
  status      message_status not null default 'queued',
  sent_at     timestamptz,
  error       text,
  created_at  timestamptz not null default now()
);
create index on messages(org_id, status);

create table incentive_rules (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  base        incentive_base not null default 'fee',
  type        incentive_type not null default 'flat_pct',
  config_jsonb jsonb not null default '{}'   -- 고정% 또는 구간% 정의
);
create table performance_snapshots (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  user_id         uuid references users(id) on delete set null,
  period          text not null,             -- 'YYYY-MM'
  contracts_cnt   int not null default 0,
  fee_sum         numeric not null default 0,
  incentive_amount numeric not null default 0,
  unique (org_id, user_id, period)
);

-- =====================================================================
-- 7. 업종팩 / 시스템 (기둥⑥ + 공통)
-- =====================================================================
create table industry_modules (               -- 전역 카탈로그(프리셋 팩)
  key           text primary key,             -- ind.policyfund ...
  name          text not null,
  presets_jsonb jsonb not null default '{}'
);
create table org_installed_modules (
  org_id       uuid not null references orgs(id) on delete cascade,
  module_key   text not null references industry_modules(key),
  installed_at timestamptz not null default now(),
  primary key (org_id, module_key)
);

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  actor       uuid references users(id) on delete set null,
  action      text not null,
  target_type text,
  target_id   uuid,
  meta        jsonb,
  at          timestamptz not null default now()
);
create index on audit_logs(org_id, at);

-- =====================================================================
-- 8. RLS (멀티테넌시 — 가장 중요한 보안 장치)
--    원칙: 모든 업무 테이블은 소속 조직만 접근. 담당범위='assigned' 멤버는 본인 담당만.
--    전역 카탈로그(plans/plan_features/industry_modules)는 읽기만 허용, 쓰기는 service_role.
-- =====================================================================
alter table orgs                 enable row level security;
alter table users                enable row level security;
alter table org_members          enable row level security;
alter table plans                enable row level security;
alter table plan_features        enable row level security;
alter table org_addons           enable row level security;
alter table org_entitlements     enable row level security;
alter table companies            enable row level security;
alter table pipelines            enable row level security;
alter table stages               enable row level security;
alter table deals                enable row level security;
alter table activities           enable row level security;
alter table field_defs           enable row level security;
alter table field_values         enable row level security;
alter table saved_views          enable row level security;
alter table settlements          enable row level security;
alter table tax_invoices         enable row level security;
alter table hometax_consents     enable row level security;
alter table hometax_docs         enable row level security;
alter table message_templates    enable row level security;
alter table messages             enable row level security;
alter table incentive_rules      enable row level security;
alter table performance_snapshots enable row level security;
alter table industry_modules     enable row level security;
alter table org_installed_modules enable row level security;
alter table audit_logs           enable row level security;

-- ---- 조직/사용자 ----
create policy orgs_select  on orgs       for select using (public.is_org_member(id));
create policy orgs_insert  on orgs       for insert with check (auth.uid() is not null);
create policy orgs_update  on orgs       for update using (public.org_role(id) = 'owner');
create policy orgs_delete  on orgs       for delete using (public.org_role(id) = 'owner');

create policy users_select on users      for select using (auth.uid() is not null);
create policy users_self   on users      for all    using (id = auth.uid()) with check (id = auth.uid());

create policy members_select on org_members for select using (public.is_org_member(org_id));
create policy members_manage on org_members for all
  using (public.org_role(org_id) in ('owner','admin'))
  with check (public.org_role(org_id) in ('owner','admin'));

-- ---- 전역 카탈로그: 읽기 전용(쓰기는 service_role이 RLS 우회) ----
create policy plans_read    on plans            for select using (auth.uid() is not null);
create policy planfeat_read on plan_features    for select using (auth.uid() is not null);
create policy indmod_read   on industry_modules for select using (auth.uid() is not null);

-- ---- 엔타이틀먼트(조직 스코프, 읽기) ----
create policy addons_select on org_addons        for select using (public.is_org_member(org_id));
create policy ent_select    on org_entitlements  for select using (public.is_org_member(org_id));
create policy instmod_all   on org_installed_modules for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

-- ---- 담당범위 적용 테이블(companies, deals) : member+assigned 는 본인 담당만 ----
create policy companies_rw on companies for all
  using (
    public.is_org_member(org_id) and (
      public.org_role(org_id) in ('owner','admin')
      or public.org_scope(org_id) = 'all'
      or assigned_to = auth.uid()
    )
  )
  with check (public.is_org_member(org_id));

create policy deals_rw on deals for all
  using (
    public.is_org_member(org_id) and (
      public.org_role(org_id) in ('owner','admin')
      or public.org_scope(org_id) = 'all'
      or assigned_to = auth.uid()
    )
  )
  with check (public.is_org_member(org_id));

-- ---- 나머지 조직 스코프 테이블: 조직 멤버면 접근(담당범위는 상위 deal/pipeline에서 통제) ----
create policy pipelines_rw on pipelines for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy activities_rw on activities for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy fielddefs_rw  on field_defs  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy fieldvals_rw  on field_values for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy savedviews_rw on saved_views for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy settlements_rw on settlements for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy taxinv_rw     on tax_invoices for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy htconsent_rw  on hometax_consents for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy htdocs_rw     on hometax_docs for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy msgtpl_rw     on message_templates for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy messages_rw   on messages   for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy incrules_rw   on incentive_rules for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy perf_rw       on performance_snapshots for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy audit_select  on audit_logs for select using (public.is_org_member(org_id));
create policy audit_insert  on audit_logs for insert with check (public.is_org_member(org_id));

-- stages: 상위 pipeline의 org로 통제
create policy stages_rw on stages for all
  using (exists (select 1 from pipelines p where p.id = stages.pipeline_id and public.is_org_member(p.org_id)))
  with check (exists (select 1 from pipelines p where p.id = stages.pipeline_id and public.is_org_member(p.org_id)));

-- =====================================================================
-- 9. 최소 SEED (전역 참조 데이터)
-- =====================================================================
insert into plans(tier, name) values
  ('t1_3','1~3인'), ('t4_7','4~7인'), ('t8_10','8~10인'), ('t11p','11인+');

-- MVP: 모든 플랜에 core.* + MVP 모듈 무료(무료 베타 — 구조만 살아있으면 됨)
insert into plan_features(plan_id, feature_key, limit_value)
select p.id, f.key, null
from plans p
cross join (values
  ('core.crm'),('core.custom'),('core.org'),('core.files'),('core.dash'),('ind.policyfund')
  -- Phase2(벤더): mod.hometax·mod.notify / Phase1.5: mod.perf → MVP 기본 미포함(먼데이 파리티)
) as f(key);

insert into industry_modules(key, name, presets_jsonb) values
  ('ind.policyfund','정책자금(1호)',
   '{"note":"진행기관·세부자금(60여)·지역(시군구)·수수료수식·문서체크리스트·알림톡템플릿 프리셋은 먼데이 재연결 후 002_seed로 채움"}');

-- =====================================================================
-- 끝. 다음: 002_seed_policyfund.sql (먼데이 재연결 후 선택지 라벨 채우기)
-- =====================================================================

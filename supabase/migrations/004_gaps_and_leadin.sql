-- =====================================================================
-- 004_gaps_and_leadin.sql — 실측 갭(G1·G2·G6·G7·G8) + D15 리드 자동수집
-- 성격 : 001~003 위에 additive. 001~003 무수정.
-- 근거 : docs/design/먼데이-실측-버튼시퀀스-DB매핑_v0.1.md(§5·§7 belie 확정)
--        + 마스터기획서 v0.1의 2026-07-21 증분(D15·O18).
-- 작성 : 기획-Cowork 2026-07-21 (worklog 선언·단독 writer 확인 후 작성)
-- =====================================================================

-- ---------- G7. 상태(status) 컬럼 타입 ----------
-- select(드롭다운)와 구분되는 먼데이식 '상황클릭' 타입.
-- 라벨 규약(options_jsonb): {"labels":[{"id":0,"label":"상담 전","hex":"#c4c4c4","is_done":false,"index":0}, ...]}
alter type field_type add value if not exists 'status';

-- ---------- G1. 하위아이템 ----------
alter table items add column if not exists parent_item_id uuid references items(id) on delete cascade;
create index if not exists idx_items_parent on items(parent_item_id);

-- ---------- G6. 활동 답글(스레드) + 말풍선 배지 ----------
alter table activities add column if not exists parent_activity_id uuid references activities(id) on delete cascade;
create index if not exists idx_activities_parent on activities(parent_activity_id);

-- ---------- G2. 보드 뷰 탭 저장 ----------
create table if not exists board_views (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  board_id      uuid not null references boards(id) on delete cascade,
  name          text not null,
  type          text not null default 'table',     -- table/kanban/chart(후속)
  filters_jsonb jsonb not null default '{}',
  sort_jsonb    jsonb not null default '[]',
  columns_jsonb jsonb not null default '[]',       -- 표시·순서·폭·숨김
  sort_order    int  not null default 0,
  created_by    uuid references users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_board_views_board on board_views(board_id);

-- ---------- G8. 상태→그룹 이동 단일 레시피 ----------
create table if not exists board_automation_rules (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references orgs(id) on delete cascade,
  board_id          uuid not null references boards(id) on delete cascade,
  status_column_key text not null,                 -- board_columns.key (type='status')
  status_value      text not null,                 -- 라벨 문자열
  to_group_id       uuid not null references board_groups(id) on delete cascade,
  enabled           boolean not null default true,
  created_at        timestamptz not null default now(),
  unique (board_id, status_column_key, status_value)
);
create index if not exists idx_bar_board on board_automation_rules(board_id);

-- ---------- D15. 광고 리드 자동수집 (core.leadin) ----------
create table if not exists lead_source_configs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references orgs(id) on delete cascade,
  source              text not null check (source in ('meta','google','naver','form')),
  enabled             boolean not null default false,
  mapping_jsonb       jsonb not null default '{}',   -- 폼필드→CRM필드 매핑
  credential_ref      text,                          -- 비밀값 아님: 외부 보관 참조키
  default_pipeline_id uuid references pipelines(id) on delete set null,
  default_assignee    uuid references users(id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (org_id, source)
);

create table if not exists lead_intake_events (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references orgs(id) on delete cascade,
  source           text not null,
  external_lead_id text not null,                   -- 멱등 키
  payload_jsonb    jsonb not null default '{}',     -- 원문 보관(감사)
  status           text not null default 'received'
                   check (status in ('received','mapped','created','duplicate','error')),
  error            text,
  company_id       uuid references companies(id) on delete set null,
  deal_id          uuid references deals(id) on delete set null,
  received_at      timestamptz not null default now(),
  unique (org_id, source, external_lead_id)
);
create index if not exists idx_lead_events_org on lead_intake_events(org_id, received_at);

-- ---------- RLS ----------
alter table board_views            enable row level security;
alter table board_automation_rules enable row level security;
alter table lead_source_configs    enable row level security;
alter table lead_intake_events     enable row level security;

create policy boardviews_rw on board_views for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy bar_select on board_automation_rules for select
  using (public.is_org_member(org_id));
create policy bar_manage on board_automation_rules for all
  using (public.org_role(org_id) in ('owner','admin'))
  with check (public.org_role(org_id) in ('owner','admin'));

create policy leadcfg_select on lead_source_configs for select
  using (public.is_org_member(org_id));
create policy leadcfg_manage on lead_source_configs for all
  using (public.org_role(org_id) in ('owner','admin'))
  with check (public.org_role(org_id) in ('owner','admin'));

-- 인입 이벤트: 조직원 읽기 전용(쓰기는 워커가 service_role로 — RLS 우회)
create policy leadevents_select on lead_intake_events for select
  using (public.is_org_member(org_id));

-- =====================================================================
-- 끝. 적용 순서: 001 → 002 → 003 → 004. (PLAN-v0.2 동기화·타입 재생성은 기획2)
-- =====================================================================

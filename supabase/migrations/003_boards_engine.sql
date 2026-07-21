-- =====================================================================
-- 003_boards_engine.sql — 사용자 임의 보드 생성 엔진 (D4 변경: ADR-0003)
-- 성격 : 001(정책자금 typed 코어) 위에 additive. 001 무수정.
--        deals/pipelines/stages/settlements 는 그대로 typed 유지(정산 수식·RLS·업종팩 보존).
--        사용자가 새로 만드는 임의 보드는 여기(boards/items EAV)에 저장.
-- 재사용: 001의 field_type enum(13종) + is_org_member/org_role/org_scope 헬퍼.
-- 선행 : 001_schema_v1.sql (→ 002 → 003 순서로 적용)
-- 작성 : 기획 세션(claude) 2026-07-21 — 스키마 정본은 기획 세션이 단독 작성(ADR-0002 규칙)
-- =====================================================================

create table boards (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  name       text not null,
  description text,
  icon       text,
  is_system  boolean not null default false,
  source     text,
  sort_order int not null default 0,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on boards(org_id);

create table board_groups (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  board_id   uuid not null references boards(id) on delete cascade,
  name       text not null,
  color      text,
  sort_order int not null default 0
);
create index on board_groups(board_id);

create table board_columns (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  board_id      uuid not null references boards(id) on delete cascade,
  key           text not null,
  label         text not null,
  type          field_type not null,
  options_jsonb jsonb,
  sort_order    int not null default 0,
  width         int,
  unique (board_id, key)
);
create index on board_columns(board_id);

create table items (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  board_id    uuid not null references boards(id) on delete cascade,
  group_id    uuid references board_groups(id) on delete set null,
  title       text not null,
  assigned_to uuid references users(id),
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on items(org_id, board_id);
create index on items(board_id, group_id);

create table item_values (
  org_id      uuid not null references orgs(id) on delete cascade,
  item_id     uuid not null references items(id) on delete cascade,
  column_key  text not null,
  value_jsonb jsonb,
  primary key (item_id, column_key)
);
create index on item_values(org_id);

create table board_views (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  board_id              uuid not null references boards(id) on delete cascade,
  user_id               uuid references users(id) on delete cascade,
  name                  text not null,
  kind                  text not null default 'table',
  filters_jsonb         jsonb not null default '{}',
  sort_jsonb            jsonb not null default '[]',
  visible_columns_jsonb jsonb not null default '[]',
  shared                boolean not null default false
);
create index on board_views(board_id);

alter table boards        enable row level security;
alter table board_groups  enable row level security;
alter table board_columns enable row level security;
alter table items         enable row level security;
alter table item_values   enable row level security;
alter table board_views   enable row level security;

create policy boards_rw   on boards        for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy bgroups_rw  on board_groups  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy bcols_rw    on board_columns for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy bviews_rw   on board_views   for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy itemvals_rw on item_values   for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create policy items_rw on items for all
  using (
    public.is_org_member(org_id) and (
      public.org_role(org_id) in ('owner','admin')
      or public.org_scope(org_id) = 'all'
      or assigned_to = auth.uid()
    )
  )
  with check (public.is_org_member(org_id));

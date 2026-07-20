-- 0002_core_crm.sql — core.crm 도메인 (영업코어 / T02)
-- 먼데이 보드 미러 + 파이프라인. 구현 방식 B(하이브리드 정규화):
--   사용자 화면은 먼데이와 동일(보드·컬럼·상태·수식), 내부는 정규화 + RLS.
--
-- 경계(다른 트랙 소유 영역, 여기서 정의하지 않음):
--   - 조직/멤버십 모델(core.org)과 RLS **정책 본체**는 T03 소유.
--     이 파일은 org_id 컬럼 + `enable row level security`(정책 없음 = fail-closed)까지만 둔다.
--     T03 이 org 멤버십 기반 정책을 후속 마이그레이션으로 추가한다(defense-in-depth).
--     그 전까지 앱은 service_role(서버)로 접근하고 **앱 레이어에서 org_id 스코핑**한다.
--   - 커스텀필드 옵션/선택지 관리(core.custom)는 T05 소유.
--     board_columns 는 보드 미러의 최소 골격만 두고, T05 가 옵션/커스터마이징을 확장한다.

-- 공통: updated_at 자동 갱신 트리거 (moa_ 접두사로 트랙 간 충돌 회피, idempotent)
create or replace function public.moa_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. boards — 보드 (신규고객 / 컨택 / 업무 등)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid        not null,
  name        text        not null,
  description text,
  position    int         not null default 0,
  archived    boolean     not null default false,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists boards_org_idx on public.boards (org_id) where archived = false;

create trigger boards_set_updated_at
  before update on public.boards
  for each row execute function public.moa_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. pipeline_stages — 파이프라인 단계
--    기본 4단계: 상담중 → 계약대기 → 진행중 → 완료 (보드별 세트)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid        not null,
  board_id    uuid        not null references public.boards (id) on delete cascade,
  key         text        not null,   -- consulting | awaiting_contract | in_progress | done
  label       text        not null,   -- 상담중 | 계약대기 | 진행중 | 완료
  position    int         not null,
  color       text,
  is_terminal boolean     not null default false,  -- 완료 등 종료 단계
  created_at  timestamptz not null default now(),
  unique (board_id, key)
);

create index if not exists pipeline_stages_board_idx
  on public.pipeline_stages (board_id, position);

-- ─────────────────────────────────────────────────────────────
-- 3. board_columns — 보드 컬럼 정의 (먼데이 컬럼 미러)
--    type: text | number | date | status | people | formula
--    settings(jsonb): status 라벨, formula_key 등 타입별 메타
--    (옵션/선택지 커스터마이징 확장은 T05 core.custom)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.board_columns (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null,
  board_id   uuid        not null references public.boards (id) on delete cascade,
  key        text        not null,   -- 컬럼 식별자 (보드 내 유일)
  title      text        not null,
  type       text        not null default 'text',
  settings   jsonb       not null default '{}'::jsonb,
  position   int         not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (board_id, key),
  constraint board_columns_type_chk
    check (type in ('text', 'number', 'date', 'status', 'people', 'formula'))
);

create index if not exists board_columns_board_idx
  on public.board_columns (board_id, position);

create trigger board_columns_set_updated_at
  before update on public.board_columns
  for each row execute function public.moa_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. items — 아이템 (보드의 행 / 신규고객·컨택·업무 레코드)
--    stage_id = 파이프라인 위치의 단일 진실원(빠른 조회·자동화 구동).
--    상태(status) 컬럼은 stage_id 로부터 파생 렌더(이중기록 회피).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.items (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null,
  board_id     uuid        not null references public.boards (id) on delete cascade,
  stage_id     uuid        references public.pipeline_stages (id) on delete set null,
  name         text        not null default '',
  position     int         not null default 0,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz          -- 완료 단계 진입 시 자동 스탬프
);

create index if not exists items_board_idx on public.items (board_id, position);
create index if not exists items_stage_idx on public.items (stage_id);
create index if not exists items_org_idx   on public.items (org_id);

create trigger items_set_updated_at
  before update on public.items
  for each row execute function public.moa_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 5. column_values — 아이템×컬럼 값 (정규화된 셀)
--    값은 jsonb 로 타입 유연성 확보(먼데이 셀 재현).
--    수식(formula) 컬럼은 저장하지 않고 앱에서 계산 → 여기엔 입력 컬럼만 저장.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.column_values (
  item_id    uuid        not null references public.items (id) on delete cascade,
  column_id  uuid        not null references public.board_columns (id) on delete cascade,
  org_id     uuid        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (item_id, column_id)
);

create index if not exists column_values_column_idx on public.column_values (column_id);

create trigger column_values_set_updated_at
  before update on public.column_values
  for each row execute function public.moa_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 6. saved_views — 저장뷰 (필터 + 정렬 + 표시 컬럼)
--    config(jsonb): { filters:[...], sorts:[...], visibleColumns:[...] }
-- ─────────────────────────────────────────────────────────────
create table if not exists public.saved_views (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null,
  board_id   uuid        not null references public.boards (id) on delete cascade,
  name       text        not null,
  config     jsonb       not null default '{}'::jsonb,
  is_default boolean     not null default false,
  created_by uuid,
  position   int         not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_views_board_idx on public.saved_views (board_id, position);

create trigger saved_views_set_updated_at
  before update on public.saved_views
  for each row execute function public.moa_set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- RLS: 전 테이블 활성화 (정책 없음 = fail-closed).
--   org 멤버십 기반 정책은 T03(core.org) 후속 마이그레이션에서 추가.
--   그 전까지 접근은 service_role(RLS 우회) + 앱 레이어 org 스코핑.
-- ─────────────────────────────────────────────────────────────
alter table public.boards          enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.board_columns   enable row level security;
alter table public.items           enable row level security;
alter table public.column_values   enable row level security;
alter table public.saved_views     enable row level security;

-- 스키마 버전 갱신
insert into public.app_meta (key, value)
values ('schema_version', '0002')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

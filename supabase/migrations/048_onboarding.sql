-- ONBOARDING-ENGINE-048 (BBE-112)
-- D45b: 온보딩 = 자동화 규칙에서 퀘스트를 생성. 연습용 회사에서 실제 조작으로 판정.
-- D71~D75: 연습 회사도 «빈 상태에서 구조만 있는» 진짜 워크스페이스와 같은 원리를 따른다.
--
-- 격리 방식: 새 컬럼·새 게이트를 만들지 않는다. 연습 회사 = 001 의 진짜 orgs 행 하나
-- (고유 org_id). 001 의 모든 RLS·is_org_member()·org_scope() 가 이미 org_id 로 스코프돼
-- 있으므로 그 경계에 공짜로 올라탄다 — 별도 필터를 코드 전역에 추가하지 않는다.
-- 이 마이그레이션은 "이 org_id 는 연습용이고 소유자는 누구인가"만 기록하는 레지스트리와,
-- 그 레지스트리를 근거로 한 하드 가드(is_my_practice_workspace) 를 추가한다.
--
-- 퀘스트 판정 계약(BBE-113 이 기다리는 것): judge_kind 는 고정 어휘(자유 SQL 아님) +
-- judge_params(jsonb). BBE-113 은 자동화 규칙을 이 스키마의 행으로 변환해 넣는다.
-- 실제 판정(=state 를 읽어 통과 여부를 계산하는 것)은 SQL 이 아니라 앱 레이어가 한다 —
-- 003 의 boards/items 테이블은 현재 런타임에서 쓰이지 않고(getBoardsRepo() 가 여전히
-- LocalBoardsRepo 인메모리 싱글턴만 반환), 실제 상태는 BoardsRepo 포트로만 보인다.
-- 그래서 SQL 쪽엔 "판정 함수"가 없다 — 판정 결과를 기록하는 RPC만 있다.

create table if not exists public.onboarding_practice_workspaces (
  org_id        uuid primary key references public.orgs(id) on delete cascade,
  owner_user_id uuid not null unique references public.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table if not exists public.onboarding_quest_defs (
  quest_key   text primary key check (quest_key ~ '^[a-z0-9][a-z0-9:_-]{0,95}$'),
  title       text not null,
  description text,
  judge_kind  text not null check (judge_kind in (
    'item_created',
    'item_in_group',
    'column_value_set'
  )),
  judge_params jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.onboarding_quest_progress (
  org_id       uuid not null references public.orgs(id) on delete cascade,
  quest_key    text not null references public.onboarding_quest_defs(quest_key) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (org_id, quest_key)
);

alter table public.onboarding_practice_workspaces enable row level security;
alter table public.onboarding_quest_progress enable row level security;
alter table public.onboarding_quest_defs enable row level security;
revoke all on table public.onboarding_practice_workspaces,
  public.onboarding_quest_progress, public.onboarding_quest_defs
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 연습 회사 격리 — 이 함수가 «경계가 무너지지 않는다»를 보장하는 유일한 지점이다.
-- ---------------------------------------------------------------------------
create or replace function public.is_my_practice_workspace(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.onboarding_practice_workspaces
     where org_id = p_org_id and owner_user_id = auth.uid()
  );
$$;

grant execute on function public.is_my_practice_workspace(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 연습 회사 확보 — 없으면 만들고, 있으면 그 org_id 를 돌려준다(멱등).
-- orgs 에 행을 넣으면 001 의 add_org_owner 트리거가 호출자를 자동으로 owner 로 만든다
-- (001 무수정 — 이미 있는 장치를 그대로 쓴다).
-- ---------------------------------------------------------------------------
create or replace function public.ensure_my_practice_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_existing uuid;
  v_org uuid;
begin
  if v_actor is null then
    raise exception 'authenticated user required' using errcode = '42501';
  end if;

  select org_id into v_existing
    from public.onboarding_practice_workspaces
   where owner_user_id = v_actor;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.orgs(name) values ('연습 회사') returning id into v_org;
  insert into public.onboarding_practice_workspaces(org_id, owner_user_id)
  values (v_org, v_actor);

  return v_org;
end;
$$;

grant execute on function public.ensure_my_practice_workspace() to authenticated;

-- 내 연습 회사가 있으면 그 org_id를 돌려준다. 조회는 생성과 분리해 페이지 진입만으로
-- 연습 회사를 만들지 않는다.
create or replace function public.read_my_practice_workspace()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select org_id
    from public.onboarding_practice_workspaces
   where owner_user_id = auth.uid();
$$;

grant execute on function public.read_my_practice_workspace() to authenticated;

-- ---------------------------------------------------------------------------
-- 퀘스트 카탈로그 조회 — 민감정보 아님(구조 메타데이터). 로그인만 있으면 된다.
-- ---------------------------------------------------------------------------
create or replace function public.list_onboarding_quests()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'questKey', q.quest_key,
      'title', q.title,
      'description', q.description,
      'judgeKind', q.judge_kind,
      'judgeParams', q.judge_params
    ) order by q.sort_order, q.quest_key), '[]'::jsonb)
  from public.onboarding_quest_defs q;
$$;

grant execute on function public.list_onboarding_quests() to authenticated;

-- ---------------------------------------------------------------------------
-- 판정 결과 기록 — 앱 레이어가 BoardsRepo 상태를 읽어 «실제로 했다»고 판단한 뒤에만
-- 호출한다. p_org_id 가 호출자의 연습 회사가 아니면 무조건 막는다 — 진짜 조직에는
-- 이 경로가 절대 닿지 않는다.
-- ---------------------------------------------------------------------------
create or replace function public.record_quest_progress(p_org_id uuid, p_quest_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_my_practice_workspace(p_org_id) then
    raise exception 'not the caller''s practice workspace' using errcode = '42501';
  end if;
  if not exists (select 1 from public.onboarding_quest_defs where quest_key = p_quest_key) then
    raise exception 'unknown quest key' using errcode = '22023';
  end if;

  insert into public.onboarding_quest_progress(org_id, quest_key)
  values (p_org_id, p_quest_key)
  on conflict (org_id, quest_key) do nothing;

  return jsonb_build_object('recorded', true);
end;
$$;

grant execute on function public.record_quest_progress(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 내 연습 회사의 진행 상태 조회.
-- ---------------------------------------------------------------------------
create or replace function public.read_my_practice_progress(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_my_practice_workspace(p_org_id) then
    raise exception 'not the caller''s practice workspace' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('questKey', p.quest_key, 'completedAt', p.completed_at))
    from public.onboarding_quest_progress p
    where p.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.read_my_practice_progress(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 퀘스트 씨드 v1 — BBE-113 이 규칙 기반 퀘스트를 추가하기 전까지의 최소 동작 세트.
-- judge_kind 는 app/src/lib/onboarding/quests.ts 의 평가자와 1:1 대응해야 한다.
-- ---------------------------------------------------------------------------
insert into public.onboarding_quest_defs (quest_key, title, description, judge_kind, judge_params, sort_order)
values
  ('create-first-item', '항목 하나 만들어보기', '아무 보드에나 항목을 하나 추가해 보세요.', 'item_created', '{}'::jsonb, 1),
  ('move-item-group', '상태 옮겨보기', '항목의 상태(그룹)를 다른 단계로 옮겨 보세요.', 'item_in_group', '{"excludeDefaultGroup": true}'::jsonb, 2),
  ('fill-item-value', '값 채워보기', '항목의 칸(컬럼)에 값을 하나 입력해 보세요.', 'column_value_set', '{}'::jsonb, 3)
on conflict (quest_key) do nothing;

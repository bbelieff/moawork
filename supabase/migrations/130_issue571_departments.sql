-- moa-migration-guard: logical_key=130_issue571_departments predecessor=129_issue558_dispatch_lineage_notifications digest=c720a4675758a2b01ba81675f3afcd25a9093bdcbd0485bcd38d102a61d6e98f foundation=false

select public.begin_guarded_migration(
  p_logical_key => '130_issue571_departments',
  p_file_name => '130_issue571_departments.sql',
  p_file_digest => 'c720a4675758a2b01ba81675f3afcd25a9093bdcbd0485bcd38d102a61d6e98f',
  p_expected_predecessor => '129_issue558_dispatch_lineage_notifications',
  p_executor => 'DC',
  p_thread_id => '019ff5c1-2e83-7a41-b6d2-8c47a1e0f933',
  p_foundation => false
);

-- #571 — 조직관리에 «부서» 를 도입한다.
--
-- 왜 필요한가
--   목업의 조직관리는 부제부터 「조직도 · 조직원 · 보고 계통 · 알림 대상」이고
--   화면 중심이 **부서 트리**다. 그런데 제품에는 부서라는 것이 아예 없었다
--   (실측 2026-08-26: dept/team 이름의 테이블 0건).
--   지금 화면은 대표/팀장/사원 평평한 목록이라 목업과 다른 물건이다.
--
--   그리고 알림 수신자 계약에는 이미 `watching_department` 라는 갈래가 «이름만» 있다.
--   부서가 생겨야 그 갈래가 진짜가 된다.
--
-- ★ 빈 상태가 기본이다 (CLAUDE.md)
--   이 마이그레이션은 부서를 **하나도 만들지 않는다.** 새 워크스페이스는 부서 0개로 시작하고,
--   부서는 그 회사가 직접 만든다. 예시 부서를 심으면 남의 회사 조직도를 제품에 박는 것이다.
--
-- 트리인데 왜 parent_id 하나뿐인가
--   조직도는 «한 부모» 다. 여러 부모를 허용하면 «보고 계통» 이 갈라져서
--   알림 대상 계산이 답을 두 개 갖게 된다. 사람은 여러 부서에 걸칠 수 있지만(아래 배정 표),
--   부서 자체는 한 곳에만 매달린다.

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- 같은 회사 안에서 이름은 유일하다. 「영업팀」이 둘이면 대상 지정이 모호해진다.
  name text not null,
  parent_id uuid references public.departments(id) on delete cascade,
  -- 책임자. **공석을 허용한다** — 목업이 「책임자 공석 — 보고가 상위로 넘어갑니다」를 그린다.
  head_user_id uuid references public.users(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_name_not_blank check (btrim(name) <> ''),
  constraint departments_not_self_parent check (parent_id is null or parent_id <> id)
);

create unique index if not exists departments_org_name_key
  on public.departments (org_id, name);
create index if not exists departments_org_parent_idx
  on public.departments (org_id, parent_id, sort_order);

comment on table public.departments is
  '#571 — 회사의 조직도. 빈 상태가 기본이며 제품이 예시 부서를 심지 않는다.';
comment on column public.departments.head_user_id is
  '#571 — 책임자. 공석(null)을 허용한다 — 공석이면 보고가 상위 부서로 넘어간다.';

-- 사람↔부서. 한 사람이 여러 부서에 걸칠 수 있다(겸직·파견).
create table if not exists public.org_member_departments (
  org_id uuid not null references public.orgs(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (department_id, user_id)
);

create index if not exists org_member_departments_org_user_idx
  on public.org_member_departments (org_id, user_id);

comment on table public.org_member_departments is
  '#571 — 사람↔부서 배정. 한 사람이 여러 부서에 걸칠 수 있다(겸직·파견).';

-- ── 조직 경계 ────────────────────────────────────────────────
-- 이 저장소의 다른 표와 «같은 눈» 을 쓴다 — is_org_member(org_id).
-- 직접 조건을 새로 쓰면 경계가 두 벌이 되고, 한쪽만 고쳐질 때 남의 회사가 새어 나온다.
alter table public.departments enable row level security;
alter table public.org_member_departments enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select using (public.is_org_member(org_id));

-- 조직도를 바꾸는 것은 «회사의 모양» 을 바꾸는 일이다 — owner/admin 만.
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments
  for all using (public.app_admin_role() is not null or exists (select 1 from public.org_members m where m.org_id = departments.org_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin')))
  with check ((public.app_admin_role() is not null or exists (select 1 from public.org_members m where m.org_id = departments.org_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin'))));

drop policy if exists org_member_departments_select on public.org_member_departments;
create policy org_member_departments_select on public.org_member_departments
  for select using (public.is_org_member(org_id));

drop policy if exists org_member_departments_write on public.org_member_departments;
create policy org_member_departments_write on public.org_member_departments
  for all using (public.app_admin_role() is not null or exists (select 1 from public.org_members m where m.org_id = org_member_departments.org_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin')))
  with check ((public.app_admin_role() is not null or exists (select 1 from public.org_members m where m.org_id = org_member_departments.org_id and m.user_id = auth.uid() and m.status = 'active' and m.role in ('owner','admin'))));

do $$
declare
  v_missing text;
begin
  -- 전제가 아니라 «결과» 를 잰다 — 096 이 전제만 재고 통과한 채 망가진 적이 있다.
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='departments' and rowsecurity) then
    raise exception 'departments must have RLS enabled';
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='org_member_departments' and rowsecurity) then
    raise exception 'org_member_departments must have RLS enabled';
  end if;

  select string_agg(name, ', ' order by name) into v_missing
  from unnest(array['departments_select','departments_write']) name
  where not exists (select 1 from pg_policies where schemaname='public' and tablename='departments' and policyname=name);
  if v_missing is not null then raise exception 'departments policies missing: %', v_missing; end if;

  -- ★ 빈 상태가 기본이다. 이 마이그레이션이 부서를 심지 않았음을 «세어서» 확인한다.
  if (select count(*) from public.departments) > 0 then
    raise exception '이 마이그레이션은 부서를 만들지 않는다 — 예시 조직도를 제품에 심으면 안 된다';
  end if;
end $$;

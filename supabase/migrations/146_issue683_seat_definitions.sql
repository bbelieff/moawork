-- moa-migration-guard: logical_key=146_issue683_seat_definitions predecessor=145_issue652_org_logo_limit digest=7f59182b4a8f9a9a35b6134ad487ab536c7d0f0de4a66882ed60eee7640876ea foundation=false

select public.begin_guarded_migration(
  p_logical_key => '146_issue683_seat_definitions',
  p_file_name => '146_issue683_seat_definitions.sql',
  p_file_digest => '7f59182b4a8f9a9a35b6134ad487ab536c7d0f0de4a66882ed60eee7640876ea',
  p_expected_predecessor => '145_issue652_org_logo_limit',
  p_executor => 'DC',
  p_thread_id => '9f4c1e02-7a3b-4d18-b6c5-2e8a1d09f7b4',
  p_foundation => false
);

-- 「자리」의 역할 정의서 (#683 · D안 1단계).
--
-- ## 왜
--
-- 총괄 지시 — 「사람보다 그 사람이 했던 역할이 중요하고 누가 들어와도 전에 내 역할을 맡은 사람이
-- 뭘 하고 있었는지 보고 똑같이 할 수 있게 만드는 게 중요해」
--
-- ## ★ 새 «엔티티» 를 만들지 않는다
--
-- 자리 = (부서 × 역할) 조합이다. 이 표는 자리를 «만들지» 않고, 그 조합에 붙는
-- «정의서와 메모» 만 담는다. 부서를 지우면 정의서도 같이 사라진다(on delete cascade) —
-- 그게 맞다. 자리가 없어졌으니까.
--
-- 자리를 1급 엔티티로 올리는 것은 3단계(#685)다. 지금 조직관리는 실측 «조작 0건» 이라,
-- 크게 만들기 전에 «쓰이는지» 부터 확인한다.
--
-- ## 넓히기만 한다
--
-- ★ 새 표 하나를 더할 뿐 기존 표는 건드리지 않는다. 고객 행 UPDATE/DELETE 0.

create table if not exists public.seat_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- null = 부서 미배정 자리. 그 사람들도 자리를 갖는다.
  department_id uuid references public.departments(id) on delete cascade,
  role public.member_role not null,

  -- 「이 자리는 무엇을 책임지나」 한 줄.
  summary text check (summary is null or length(btrim(summary)) between 1 and 400),
  -- 주기별 할 일. [{cycle:'daily'|'weekly'|'monthly', text:'…'}]
  duties jsonb not null default '[]'::jsonb,
  -- 판단 기준. {escalate:[], handle:[], avoid:[]}
  rules jsonb not null default '{}'::jsonb,
  -- 「잘하고 있다는 신호」
  signals text check (signals is null or length(btrim(signals)) between 1 and 400),
  -- 인수인계 메모 — 다음 사람에게 남기는 말.
  handover text check (handover is null or length(btrim(handover)) between 1 and 4000),

  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ★ 한 자리에 정의서는 하나다. department_id 가 null 일 수 있어 부분 인덱스를 둘로 나눈다
--   (Postgres 에서 null 은 unique 에서 서로 다르게 취급된다).
create unique index if not exists seat_definitions_dept_role_uidx
  on public.seat_definitions(org_id, department_id, role)
  where department_id is not null;
create unique index if not exists seat_definitions_nodept_role_uidx
  on public.seat_definitions(org_id, role)
  where department_id is null;

alter table public.seat_definitions enable row level security;
alter table public.seat_definitions force row level security;

-- 읽기 — 그 조직의 «활성» 구성원이면 본다. 자기 자리를 알아야 일할 수 있다.
create policy seat_definitions_read on public.seat_definitions for select to authenticated using (
  exists (
    select 1 from public.org_members m
     where m.org_id = seat_definitions.org_id and m.user_id = auth.uid() and m.status = 'active'
  )
);

revoke all on public.seat_definitions from public, anon, authenticated, service_role;
grant select on public.seat_definitions to authenticated;

-- ## 쓰기는 RPC 로만 — 대표와 관리자만
--
-- ★ 화면에서 버튼을 감추는 것으로는 아무것도 못 막는다. 서버가 거부해야 한다.

create or replace function public.save_seat_definition(
  p_org_id uuid,
  p_department_id uuid,
  p_role public.member_role,
  p_summary text,
  p_duties jsonb,
  p_rules jsonb,
  p_signals text,
  p_handover text
) returns public.seat_definitions
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_row public.seat_definitions;
begin
  if v_actor is null then raise exception 'permission_denied' using errcode = '42501'; end if;

  select m.role into v_role from public.org_members m
   where m.org_id = p_org_id and m.user_id = v_actor and m.status = 'active';
  if not found or v_role not in ('owner', 'admin') then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  -- 부서를 줬으면 «이 조직의» 부서여야 한다. 남의 조직 부서에 정의서를 달 수 없다.
  if p_department_id is not null and not exists (
    select 1 from public.departments d where d.id = p_department_id and d.org_id = p_org_id
  ) then
    raise exception 'seat_department_mismatch' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_duties, '[]'::jsonb)) <> 'array' then
    raise exception 'seat_duties_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rules, '{}'::jsonb)) <> 'object' then
    raise exception 'seat_rules_invalid' using errcode = '22023';
  end if;

  /*
   * ★ on conflict 를 쓰지 않는다. 부분 인덱스가 «둘» 이라(부서 있는 자리 / 없는 자리)
   *   한쪽만 겨냥하면 다른 쪽이 처리되지 않고 그냥 터진다.
   *   null 을 제대로 견주려면 = 이 아니라 is not distinct from 이어야 한다.
   */
  update public.seat_definitions
     set summary = nullif(btrim(coalesce(p_summary, '')), ''),
         duties = coalesce(p_duties, '[]'::jsonb),
         rules = coalesce(p_rules, '{}'::jsonb),
         signals = nullif(btrim(coalesce(p_signals, '')), ''),
         handover = nullif(btrim(coalesce(p_handover, '')), ''),
         updated_by = v_actor,
         updated_at = now()
   where org_id = p_org_id
     and role = p_role
     and department_id is not distinct from p_department_id
  returning * into v_row;

  if not found then
    insert into public.seat_definitions(
      org_id, department_id, role, summary, duties, rules, signals, handover, updated_by, updated_at
    ) values (
      p_org_id, p_department_id, p_role,
      nullif(btrim(coalesce(p_summary, '')), ''),
      coalesce(p_duties, '[]'::jsonb),
      coalesce(p_rules, '{}'::jsonb),
      nullif(btrim(coalesce(p_signals, '')), ''),
      nullif(btrim(coalesce(p_handover, '')), ''),
      v_actor, now()
    )
    returning * into v_row;
  end if;

  return v_row;
end $$;

revoke all on function public.save_seat_definition(uuid, uuid, public.member_role, text, jsonb, jsonb, text, text) from public, anon;
grant execute on function public.save_seat_definition(uuid, uuid, public.member_role, text, jsonb, jsonb, text, text) to authenticated;

-- ## 적용 뒤 사실 확인

do $$
declare
  v_cols int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'seat_definitions'
     and column_name in ('org_id','department_id','role','summary','duties','rules','signals','handover');
  if v_cols <> 8 then
    raise exception '자리 정의서 컬럼이 모자랍니다: %', v_cols using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='seat_definitions' and cmd='SELECT'
  ) then
    raise exception '읽기 정책이 없습니다' using errcode = '42501';
  end if;

  -- ★ 쓰기 정책이 «없어야» 한다. 쓰기는 RPC 로만 — 표에 직접 못 쓴다.
  if exists (
    select 1 from pg_policies where schemaname='public' and tablename='seat_definitions' and cmd <> 'SELECT'
  ) then
    raise exception '표에 직접 쓰는 길이 열려 있습니다' using errcode = '42501';
  end if;

  -- 적용만으로는 아무 행도 안 생긴다.
  if exists (select 1 from public.seat_definitions) then
    raise exception '적용만 했는데 행이 있습니다' using errcode = '22023';
  end if;
end $$;

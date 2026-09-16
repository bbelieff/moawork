-- moa-migration-guard: logical_key=148_platform_customer_ops predecessor=147_invite_links digest=411bfac47566d9d62dd294af1f52c9c309729a00d2aeb1716ce895002faba0e1 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '148_platform_customer_ops',
  p_file_name => '148_platform_customer_ops.sql',
  p_file_digest => '411bfac47566d9d62dd294af1f52c9c309729a00d2aeb1716ce895002faba0e1',
  p_expected_predecessor => '147_invite_links',
  p_executor => 'NC-01',
  p_thread_id => '01a0aacf-8d09-7ee0-a87a-e4b7f6b239d2',
  p_foundation => false
);

-- 148_platform_customer_ops — ADMIN 고객 운영(고객사 대장) 영속 계층.
--
-- 왜: /platform/organizations 는 지금까지 승인 대기열(요청)과 집계 숫자만 봤다.
--     실제 고객 목록·상세·세팅/지원 작업·관리 이력을 플랫폼 관리자 범위에서
--     읽고 쓸 영속 구조가 없었다. 목업의 예시 회사를 제품에 넣지 않고,
--     빈 워크스페이스 규칙(보드 0·회사 0·만든 사람 1명)을 건드리지 않으면서
--     운영자가 고객을 등록→초대 안내→세팅→지원하는 흐름을 기록한다.
--
-- 무엇을 넓히나: 새 표 3개 + 새 함수 8개 + 내부 헬퍼 2개. 기존 표·함수·정책·RLS를 건드리지 않는다.
--   특히 147 invite_links RPC/마이그레이션은 손대지 않는다(보안 PR733 범위).
--   owner 이전 기능은 만들지 않는다(다음 단계).
--
-- 경계:
--   · 읽기는 narrowly scoped: 회사명·슬러그·상태·인원 수·작업 수만. 업무 기록,
--     이메일, 초대 토큰, org_members 원본 행을 플랫폼 목록에 노출하지 않는다.
--   · 가드는 8개 RPC 모두 fail-closed: auth.uid() + member_account_session_valid()
--     IS NOT TRUE + is_platform_admin() IS NOT TRUE 중 하나라도면 42501. 세션
--     무효(만료·취소)는 JWT가 남아도 DB에서 거부한다.
--   · 대장은 active-only: provisioning/suspended/pending_delete/deleted에는
--     쓰지 않고(P0002) 들어가지도 않는다. 목록도 active만 보인다.
--   · 초대는 attest + derived: invite_state 저장값은 'pending'|'sent'만(운영자 기록).
--     'active'(대표 참여 중)는 파생값이다 — 활성 owner 행의 주인이 플랫폼
--     운영자가 아닐 때만 'active'로 보고하고, 'active'를 직접 쓰는 호출은 거부한다.
--     일반 두 번째 구성원이나 두 번째 운영자는 대표로 세지 않는다.
--     플랫폼 직접 생성 회사는 owner가 운영자뿐이라 'pending'(대표 확인 필요)으로
--     시작하고, 이를 대표 참여로 말하지 않는다.
--   · 회사 진입(can_enter)은 active 회사의 기존 활성 멤버십 진실만 돌려준다.
--     forged id는 P0002이며 멤버십·지원 범위·owner 권한을 새로 만들지 않는다.
--     자동 가입도 없다. 초대 관리(can_manage)는 활성 owner 본인만 true다.
--   · 감사는 고정 라벨·상태 enum + task_id 참조만. 작업 제목 원문을 history에
--     복사하지 않고(표시할 때는 작업 저장소의 현재 제목을 쓴다), 길이 상한으로 강제한다.
--     작업 목록은 최대 200건으로 묶는다.
--   · 업종은 프로필 없으면 '미설정'이다. 옛 회사를 경영컨설팅으로 단정하지 않으며,
--     명시적 프로필 등록 때 기본값 경영컨설팅이 들어간다.
--   · 템플릿 적용 상태는 기록용 칸(template_key/applied_at)만 둔다. 기록이 없으면
--     «적용 기록 없음»으로 말하고 미적용으로 단정하지 않는다. 플랫폼 측에서
--     구조 설치를 직접 실행하지 않는다(후속 단계).

create table if not exists public.platform_customer_profiles (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  industry text not null default '경영컨설팅',
  setup_status text not null default 'setting_up',
  invite_state text not null default 'pending',
  template_key text,
  template_applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_customer_profiles_industry_len
    check (char_length(industry) between 1 and 40),
  constraint platform_customer_profiles_setup_check
    check (setup_status in ('setting_up', 'active')),
  constraint platform_customer_profiles_invite_check
    check (invite_state in ('pending', 'sent')),
  constraint platform_customer_profiles_template_len
    check (template_key is null or char_length(template_key) between 1 and 80)
);

create table if not exists public.platform_customer_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  title text not null,
  kind text not null,
  status text not null default 'todo',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_customer_tasks_title_len
    check (char_length(title) between 1 and 120),
  constraint platform_customer_tasks_kind_check
    check (kind in ('setup', 'support')),
  constraint platform_customer_tasks_status_check
    check (status in ('todo', 'in_progress', 'done'))
);

create index if not exists platform_customer_tasks_org_idx
  on public.platform_customer_tasks(org_id, created_at desc, id desc);

create table if not exists public.platform_customer_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_label text not null,
  before_state text not null default '',
  after_state text not null default '',
  memo text not null default '',
  task_id uuid references public.platform_customer_tasks(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint platform_customer_history_label_len
    check (char_length(event_label) between 1 and 120),
  constraint platform_customer_history_before_len
    check (char_length(before_state) between 0 and 120),
  constraint platform_customer_history_after_len
    check (char_length(after_state) between 0 and 120),
  constraint platform_customer_history_memo_len
    check (char_length(memo) between 0 and 300)
);

create index if not exists platform_customer_history_org_idx
  on public.platform_customer_history(org_id, created_at desc, id desc);

alter table public.platform_customer_profiles enable row level security;
alter table public.platform_customer_profiles force row level security;
alter table public.platform_customer_tasks enable row level security;
alter table public.platform_customer_tasks force row level security;
alter table public.platform_customer_history enable row level security;
alter table public.platform_customer_history force row level security;

-- 직접 읽기·쓰기를 아무에게도 주지 않는다. 아래 SECURITY DEFINER 함수만 통한다.
revoke all on table public.platform_customer_profiles from public, anon, authenticated;
revoke all on table public.platform_customer_tasks from public, anon, authenticated;
revoke all on table public.platform_customer_history from public, anon, authenticated;

-- 이미 만들어진 history 표에 task_id가 없으면 더한다(148 미적용 환경은 위 create로 충분).
alter table public.platform_customer_history
  add column if not exists task_id uuid references public.platform_customer_tasks(id) on delete set null;

/*
 * 플랫폼 운영자 판정(행당 사용자) — 대표 검증용 내부 헬퍼.
 *
 * is_platform_admin()은 «지금 로그인한 사람»만 본다. 대표 참여를 거짓 없이
 * 말하려면 «그 회사의 owner 행 주인»이 운영자인지도 봐야 한다. 이 함수는
 * auth.users + app_admins를 안에서 join하고 boolean만 돌려준다 — 이메일·id를
 * 호출자에게 노출하지 않는다. 직접 호출은 막고(아래 revoke) 내부 파생에만 쓴다.
 */
create or replace function public.platform_customer_is_operator(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
      from auth.users u
      join public.app_admins a on lower(a.email) = lower(u.email)
     where u.id = p_user_id
       and a.is_platform is true
  );
$$;

/*
 * 검증된 대표 존재 — 활성 owner 행의 주인이 플랫폼 운영자가 아닐 때만 true.
 *
 * 일반 두 번째 구성원(member/admin)이나 두 번째 운영자는 대표로 세지 않는다.
 * owner가 있어도 주인이 운영자뿐이면 «대표 확인 필요»다. owner 이전 기능은
 * 이 릴리스에 없다(다음 단계) — 여기서 owner를 만들거나 옮기지 않는다.
 * exactly-one-owner 계약(006 unique index)은 그대로 둔다.
 */
create or replace function public.platform_customer_has_verified_owner(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.org_members m
     where m.org_id = p_org_id
       and m.role = 'owner'
       and m.status = 'active'
       and not public.platform_customer_is_operator(m.user_id)
  );
$$;

revoke all on function public.platform_customer_is_operator(uuid) from public, anon, authenticated;
revoke all on function public.platform_customer_has_verified_owner(uuid) from public, anon, authenticated;

/*
 * 고객 목록 — 플랫폼 관리자만. 좁은 등록 메타만 돌려준다.
 *
 * p_status: 'all' | 'setting_up' | 'active' (도입 상태 필터).
 * p_search: 회사명 부분 일치(최대 80자). 비어 있으면 전체.
 * active 회사의 대장만 보인다 — provisioning/suspended/pending_delete/deleted는
 * 없는 것과 같이 말한다(가장 단순한 active-only 대장).
 * invite_state 'active'는 파생: 검증된 대표(활성 owner 행의 주인이 플랫폼
 * 운영자가 아님)가 있을 때만 'active'. 일반 두 번째 구성원이나 두 번째
 * 운영자는 대표로 세지 않는다. 운영자가 직접 만든 회사는 owner가 운영자뿐이라
 * 'pending'(대표 확인 필요)으로 시작하고, 이를 대표 참여로 말하지 않는다.
 * 업종: 프로필 행이 없으면 '미설정'(옛 회사를 경영컨설팅으로 단정하지 않음).
 * 프로필이 생길 때(명시적 등록·가드된 변경) 기본값 경영컨설팅이 들어간다.
 */
create or replace function public.list_platform_customers(
  p_search text,
  p_status text,
  p_limit integer,
  p_offset integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_actor uuid := auth.uid();
  v_search text := btrim(coalesce(p_search, ''));
  v_limit integer := coalesce(p_limit, 50);
  v_offset integer := coalesce(p_offset, 0);
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('all', 'setting_up', 'active') then
    raise exception 'customer status filter invalid' using errcode = '22023';
  end if;
  if char_length(v_search) > 80 then
    raise exception 'customer search too long' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 100 or v_offset < 0 then
    raise exception 'customer page window invalid' using errcode = '22023';
  end if;
  -- LIKE 와일드카드는 탈출한다 — 검색어가 필터를 넓히지 않는다.
  v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');

  return coalesce((
    select jsonb_agg(item.entry order by item.last_activity desc, item.name asc, item.org_id asc)
    from (
      select
        jsonb_build_object(
          'org_id', o.id,
          'name', o.name,
          'slug', o.slug,
          'org_status', o.status,
          'industry', case when p.org_id is null then '미설정' else p.industry end,
          'setup_status', coalesce(p.setup_status, 'setting_up'),
          'invite_state', case
            when public.platform_customer_has_verified_owner(o.id)
            then 'active'
            else coalesce(p.invite_state, 'pending')
          end,
          'member_count', (select count(*) from public.org_members m
                            where m.org_id = o.id and m.status = 'active'),
          'open_task_count', (select count(*) from public.platform_customer_tasks t
                               where t.org_id = o.id and t.status in ('todo', 'in_progress')),
          'updated_at', greatest(
            coalesce(p.updated_at, o.created_at),
            coalesce((select max(h.created_at) from public.platform_customer_history h
                       where h.org_id = o.id), o.created_at),
            coalesce((select max(t.updated_at) from public.platform_customer_tasks t
                       where t.org_id = o.id), o.created_at)
          )
        ) as entry,
        greatest(
          coalesce(p.updated_at, o.created_at),
          coalesce((select max(h.created_at) from public.platform_customer_history h
                     where h.org_id = o.id), o.created_at),
          coalesce((select max(t.updated_at) from public.platform_customer_tasks t
                     where t.org_id = o.id), o.created_at)
        ) as last_activity,
        o.name as name,
        o.id as org_id
      from public.orgs o
      left join public.platform_customer_profiles p on p.org_id = o.id
      where o.status = 'active'
        and (v_search = '' or o.name ilike '%' || v_search || '%' escape '\'
             or o.slug ilike '%' || v_search || '%' escape '\')
        and (p_status = 'all' or coalesce(p.setup_status, 'setting_up') = p_status)
      order by last_activity desc, o.name asc, o.id asc
      limit v_limit offset v_offset
    ) item
  ), '[]'::jsonb);
end;
$$;

/*
 * 고객 상세 — 플랫폼 관리자만. 목록과 같은 좁은 범위 + 진입·관리 가능 여부.
 *
 * active 회사만 연다. pending_delete/deleted 등은 P0002(없는 것과 같이).
 * can_enter는 active 회사의 기존 활성 멤버십 진실이다. false면 화면이 이동 대신
 * "멤버가 아니라 볼 수 없음"을 말한다 — 자동 가입·권한 부여는 없다.
 * can_manage는 «활성 owner 본인»일 때만 true다. 그냥 들어갈 수 있는
 * 일반 구성원(can_enter)은 초대 관리 버튼을 볼 수 없다. 플랫폼 전체에 대한
 * 새 권한을 만들지 않는다 — 이 회사의 실제 owner 행 + active 범위만 본다.
 * invite_state 'active'/has_rep는 검증된 대표(활성 owner가 비운영자)일 때만.
 * template은 기록 칸만 읽는다. 기록이 없으면 «적용 기록 없음»으로 말한다.
 * 업종은 프로필 없으면 '미설정'이다.
 */
create or replace function public.get_platform_customer(
  p_org_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_actor uuid := auth.uid();
  v_org public.orgs%rowtype;
  v_profile public.platform_customer_profiles%rowtype;
  v_member_count integer;
  v_verified boolean;
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  select * into v_org from public.orgs where id = p_org_id;
  if not found or v_org.status is distinct from 'active' then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  select * into v_profile
    from public.platform_customer_profiles where org_id = p_org_id;

  select count(*)::integer into v_member_count
    from public.org_members m
   where m.org_id = p_org_id and m.status = 'active';

  v_verified := public.platform_customer_has_verified_owner(p_org_id);

  return jsonb_build_object(
    'org_id', v_org.id,
    'name', v_org.name,
    'slug', v_org.slug,
    'org_status', v_org.status,
    'industry', case when v_profile.org_id is null then '미설정' else v_profile.industry end,
    'setup_status', coalesce(v_profile.setup_status, 'setting_up'),
    'invite_state', case when v_verified then 'active'
                         else coalesce(v_profile.invite_state, 'pending') end,
    'member_count', v_member_count,
    'has_rep', v_verified,
    'open_task_count', (select count(*) from public.platform_customer_tasks t
                         where t.org_id = p_org_id and t.status in ('todo', 'in_progress')),
    'can_enter', exists (select 1 from public.org_members m
                          where m.org_id = p_org_id and m.user_id = v_actor
                            and m.status = 'active'),
    'can_manage', exists (select 1 from public.org_members m
                           where m.org_id = p_org_id and m.user_id = v_actor
                             and m.status = 'active' and m.role = 'owner'),
    'template', jsonb_build_object(
      'key', v_profile.template_key,
      'applied_at', v_profile.template_applied_at
    ),
    'updated_at', greatest(
      coalesce(v_profile.updated_at, v_org.created_at),
      coalesce((select max(h.created_at) from public.platform_customer_history h
                 where h.org_id = p_org_id), v_org.created_at),
      coalesce((select max(t.updated_at) from public.platform_customer_tasks t
                 where t.org_id = p_org_id), v_org.created_at)
    )
  );
end;
$$;

/*
 * 도입 상태 변경 — 플랫폼 관리자만. active 회사에만 쓴다.
 *
 * 같은 값이면 no-op이다: 쓰기 없이 끝나고 이력을 남기지 않는다.
 * 값이 달라질 때만 upsert + before→after 이력 1행을 같은 트랜잭션에 남긴다.
 * 부모 org 행을 FOR UPDATE로 잠그므로 같은 회사에 대한 동시 변경은 직렬화된다.
 * pending_delete/deleted 등 비active에는 쓰지 않는다(P0002).
 */
create or replace function public.set_platform_customer_setup(
  p_org_id uuid,
  p_setup_status text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org public.orgs%rowtype;
  v_before text;
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_setup_status is null or p_setup_status not in ('setting_up', 'active') then
    raise exception 'customer setup status invalid' using errcode = '22023';
  end if;
  if p_org_id is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  -- 부모 행을 잠근다 — 같은 회사에 대한 동시 변경을 직렬화한다.
  select * into v_org from public.orgs where id = p_org_id for update;
  if not found or v_org.status is distinct from 'active' then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  -- 변경 전 값 확정(행이 없으면 기본값 'setting_up' — 목록·상세의 coalesce와 동일).
  select setup_status into v_before
    from public.platform_customer_profiles where org_id = p_org_id;
  v_before := coalesce(v_before, 'setting_up');

  if v_before = p_setup_status then
    return jsonb_build_object('ok', true, 'setup_status', p_setup_status, 'changed', false);
  end if;

  insert into public.platform_customer_profiles(org_id, setup_status, updated_at)
  values (p_org_id, p_setup_status, now())
  on conflict (org_id) do update
    set setup_status = excluded.setup_status, updated_at = now();

  insert into public.platform_customer_history(
    org_id, event_label, before_state, after_state, memo, actor_user_id
  ) values (
    p_org_id,
    case when p_setup_status = 'active' then '세팅 완료' else '세팅 다시 열기' end,
    v_before, p_setup_status, '도입 상태 변경', v_actor
  );

  return jsonb_build_object('ok', true, 'setup_status', p_setup_status, 'changed', true);
end;
$$;

/*
 * 대표 초대 기록 — 플랫폼 관리자만. 운영자의 attest(초대 안내 기록) 전용이다.
 * active 회사에만 쓴다.
 *
 * p_invite_state: 'pending' | 'sent'. 'active'는 파생값이라 직접 쓰기를 거부한다.
 * 이미 파생 'active'(검증된 대표 존재)인 회사에는 'sent'를 덮어쓰지 않고
 * changed=false로 끝낸다 — 수락된 사실을 발송 중으로 되돌리지 않는다.
 * 같은 값 재호출은 no-op이며 이력을 남기지 않는다.
 * 복사는 전달이 아니다: 주소 복사와 이 기록은 별개 행동이다.
 */
create or replace function public.record_platform_customer_invite(
  p_org_id uuid,
  p_invite_state text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org public.orgs%rowtype;
  v_before text;
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_invite_state is null or p_invite_state not in ('pending', 'sent') then
    raise exception 'customer invite state invalid' using errcode = '22023';
  end if;
  if p_org_id is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  select * into v_org from public.orgs where id = p_org_id for update;
  if not found or v_org.status is distinct from 'active' then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  -- 파생 'active'는 저장값보다 우선한다. 수락 이후의 'sent' 기록은 무의미하다.
  if public.platform_customer_has_verified_owner(p_org_id) then
    return jsonb_build_object('ok', true, 'invite_state', 'active', 'changed', false);
  end if;

  select invite_state into v_before
    from public.platform_customer_profiles where org_id = p_org_id;
  v_before := coalesce(v_before, 'pending');

  if v_before = p_invite_state then
    return jsonb_build_object('ok', true, 'invite_state', p_invite_state, 'changed', false);
  end if;

  insert into public.platform_customer_profiles(org_id, invite_state, updated_at)
  values (p_org_id, p_invite_state, now())
  on conflict (org_id) do update
    set invite_state = excluded.invite_state, updated_at = now();

  insert into public.platform_customer_history(
    org_id, event_label, before_state, after_state, memo, actor_user_id
  ) values (
    p_org_id, '초대 안내함', v_before, p_invite_state, '대표 수락 대기', v_actor
  );

  return jsonb_build_object('ok', true, 'invite_state', p_invite_state, 'changed', true);
end;
$$;

/*
 * 관리 작업 추가 — 플랫폼 관리자만. active 회사에만 쓴다.
 *
 * p_task_id는 호출자가 만든 idempotency key다. 같은 id·같은 내용 재호출은
 * created=false로 끝나고 이력을 중복하지 않는다. 같은 id에 다른 내용은 거부한다.
 * 감사는 원문을 복사하지 않는다: after는 상태 enum('todo'), memo는 구분 고정
 * 라벨, task_id로 작업 저장소의 현재 제목을 참조한다. actor는 DB가 기록한다.
 */
create or replace function public.create_platform_customer_task(
  p_task_id uuid,
  p_org_id uuid,
  p_title text,
  p_kind text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_org public.orgs%rowtype;
  v_title text := btrim(coalesce(p_title, ''));
  v_existing public.platform_customer_tasks%rowtype;
  v_inserted integer;
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_task_id is null then
    raise exception 'task id required' using errcode = '22023';
  end if;
  if p_org_id is null then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;
  if char_length(v_title) not between 1 and 120 then
    raise exception 'customer task title length invalid' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('setup', 'support') then
    raise exception 'customer task kind invalid' using errcode = '22023';
  end if;

  select * into v_org from public.orgs where id = p_org_id for update;
  if not found or v_org.status is distinct from 'active' then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  insert into public.platform_customer_tasks(id, org_id, title, kind, status, created_by)
  values (p_task_id, p_org_id, v_title, p_kind, 'todo', v_actor)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
    from public.platform_customer_tasks where id = p_task_id;

  if v_existing.org_id <> p_org_id
     or v_existing.title <> v_title
     or v_existing.kind <> p_kind then
    raise exception 'idempotency key reuse with different task'
      using errcode = '22023';
  end if;

  if v_inserted = 1 then
    insert into public.platform_customer_history(
      org_id, event_label, before_state, after_state, memo, task_id, actor_user_id
    ) values (
      p_org_id, '관리 작업 추가', '없음', 'todo',
      case when p_kind = 'setup' then '초기 세팅 작업 등록' else '지속 지원 작업 등록' end,
      p_task_id, v_actor
    );
    return jsonb_build_object('ok', true, 'task_id', p_task_id, 'created', true);
  end if;

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'created', false);
end;
$$;

/*
 * 관리 작업 상태 변경 — 플랫폼 관리자만. active 회사에만 쓴다.
 *
 * 작업 행을 잠그고 같은 값이면 no-op이다. 다른 회사의 id로 조회해도
 * «없다»고만 말한다(P0002) — 존재 여부를 새지 않는다.
 * 감사는 원문을 복사하지 않는다: before/after는 상태 enum, task_id로 현재
 * 제목을 참조한다. memo는 고정 빈값이다.
 */
create or replace function public.update_platform_customer_task(
  p_task_id uuid,
  p_org_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.platform_customer_tasks%rowtype;
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('todo', 'in_progress', 'done') then
    raise exception 'customer task status invalid' using errcode = '22023';
  end if;
  if p_task_id is null or p_org_id is null then
    raise exception 'customer task not found' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.orgs o
                  where o.id = p_org_id and o.status = 'active') then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  select * into v_task
    from public.platform_customer_tasks
   where id = p_task_id and org_id = p_org_id
   for update;

  if not found then
    raise exception 'customer task not found' using errcode = 'P0002';
  end if;

  if v_task.status = p_status then
    return jsonb_build_object('ok', true, 'task_id', p_task_id, 'status', p_status, 'changed', false);
  end if;

  update public.platform_customer_tasks
     set status = p_status, updated_at = now()
   where id = p_task_id;

  insert into public.platform_customer_history(
    org_id, event_label, before_state, after_state, memo, task_id, actor_user_id
  ) values (
    p_org_id, '작업 상태 변경', v_task.status, p_status, '', p_task_id, v_actor
  );

  return jsonb_build_object('ok', true, 'task_id', p_task_id, 'status', p_status, 'changed', true);
end;
$$;

/* 작업 목록 — 플랫폼 관리자만. active 회사의 작업만, 생성순, 최대 200건. */
create or replace function public.list_platform_customer_tasks(
  p_org_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_org_id is null
     or not exists (select 1 from public.orgs o
                     where o.id = p_org_id and o.status = 'active') then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(item.entry order by item.created_at, item.hid)
    from (
      select
        jsonb_build_object(
          'task_id', t.id,
          'title', t.title,
          'kind', t.kind,
          'status', t.status,
          'created_at', t.created_at,
          'updated_at', t.updated_at
        ) as entry,
        t.created_at as created_at,
        t.id as hid
      from public.platform_customer_tasks t
      where t.org_id = p_org_id
      order by t.created_at, t.id
      limit 200
    ) item
  ), '[]'::jsonb);
end;
$$;

/* 관리 이력 — 플랫폼 관리자만. 고정 라벨·상태 enum + task_id 참조, 최신순. */
create or replace function public.list_platform_customer_history(
  p_org_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := coalesce(p_limit, 200);
begin
  if v_actor is null
     or public.member_account_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if v_limit < 1 or v_limit > 500 then
    raise exception 'customer history window invalid' using errcode = '22023';
  end if;
  if p_org_id is null
     or not exists (select 1 from public.orgs o
                     where o.id = p_org_id and o.status = 'active') then
    raise exception 'customer not found' using errcode = 'P0002';
  end if;

  return coalesce((
    select jsonb_agg(item.entry order by item.created_at desc, item.hid desc)
    from (
      select
        jsonb_build_object(
          'label', h.event_label,
          'before', h.before_state,
          'after', h.after_state,
          'memo', h.memo,
          'task_id', h.task_id,
          'created_at', h.created_at
        ) as entry,
        h.created_at as created_at,
        h.id as hid
      from public.platform_customer_history h
      where h.org_id = p_org_id
      order by h.created_at desc, h.id desc
      limit v_limit
    ) item
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_platform_customers(text, text, integer, integer) from public, anon;
revoke all on function public.get_platform_customer(uuid) from public, anon;
revoke all on function public.set_platform_customer_setup(uuid, text) from public, anon;
revoke all on function public.record_platform_customer_invite(uuid, text) from public, anon;
revoke all on function public.create_platform_customer_task(uuid, uuid, text, text) from public, anon;
revoke all on function public.update_platform_customer_task(uuid, uuid, text) from public, anon;
revoke all on function public.list_platform_customer_tasks(uuid) from public, anon;
revoke all on function public.list_platform_customer_history(uuid, integer) from public, anon;
grant execute on function public.list_platform_customers(text, text, integer, integer) to authenticated;
grant execute on function public.get_platform_customer(uuid) to authenticated;
grant execute on function public.set_platform_customer_setup(uuid, text) to authenticated;
grant execute on function public.record_platform_customer_invite(uuid, text) to authenticated;
grant execute on function public.create_platform_customer_task(uuid, uuid, text, text) to authenticated;
grant execute on function public.update_platform_customer_task(uuid, uuid, text) to authenticated;
grant execute on function public.list_platform_customer_tasks(uuid) to authenticated;
grant execute on function public.list_platform_customer_history(uuid, integer) to authenticated;

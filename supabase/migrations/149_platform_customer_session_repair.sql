-- moa-migration-guard: logical_key=149_platform_customer_session_repair predecessor=148_platform_customer_ops digest=9496043fcc65b270e6cb405b373b3043ef46592543b4cb4ae7c7ffd41d6462dc foundation=false

select public.begin_guarded_migration(
  p_logical_key => '149_platform_customer_session_repair',
  p_file_name => '149_platform_customer_session_repair.sql',
  p_file_digest => '9496043fcc65b270e6cb405b373b3043ef46592543b4cb4ae7c7ffd41d6462dc',
  p_expected_predecessor => '148_platform_customer_ops',
  p_executor => 'NC-01',
  p_thread_id => '01a0aacf-8d09-7ee0-a87a-e4b7f6b239d2',
  p_foundation => false
);

-- 149_platform_customer_session_repair — 고객 RPC 8개의 세션 판정 수리.
--
-- 왜: 148의 8개 RPC는 public.member_account_session_valid()를 썼다.
--   그 함수는 request.jwt.claim.session_id GUC + custom
--   member_account_sessions 레지스트리를 읽는데, hosted에는 session_id
--   클레임을 채우는 배선이 없어 항상 false다(015가 tenant helper에서
--   분리한 바로 그 unwired helper다). 결과: 관리자 셸(is_platform_admin
--   true)은 도는데 고객 RPC 8개가 전부 42501로 거부된다.
--   stub 기반 테스트(app.session_valid 대역)는 이 배선 부재를 가렸다.
--
-- 무엇을 바꾸나: 새 내부 헬퍼 1개 + 8개 RPC의 판정 호출 1줄씩 교체.
--   148 파일·global legacy helper(member_account_session_valid,
--   member_account_sessions)는 건드리지 않는다(삭제·재정의 없음).
--   새 helper는 실제 서명 JWT와 hosted Auth 세션 표만 본다:
--     · 세션 id는 auth.jwt() JSON의 session_id에서만 읽는다. 호출자 인자,
--       legacy request.jwt.claim.session_id GUC, custom 레지스트리는 보지 않는다.
--     · auth.uid() null이면 false. session_id 누락·빈값·uuid 오형식이면 false.
--     · auth.sessions에 id+user_id 행이 없으면 false(revoked/deleted 포함).
--     · 행 주인이 auth.uid()와 다르면 false(wrong-owner).
--     · not_after가 null이 아니고 이미 지났으면 false(expired).
--   canonical is_platform_admin() 검사는 8개 모두 그대로 둔다.
--   수명주기 잠금(FOR UPDATE)·RLS·테이블 revokes·함수 grants는 그대로 둔다.

/*
 * 플랫폼 고객 세션 판정 — 실제 서명 JWT + hosted auth.sessions 기준.
 *
 * 직접 실행은 막고(아래 revoke) 8개 고객 RPC 내부에서만 쓴다.
 */
create or replace function public.platform_customer_session_valid()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_claims jsonb;
  v_session_text text;
  v_session uuid;
begin
  if v_actor is null then
    return false;
  end if;
  begin
    v_claims := auth.jwt();
  exception when others then
    return false;
  end;
  if v_claims is null then
    return false;
  end if;
  v_session_text := nullif(v_claims ->> 'session_id', '');
  if v_session_text is null then
    return false;
  end if;
  begin
    v_session := v_session_text::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1
      from auth.sessions s
     where s.id = v_session
       and s.user_id = v_actor
       and (s.not_after is null or s.not_after > now())
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.platform_customer_session_valid() from public, anon, authenticated;

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
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
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
     or public.platform_customer_session_valid() is not true
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
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
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
     or public.platform_customer_session_valid() is not true
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
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
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
     or public.platform_customer_session_valid() is not true
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
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
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
     or public.platform_customer_session_valid() is not true
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
    p_org_id, case when p_invite_state = 'sent' then '초대 안내함' else '초대 안내 취소' end,
    v_before, p_invite_state, '', v_actor
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
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
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
     or public.platform_customer_session_valid() is not true
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
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
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
     or public.platform_customer_session_valid() is not true
     or public.is_platform_admin() is not true then
    raise exception 'platform admin required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('todo', 'in_progress', 'done') then
    raise exception 'customer task status invalid' using errcode = '22023';
  end if;
  if p_task_id is null or p_org_id is null then
    raise exception 'customer task not found' using errcode = 'P0002';
  end if;

  perform 1 from public.orgs o
    where o.id = p_org_id and o.status = 'active' for update;
  if not found then
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

/* 작업 목록 — 플랫폼 관리자만. active 회사의 작업만, 생성순, 최대 200건.
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
 */
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
     or public.platform_customer_session_valid() is not true
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

/* 관리 이력 — 플랫폼 관리자만. 고정 라벨·상태 enum + task_id 참조, 최신순.
 *
 * 149: 세션 판정만 platform_customer_session_valid()로 교체. 나머지는 148과 동일.
 */
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
     or public.platform_customer_session_valid() is not true
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

-- moa-migration-guard: logical_key=165_invite_links_hardening predecessor=164_item_detail_handoff_resources digest=52688906c46f14a26bb8f218f27dd88ba76766a37f82a7ed6f47c5b93b985439 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '165_invite_links_hardening',
  p_file_name => '165_invite_links_hardening.sql',
  p_file_digest => '52688906c46f14a26bb8f218f27dd88ba76766a37f82a7ed6f47c5b93b985439',
  p_expected_predecessor => '164_item_detail_handoff_resources',
  p_executor => 'DC',
  p_thread_id => '5b8e2f47-9c31-4a06-8d75-e14b3f2a9c60',
  p_foundation => false
);

-- 「사람 부르기」를 안전하게 만든다 — 147 의 뒤처리 (#722).
--
-- ## ★ 왜 147 을 고치지 않고 165 를 만드나
--
-- 147 은 이미 머지됐다(PR #723 · merge 6e75c6b). `begin_guarded_migration` 은
-- **digest 가 아니라 logical_key 로** 판정한다(094:53) — 원장에 그 키가 있으면 23505 로 죽는다.
-- 그래서 147 파일을 아무리 고쳐도 적용된 DB 에는 «절대» 안 닿는다.
-- AGENTS.md §9.1 도 「기존 migration 파일 수정 금지」로 같은 말을 한다.
--
-- 이 실수를 실제로 한 번 했다 — 147 을 두 번 제자리에서 고쳤고, 검수가 잡아 줬다.
--
-- ## 무엇을 고치나 — 검수(PR #723)가 낸 것들
--
--   P1  내보내진 사람이 링크로 «자리째» 돌아온다      ← 제일 크다. 아래 ①
--   P2  「기한없음+무제한 금지」가 큰 수 하나로 뚫린다  ← ②
--   P2  누가 들어왔는지 안 남는다                     ← ③
--   P2  service_role 직접 접근이 남아 있다             ← ④
--   P2  정지·삭제 예정 회사에도 들어가진다             ← ⑤

/* ─────────────────────────────────────────────────────────────
 * ③ 누가 들어왔는지 남긴다 — 승인 단계가 없으므로 유일한 추적 수단이다.
 *
 * 147 은 주석에 「누가 들어왔는지는 남아야 한다」고 적어 놓고 숫자 하나만 남겼다.
 * 링크가 새면 «몇 명» 인지는 알아도 «누구» 인지는 알 방법이 없었다.
 * ───────────────────────────────────────────────────────────── */
create table if not exists public.org_invite_redemptions (
  link_id uuid not null references public.org_invite_links(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete restrict,
  redeemed_at timestamptz not null default now(),
  primary key (link_id, user_id)
);

create index if not exists org_invite_redemptions_user_idx
  on public.org_invite_redemptions(user_id, redeemed_at desc);

alter table public.org_invite_redemptions enable row level security;
alter table public.org_invite_redemptions force row level security;

/* ④ service_role 도 뗀다. 147 이 빠뜨렸다 —
 *   Supabase 의 service_role 은 BYPASSRLS 라 FORCE RLS 로도 안 막힌다.
 *   그러면 「아무에게도 안 준다」가 거짓이 된다. 136·139·146 은 전부 떼고 있었다. */
revoke all on table public.org_invite_links from public, anon, authenticated, service_role;
revoke all on table public.org_invite_redemptions from public, anon, authenticated, service_role;

/* ─────────────────────────────────────────────────────────────
 * ② 「기한 없음 + 무제한」을 막고, 큰 수로 뚫는 길도 막는다.
 *
 * 147 은 둘 다 비울 수 있었다 — 카톡방에 남은 링크가 끄기 전까지 영원히 사는 열쇠가 된다.
 * 하나만 정하면 된다(총괄 결정 2026-09-07): 「30일·무제한」도 「기한없음·1명」도 괜찮다.
 *
 * ★ 그런데 `max_uses = 2147483647` 로 두면 «형식상 제한» 이라 규칙을 통과한다.
 *   검수가 짚은 우회다. 006:643 의 기존 초대가 쓰는 상한(1~1000)을 여기도 쓴다.
 * ───────────────────────────────────────────────────────────── */
create or replace function public.create_org_invite_link(
  p_org_id uuid,
  p_role public.member_role,
  p_scope public.member_scope,
  p_expires_in_days integer,
  p_max_uses integer
) returns jsonb
language plpgsql
security definer
-- ★ extensions 필수 — gen_random_bytes 는 pgcrypto 이고 이 프로젝트는 extensions 에 둔다(#653).
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_token text;
  v_expires timestamptz;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.org_members m
     where m.org_id = p_org_id and m.user_id = v_actor
       and m.status = 'active' and m.role in ('owner','admin')
  ) then
    raise exception 'owner or admin required' using errcode = '42501';
  end if;

  /*
   * ★ 「관리자도 «관리자 자리» 를 줄 수 있다」는 총괄 결정이다 (2026-09-07).
   *   006 은 자리 배정을 대표 전용으로 둔다(013:126 require_owner · 006:625 · 006:879 하드코딩).
   *   여기서 «의도적으로» 넓힌 것이니, 006 주석을 읽고 「165 가 어긴다」고 판단하지 말 것.
   *   그 대가로 ③(누가 들어왔는지 기록)과 ①(내보낸 사람은 못 돌아옴)이 붙는다.
   */
  if p_role = 'owner' then
    raise exception 'owner role cannot be granted by link' using errcode = '22023';
  end if;
  if p_max_uses is not null and (p_max_uses <= 0 or p_max_uses > 1000) then
    raise exception 'max uses must be between 1 and 1000' using errcode = '22023';
  end if;
  if p_expires_in_days is not null and (p_expires_in_days <= 0 or p_expires_in_days > 365) then
    raise exception 'expiry must be between 1 and 365 days' using errcode = '22023';
  end if;
  if p_expires_in_days is null and p_max_uses is null then
    raise exception 'invite link needs an expiry or a use limit' using errcode = '22023';
  end if;

  v_expires := case when p_expires_in_days is null then null
                    else now() + make_interval(days => p_expires_in_days) end;

  v_token := translate(encode(gen_random_bytes(16), 'base64'), '+/=', 'ab');

  insert into public.org_invite_links(org_id, token, role, scope, expires_at, max_uses, created_by)
  values (p_org_id, v_token, p_role, p_scope, v_expires, p_max_uses, v_actor);

  return jsonb_build_object('token', v_token, 'expiresAt', v_expires);
end;
$$;

/* ─────────────────────────────────────────────────────────────
 * ① 예전에 있던 사람은 링크의 «자리» 로 다시 들어온다 — 정지된 사람만 막는다.
 *
 * 결정: belie 2026-09-28 (#733). 처음 판은 비활성 여섯 상태를 전부 needs_approval 로
 * 돌려보냈다. 제품이 그보다 «자유롭게» 하기로 정했다.
 *
 *   suspended                                  → 막는다. 링크도 안 탄다. (정지 = 대표의 판단)
 *   invited · pending · removed · leave · expired → 링크의 역할·범위로 active 가 된다.
 *
 * ★★ 되살리는 것은 «자리» 뿐이다. 권한을 주는 예전 설정은 되살리지 않는다.
 *   나가도 지워지는 데이터가 없다(개인 권한 예외 013 · 부서 050 이 그대로 남는다).
 *   권한 판정이 status='active' 일 때만 그것을 읽으므로, active 로 바꾸는 순간 잠자던 권한이 켜진다.
 *   그래서 여기서 함께 끈다:
 *     - 역할·범위: 예전 값이 아니라 «링크» 의 값. 내보낸 관리자가 구성원 링크로 오면 구성원이다.
 *     - 개인 권한 예외 중 «허용»(decision='allow') 은 지운다. «막기» 는 권한을 줄이므로 남긴다.
 *     - 예전 부서 소속(department_members) 은 지운다. 부서 가시성은 «소속» 만 보므로
 *       남겨 두면 department 범위 링크로 오는 순간 예전 부서 데이터가 보인다(검수 P2).
 *   ★ 링크를 만든 사람이 더 이상 active 대표·관리자가 아니면 그 링크는 죽은 링크다(검수 P1).
 *     내보낸 관리자가 예전에 만든 관리자 링크로 관리자 자리에 돌아오는 길을 막는다.
 *     미리보기·목록도 같은 기준으로 «못 쓴다» 고 말한다.
 *   예전 설정을 «불러오기 / 새로 시작» 으로 고르게 하는 것은 내보내기 기능(#730)과 함께 만든다.
 *
 * ★ 대표가 막는 방법: 링크 «끄기»(revoke_org_invite_link) 와 새 링크 발급, 사람 단위로는 정지.
 *   정지된 사람에게는 정지 사실을 알리지 않는다 — 화면은 «지금은 들어갈 수 없어요» 만 말한다.
 *
 * ★★★ 내보내기를 «행 DELETE» 로 만들면 정지 방어가 무력화된다.
 *   정지된 행을 지우면 v_status 가 null 이 되어 «처음 오는 사람» 으로 링크를 탄다.
 *   정지는 반드시 status='suspended' 로 «표시» 해야 한다.
 *
 * ★ 실패 이유를 여기서만 나눈다. 「없는 링크」와 「죽은 링크」는 계속 한 말(unusable)이지만,
 *   needs_approval 은 «유효한 링크를 가진 사람» 에게 주는 답이라 회사 존재가 새지 않는다.
 * ───────────────────────────────────────────────────────────── */
create or replace function public.redeem_org_invite(p_token text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_link public.org_invite_links;
  v_slug text;
  v_name text;
  v_status text;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- 잠그고 읽는다. 같은 링크를 동시에 눌러도 max_uses 를 안 넘는다.
  select * into v_link from public.org_invite_links where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  if v_link.revoked_at is not null
     or (v_link.expires_at is not null and v_link.expires_at <= now())
     or (v_link.max_uses is not null and v_link.used_count >= v_link.max_uses) then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  -- 만든 사람이 자격을 잃은 링크는 죽은 링크다 (위 ① 참고).
  if not exists (
    select 1 from public.org_members c
     where c.org_id = v_link.org_id and c.user_id = v_link.created_by
       and c.status = 'active' and c.role in ('owner','admin')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  /*
   * ⑤ 정지·삭제 예정 회사에는 못 들어간다. 147 은 회사 상태를 안 봤다.
   *   들어가 봐야 RLS 가 막지만, 「들어왔다」고 말해 놓고 아무것도 안 보이는 것이 더 나쁘다.
   *
   * ★★ 이 «return» 이 구성원 «return» 보다 먼저 도달해야 한다 — 순서를 바꾸지 말 것.
   *   아래 needs_approval 은 회사 «이름» 을 돌려준다. 구성원 응답이 먼저 오면
   *   삭제 예정인 회사의 이름이 옛 구성원에게 새어 나간다. 지금 순서면
   *   문 닫은 회사는 누구에게나 unusable 한 마디만 한다.
   *
   *   ★ 「검사」가 아니라 «응답» 이다. select 는 부작용이 없어서 두 select 의 순서를
   *     바꿔 봐야 아무것도 안 변한다 — 실제로 돌연변이로 확인했다(50개 전부 통과했다).
   *     새는 것은 «어느 return 이 먼저 도달하는가» 뿐이다.
   *     이 문장을 「검사」로 적어 두면 다음 사람의 돌연변이가 1차에서 헛돈다.
   *
   *   시험: invite-links.pglite.test.ts 「★ 옛 구성원에게도 … 검사 순서 불변식」
   *         (removed 인 사람 + pending_delete 회사 → name 없이 unusable)
   */
  select o.slug, o.name into v_slug, v_name
    from public.orgs o where o.id = v_link.org_id and o.status = 'active';
  if v_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  -- 잠그고 읽는다. 같은 사람이 다른 링크로 동시에 눌러도 한 번만 되살아난다.
  select m.status into v_status
    from public.org_members m
   where m.org_id = v_link.org_id and m.user_id = v_actor
     for update;

  if v_status = 'active' then
    -- 이미 이 회사 사람이다. 자리를 안 건드리고 횟수도 안 올린다.
    return jsonb_build_object('ok', true, 'already', true, 'slug', v_slug, 'name', v_name);
  end if;

  if v_status = 'suspended' then
    -- 정지된 사람. 되살리지 «않고» 링크도 «안 태운다». 정지 사실은 화면에서 말하지 않는다.
    return jsonb_build_object('ok', false, 'reason', 'needs_approval', 'name', v_name);
  end if;

  if v_status is not null then
    -- 예전에 있던 사람(invited·pending·removed·leave·expired). 링크의 «자리» 로 되살린다.
    update public.org_members
       set status = 'active', role = v_link.role, scope = v_link.scope
     where org_id = v_link.org_id and user_id = v_actor;
    -- 잠자던 권한은 켜지 않는다 (위 ① 참고).
    delete from public.member_scoped_permission_bindings
     where org_id = v_link.org_id and subject_user_id = v_actor and decision = 'allow';
    delete from public.department_members
     where org_id = v_link.org_id and user_id = v_actor;
  else
    -- 처음 오는 사람. 다른 회사에 속해 있어도 상관없다.
    insert into public.org_members(org_id, user_id, role, scope, status)
    values (v_link.org_id, v_actor, v_link.role, v_link.scope, 'active')
    on conflict (org_id, user_id) do nothing;

    if not found then
      /*
       * 그 사이 다른 요청이 행을 넣었다(행이 없어 위 for update 가 잠글 것이 없었다). 횟수를 안 올린다.
       * ★ 그 행이 active 라는 보장은 없다 — 오늘은 행을 넣는 경로가 전부 active 로 넣어서 참일 뿐이다.
       * ★★ 이 갈래에는 시험이 없다. PGlite 는 연결이 하나라 두 문장 사이에 끼어드는 쓰기를 못 만든다.
       *   시험이 초록이라는 것이 「이 코드가 필요 없다」는 뜻은 아니다.
       */
      select m.status into v_status
        from public.org_members m
       where m.org_id = v_link.org_id and m.user_id = v_actor;
      if v_status is distinct from 'active' then
        return jsonb_build_object('ok', false, 'reason', 'needs_approval', 'name', v_name);
      end if;
      return jsonb_build_object('ok', true, 'already', true, 'slug', v_slug, 'name', v_name);
    end if;
  end if;

  update public.org_invite_links set used_count = used_count + 1 where id = v_link.id;

  insert into public.org_invite_redemptions(link_id, user_id)
  values (v_link.id, v_actor)
  on conflict (link_id, user_id) do update set redeemed_at = now();

  return jsonb_build_object('ok', true, 'already', false, 'slug', v_slug, 'name', v_name);
end;
$$;

/* ⑤ 미리보기도 회사 상태를 본다 — 정지된 회사를 «있다» 고 말하지 않는다. */
create or replace function public.peek_org_invite(p_token text) returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when l.id is null
      or o.id is null
      or l.revoked_at is not null
      or (l.expires_at is not null and l.expires_at <= now())
      or (l.max_uses is not null and l.used_count >= l.max_uses)
      or not exists (
      select 1 from public.org_members c
       where c.org_id = l.org_id and c.user_id = l.created_by
         and c.status = 'active' and c.role in ('owner','admin'))
    then jsonb_build_object('ok', false, 'reason', 'unusable')
    else jsonb_build_object('ok', true, 'name', o.name, 'role', l.role::text, 'scope', l.scope::text)
  end
  from (select 1) probe
  left join public.org_invite_links l on l.token = p_token
  left join public.orgs o on o.id = l.org_id and o.status = 'active';
$$;

/* ③ 「누가 들어왔나」를 목록에 붙인다 — 기록만 남기고 못 보면 없는 것과 같다.
 *   링크가 샜을 때 대표가 «누구를 내보내야 하나» 를 여기서 안다. */
create or replace function public.list_org_invite_links(p_org_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.org_members m
     where m.org_id = p_org_id and m.user_id = v_actor
       and m.status = 'active' and m.role in ('owner','admin')
  ) then
    raise exception 'owner or admin required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'token', l.token, 'role', l.role::text, 'scope', l.scope::text,
      'expiresAt', l.expires_at, 'maxUses', l.max_uses, 'usedCount', l.used_count,
      'revokedAt', l.revoked_at, 'createdAt', l.created_at,
      'usable', l.revoked_at is null
        and (l.expires_at is null or l.expires_at > now())
        and (l.max_uses is null or l.used_count < l.max_uses)
        and exists (
      select 1 from public.org_members c
       where c.org_id = l.org_id and c.user_id = l.created_by
         and c.status = 'active' and c.role in ('owner','admin')),
      'joined', coalesce((
        select jsonb_agg(jsonb_build_object('userId', r.user_id, 'at', r.redeemed_at)
               order by r.redeemed_at desc)
          from public.org_invite_redemptions r where r.link_id = l.id
      ), '[]'::jsonb)
    ) order by l.created_at desc)
    from public.org_invite_links l where l.org_id = p_org_id
  ), '[]'::jsonb);
end;
$$;

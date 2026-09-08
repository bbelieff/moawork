-- moa-migration-guard: logical_key=147_invite_links predecessor=146_issue683_seat_definitions digest=c609a6308d917cd5cfa811d615592557f3917b85b36045b385d114285b3fa365 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '147_invite_links',
  p_file_name => '147_invite_links.sql',
  p_file_digest => 'c609a6308d917cd5cfa811d615592557f3917b85b36045b385d114285b3fa365',
  p_expected_predecessor => '146_issue683_seat_definitions',
  p_executor => 'DC',
  p_thread_id => 'c3f1a86e-40b7-4d92-9c5a-71e2d8b4306f',
  p_foundation => false
);

-- 「사람 부르기」 — 링크로 부른다.
--
-- ## 왜
--
-- 지금은 들어올 사람이 «회사 주소를 알아서» 입력하고 신청하면 대표가 승인한다.
-- 대표가 «먼저 부를» 방법이 없어서, 주소를 따로 알려 줘야 하고 그 사람은 무엇에
-- 들어가는지 모른 채 신청한다. 노션·먼데이는 둘 다 링크로 부른다.
--
-- ★ 메일이 아니라 «링크» 인 이유 — 메일 발송은 발송 설정·자격증명·실제 발송 1건이
--   전부 belie 승인 사항이다(AGENTS.md §5 실행 잠금). 링크는 그 잠금에 안 걸린다.
--   메일 갈래는 잠금이 풀린 뒤 이 표와 이 함수를 «그대로» 쓴다.
--
-- ## ★ 링크를 가진 것이 곧 허가다 — 승인 단계가 없다
--
-- 총괄 결정(2026-09-07). 초대로 온 사람을 또 승인시키지 않는다.
-- 그 대가를 막는 것이 «유효기간 · 횟수 · 끄기» 셋이고, 그래서 셋 다 이 표에 있다.
--
-- 기존 신청→승인 흐름은 «남긴다». 링크 없이 찾아온 사람에게 여전히 필요하다.
--
-- ## 넓히기만 한다
--
-- 새 표 «둘»(링크·들어온 기록)과 새 함수 «다섯». 기존 표·함수·정책을 건드리지 않는다.
-- 되돌리기는 drop table 둘 + drop function 다섯이면 끝난다.
--
-- ★ 이 숫자를 손으로 세어 적었으니, 표나 함수를 더하면 여기도 같이 고쳐라.
--   (처음 판은 「표 하나·함수 둘」이라 적어 놓고 실제로는 다섯이었다.)

create table if not exists public.org_invite_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- ★ 주소에 들어가는 열쇠. 이것 하나가 곧 허가라서 추측 가능하면 안 된다.
  --   길이·문자셋은 만드는 쪽(RPC)이 강제한다.
  token text not null unique,
  -- 들어오면 앉을 자리. ★ 만들 때 박는다 — 받는 사람이 못 고른다.
  role public.member_role not null,
  scope public.member_scope not null,
  -- null 이면 기한 없음.
  expires_at timestamptz,
  -- null 이면 횟수 제한 없음. 0 은 «못 쓰는 링크» 라 의미가 없어 아예 막는다.
  max_uses integer,
  used_count integer not null default 0,
  -- 끈 시각. 샜을 때 즉시 막는 스위치 — 지우는 것보다 이게 먼저다.
  revoked_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint org_invite_links_role_not_owner check (role <> 'owner'),
  constraint org_invite_links_max_uses_positive check (max_uses is null or max_uses > 0),
  constraint org_invite_links_used_count_sane check (used_count >= 0),
  constraint org_invite_links_token_shape check (token ~ '^[A-Za-z0-9]{10,64}$')
);

create index if not exists org_invite_links_org_idx on public.org_invite_links(org_id, created_at desc);

alter table public.org_invite_links enable row level security;
alter table public.org_invite_links force row level security;

/*
 * 링크로 «누가» 들어왔나 — 승인 단계를 없앴으므로 이것이 유일한 추적 수단이다.
 *
 * ★ 처음 판에는 이 표가 없었고, `used_count` 숫자 하나만 남겼다. 그런데 바로 위에
 *   「지우지 않는다: 누가 들어왔는지는 남아야 한다」고 적어 뒀다 — **그 말이 거짓이었다.**
 *   링크가 새면 몇 명이 들어왔는지는 알아도 «누가» 인지는 알 방법이 없었다.
 *   승인하는 사람이 없는 기능에서 그건 치명적이다.
 */
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

/*
 * ★ 직접 읽기·쓰기를 «아무에게도» 주지 않는다.
 *   토큰이 곧 열쇠라서, 목록을 «훑을» 수 있으면 그 자체가 사고다.
 *   읽기는 아래 list 함수가, 쓰기는 create/revoke 함수가 security definer 로 한다.
 *
 * ★★ `service_role` 도 뗀다. 처음 판에는 빠뜨렸다 —
 *   Supabase 의 service_role 은 BYPASSRLS 라 FORCE RLS 로도 안 막힌다.
 *   그러면 「아무에게도 안 준다」가 거짓이 된다. 136·139·146 이 전부 service_role 까지 뗀다.
 */
revoke all on table public.org_invite_links from public, anon, authenticated, service_role;
revoke all on table public.org_invite_redemptions from public, anon, authenticated, service_role;

/*
 * 링크를 만든다 — 대표·관리자만.
 *
 * ★ 토큰을 «서버가» 만든다. 클라이언트가 준 값을 쓰지 않는다 —
 *   그러면 추측 가능한 토큰을 심을 수 있다.
 */
create or replace function public.create_org_invite_link(
  p_org_id uuid,
  p_role public.member_role,
  p_scope public.member_scope,
  p_expires_in_days integer,
  p_max_uses integer
) returns jsonb
language plpgsql
security definer
/*
 * ★ extensions 가 «반드시» 있어야 한다 — 이 함수는 pgcrypto 의 gen_random_bytes 를 쓴다.
 *
 *   이 프로젝트의 pgcrypto 는 public 이 아니라 extensions 에 설치돼 있다.
 *   `public, pg_temp` 만 두면 42883(function does not exist)으로 «항상» 죽는다.
 *   #653 이 정확히 그것이었다 — 보드 컬럼 명령이 한 번도 성공한 적이 없었는데
 *   화면은 「잠시 뒤 다시 시도해 주세요」라고 말했다. 영원히 안 되는데도.
 *   142 가 그 함수들의 search_path 를 넓혀 고쳤고, 새로 만드는 것은 처음부터 이렇게 쓴다.
 */
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
  -- 대표·관리자만. 이미 있는 규칙을 다시 적지 않고 role 을 직접 본다.
  if not exists (
    select 1 from public.org_members m
     where m.org_id = p_org_id and m.user_id = v_actor
       and m.status = 'active' and m.role in ('owner','admin')
  ) then
    raise exception 'owner or admin required' using errcode = '42501';
  end if;
  /*
   * ★ 대표 자리는 링크로 못 준다. 표의 check 와 «같은 말» 을 여기서도 먼저 한다 —
   *   check 로 떨어지면 사용자에게 23514 가 그대로 보인다.
   *
   * ★★ 「관리자도 «관리자 자리» 를 줄 수 있다」는 총괄 결정이다 (2026-09-07).
   *
   *   이건 이 저장소의 기존 자세를 «의도적으로» 넓힌 것이라 여기 적어 둔다.
   *   006 은 자리 배정을 대표 전용으로 두고 그 이유까지 주석에 적어 놨다:
   *       013:126  set_workspace_member_hierarchy_role_scope  → require_owner
   *       006:625  create_workspace_invite_code               → 대표 전용
   *       006:879  신청 승인 → 'member','assigned' 하드코딩
   *                주석: "The payload cannot choose a role or scope … never becomes owner/admin"
   *
   *   그래서 「관리자가 관리자를 무제한 늘릴 수 있다」가 «사고가 아니라 결정» 임을
   *   여기 남긴다. 006 주석을 읽고 「147 이 어긴다」고 판단하지 말 것 —
   *   대신 그 대가로 아래 두 가지가 붙는다:
   *     ① 누가 들어왔는지 org_invite_redemptions 에 남는다
   *     ② 영원+무제한 링크를 만들 수 없다 (아래)
   */
  if p_role = 'owner' then
    raise exception 'owner role cannot be granted by link' using errcode = '22023';
  end if;
  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'max uses must be positive' using errcode = '22023';
  end if;
  if p_expires_in_days is not null and (p_expires_in_days <= 0 or p_expires_in_days > 365) then
    raise exception 'expiry must be between 1 and 365 days' using errcode = '22023';
  end if;
  /*
   * ★ 「기한 없음 + 횟수 무제한」은 못 만든다 (총괄 결정 2026-09-07).
   *
   *   승인 단계를 없앤 대가를 막는 것이 «유효기간 · 횟수 · 끄기» 셋인데,
   *   처음 판은 앞의 둘을 «둘 다» 비울 수 있었다. 그러면 카톡방에 남은 링크가
   *   «끄기 전까지 영원히» 살아 있는 열쇠가 된다.
   *
   *   하나만 정하면 된다 — 「30일·무제한」도 「기한없음·1명」도 괜찮다.
   *   기존 초대(006:643)는 둘 다 강제하는데, 여기는 링크를 계속 돌려 쓰는 쓰임이 있어
   *   한 쪽만 요구한다.
   */
  if p_expires_in_days is null and p_max_uses is null then
    raise exception 'invite link needs an expiry or a use limit' using errcode = '22023';
  end if;

  v_expires := case when p_expires_in_days is null then null
                    else now() + make_interval(days => p_expires_in_days) end;

  /*
   * 16바이트 난수 → base64 24자(패딩 «==» 포함) → 패딩을 «지우고» 22자.
   *
   * ★ translate 의 to 문자열이 from 보다 짧으면 남는 문자는 «삭제» 된다.
   *   그래서 '+/=' → 'ab' 는 + 를 a 로, / 를 b 로 바꾸고 = 를 없앤다.
   *   전에는 '+/=' → 'abc' 로 적어서 모든 토큰이 «cc» 로 끝났다 — 열쇠에 고정 꼬리를
   *   달아 둘 이유가 없다.
   *
   * 128비트다. 표의 check(^[A-Za-z0-9]{10,64}$)가 모양을 한 번 더 본다.
   */
  v_token := translate(encode(gen_random_bytes(16), 'base64'), '+/=', 'ab');

  insert into public.org_invite_links(org_id, token, role, scope, expires_at, max_uses, created_by)
  values (p_org_id, v_token, p_role, p_scope, v_expires, p_max_uses, v_actor);

  return jsonb_build_object('token', v_token, 'expiresAt', v_expires);
end;
$$;

/*
 * 링크를 «쓴다» — 로그인한 누구나. 링크를 가진 것이 허가다.
 *
 * ★ 판정을 여기 하나에 모은다. 화면이 다시 판단하지 않는다 —
 *   이 저장소는 같은 판정을 두 곳에 적어서 이번 달에만 아홉 번 어긋났다(#676·#702·#707).
 *
 * ★ 왜 실패 이유를 잘게 안 나누나 — 'expired' 하나로 뭉친다.
 *   「기간 지남」과 「꺼짐」을 구분해 주면, 토큰을 찍어 보는 사람에게
 *   «이 회사가 있다» 는 사실이 새어 나간다. 없는 토큰과 죽은 토큰이 같은 말을 해야 한다.
 */
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
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- ★ 잠그고 읽는다. 같은 링크를 동시에 눌러도 max_uses 를 넘지 않는다.
  select * into v_link
    from public.org_invite_links
   where token = p_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  if v_link.revoked_at is not null
     or (v_link.expires_at is not null and v_link.expires_at <= now())
     or (v_link.max_uses is not null and v_link.used_count >= v_link.max_uses) then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  select o.slug, o.name into v_slug, v_name from public.orgs o where o.id = v_link.org_id;
  if v_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  -- ★ 이미 이 회사 사람이면 «자리를 안 덮어쓴다».
  --   팀장이 옛 링크를 눌렀다고 구성원으로 강등되면 안 된다.
  --   횟수도 안 올린다 — 새로 들어온 사람이 아니다.
  if exists (
    select 1 from public.org_members m
     where m.org_id = v_link.org_id and m.user_id = v_actor and m.status = 'active'
  ) then
    return jsonb_build_object('ok', true, 'already', true, 'slug', v_slug, 'name', v_name);
  end if;

  /*
   * 다른 회사에 속해 있어도 상관없다. 사람은 여러 회사에 속할 수 있다.
   *
   * ★★ `do update` 는 «되살리기만» 한다. 자리를 절대 안 바꾼다.
   *
   *   전에는 `set status='active', role=excluded.role, scope=excluded.scope` 였다.
   *   위 갈래가 «active 인 사람» 만 걸러 내므로, 이 줄은 **정지·퇴사 상태의 행**에서 돈다.
   *   그래서 이런 일이 났다 (직접 재현함):
   *
   *       팀장이 정지된다  →  대표가 만든 «구성원» 링크를 누른다
   *       → team_lead/department 가 member/assigned 로 «강등» 된다
   *
   *   PR 본문에 「자리를 안 덮어쓴다」고 적었는데 그건 «active 인 사람에게만» 참이었다.
   *   #702 에서 겪은 것과 같은 모양이다 — 시험이 한 갈래만 봤다.
   *
   *   ★ 링크는 «문을 여는» 물건이지 «자리를 정하는» 물건이 아니다.
   *     링크에 적힌 자리는 «처음 오는 사람» 에게만 적용된다.
   *     이미 행이 있는 사람의 자리는 조직관리에서 바꾼다 — 그게 그 화면이 있는 이유다.
   */
  insert into public.org_members(org_id, user_id, role, scope, status)
  values (v_link.org_id, v_actor, v_link.role, v_link.scope, 'active')
  on conflict (org_id, user_id) do update
    set status = 'active';

  update public.org_invite_links
     set used_count = used_count + 1
   where id = v_link.id;

  /*
   * ★ 누가 들어왔는지 남긴다. 승인하는 사람이 없으므로 이것이 유일한 추적 수단이다.
   *   `on conflict do nothing` — 같은 사람이 같은 링크로 두 번 세어지지 않는다.
   */
  insert into public.org_invite_redemptions(link_id, user_id)
  values (v_link.id, v_actor)
  on conflict (link_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'already', false, 'slug', v_slug, 'name', v_name);
end;
$$;

/*
 * 링크를 «누르기 전에» 무엇인지 보여 준다 — 로그인 전에도 부른다.
 *
 * ★ 회사 이름과 앉을 자리«만» 돌려준다. 사람 수·보드·업체는 안 나간다 —
 *   링크만 있으면 누구나 이 화면을 볼 수 있기 때문이다.
 */
create or replace function public.peek_org_invite(p_token text) returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case
    when l.id is null
      or l.revoked_at is not null
      or (l.expires_at is not null and l.expires_at <= now())
      or (l.max_uses is not null and l.used_count >= l.max_uses)
    then jsonb_build_object('ok', false, 'reason', 'unusable')
    else jsonb_build_object('ok', true, 'name', o.name, 'role', l.role::text, 'scope', l.scope::text)
  end
  from (select 1) probe
  left join public.org_invite_links l on l.token = p_token
  left join public.orgs o on o.id = l.org_id;
$$;

/* 끈다 — 대표·관리자만. 지우지 않는다: 누가 들어왔는지는 남아야 한다. */
create or replace function public.revoke_org_invite_link(p_org_id uuid, p_token text) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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

  update public.org_invite_links
     set revoked_at = coalesce(revoked_at, now())
   where org_id = p_org_id and token = p_token;

  return jsonb_build_object('ok', found);
end;
$$;

/* 살아 있는 것과 죽은 것을 함께 보여 준다 — 대표·관리자만. */
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

  /*
   * ★ 「누가 들어왔나」를 같이 준다. 기록만 남기고 못 보면 없는 것과 같다.
   *   링크가 샜을 때 대표가 «누구를 내보내야 하나» 를 여기서 안다.
   */
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'token', l.token, 'role', l.role::text, 'scope', l.scope::text,
      'expiresAt', l.expires_at, 'maxUses', l.max_uses, 'usedCount', l.used_count,
      'revokedAt', l.revoked_at, 'createdAt', l.created_at,
      'usable', l.revoked_at is null
        and (l.expires_at is null or l.expires_at > now())
        and (l.max_uses is null or l.used_count < l.max_uses),
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

revoke all on function public.create_org_invite_link(uuid, public.member_role, public.member_scope, integer, integer) from public, anon;
revoke all on function public.redeem_org_invite(text) from public, anon;
revoke all on function public.revoke_org_invite_link(uuid, text) from public, anon;
revoke all on function public.list_org_invite_links(uuid) from public, anon;
grant execute on function public.create_org_invite_link(uuid, public.member_role, public.member_scope, integer, integer) to authenticated;
grant execute on function public.redeem_org_invite(text) to authenticated;
grant execute on function public.revoke_org_invite_link(uuid, text) to authenticated;
grant execute on function public.list_org_invite_links(uuid) to authenticated;

-- ★ peek 만 anon 에게 연다. 로그인 «전» 에 「무엇에 들어가는지」를 보여 줘야 하기 때문이다.
--   돌려주는 것은 회사 이름과 자리뿐이고, 죽은 링크는 없는 링크와 같은 말을 한다.
revoke all on function public.peek_org_invite(text) from public;
grant execute on function public.peek_org_invite(text) to anon, authenticated;

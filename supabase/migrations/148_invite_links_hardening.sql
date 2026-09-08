-- moa-migration-guard: logical_key=148_invite_links_hardening predecessor=147_invite_links digest=a505940462dda47f16b1c1922bdd7a1a4e1eda32daeac3bd68464d642fae0a79 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '148_invite_links_hardening',
  p_file_name => '148_invite_links_hardening.sql',
  p_file_digest => 'a505940462dda47f16b1c1922bdd7a1a4e1eda32daeac3bd68464d642fae0a79',
  p_expected_predecessor => '147_invite_links',
  p_executor => 'DC',
  p_thread_id => '5b8e2f47-9c31-4a06-8d75-e14b3f2a9c60',
  p_foundation => false
);

-- 「사람 부르기」를 안전하게 만든다 — 147 의 뒤처리 (#722).
--
-- ## ★ 왜 147 을 고치지 않고 148 을 만드나
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
   *   여기서 «의도적으로» 넓힌 것이니, 006 주석을 읽고 「148 이 어긴다」고 판단하지 말 것.
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
 * ① ★★ 내보내진 사람은 링크로 «못» 돌아온다 — 이번 판의 핵심이다.
 *
 * 147 은 `on conflict do update set status='active', role=excluded.role, …` 였다.
 * 그 갈래는 «active 가 아닌 행» 에서 도는데, 두 가지 방식으로 다 틀렸다:
 *
 *   147 그대로     정지된 «팀장» 이 «구성원» 링크로 → member 로 «강등» 된다
 *   자리를 보존하면  정지된 «관리자» 가 «구성원» 링크로 → admin 으로 «복귀» 한다
 *                   ★ 게다가 자기가 정지 전에 만들어 둔 링크를 쓸 수 있다:
 *                     링크 생성 → 정지당함 → 자기 링크로 복귀 → 다시 admin 링크 발급
 *                     즉 «내보내기» 자체가 무력화된다
 *
 * 둘 다 안 된다. 링크는 «새 사람을 부르는» 도구지 «징계를 되돌리는» 도구가 아니다.
 *
 * ★★ 그런데 «되돌리는 문» 이 아직 없다 — 사실대로 적어 둔다.
 *
 *   「재입장은 대표가 조직관리 화면에서 정한다」고 쓸 뻔했다. 그 화면은 없다.
 *   찾아보니 신청 쪽도 막혀 있다:
 *
 *       006:792      create or replace function public.resolve_workspace_join_request
 *       006:851-857  org_members 에 행이 «있기만 하면» removed 든 leave 든 안 가리고
 *                    23505 'requester already has workspace membership' 로 거절한다
 *
 *   즉 지금은 링크로도, 신청으로도 못 돌아온다.
 *
 *   ★★ 그리고 008 은 이 정책을 «이미 다르게» 정해 놨다 — 둘이 어긋난다.
 *
 *       008:26-31   suspended                   → 'blocked_inactive'  (막는다)
 *       008:36-38   removed · leave · expired    → 'eligible_entry'    (신청 «자격이 있다»)
 *
 *     즉 008 은 내보내진 사람에게 「신청하세요」라고 «화면으로 안내한다»
 *     (app/src/app/workspace-entry/page.tsx 가 이 값으로 화면을 그린다).
 *     그런데 그 신청을 대표가 승인하면 006:851-857 이 23505 로 거절한다.
 *     제품이 사람을 막다른 길로 안내하고 있다 — 148 이 만든 것이 아니라 «이미» 그렇다.
 *
 *     148 은 여섯 상태를 하나로 묶어 전부 needs_approval 로 보낸다. 보안 판단으로는 맞다
 *     (링크로 되살리면 정지된 관리자가 스스로 복귀한다). 다만 008 의 갈래와 어긋나므로
 *     «어느 쪽이 이 제품의 답인가» 를 정하는 것이 #730 의 일이다.
 *
 *   ★ 「코드가 비활성 행을 안 만드니 갇히는 사람은 없다」고 쓸 뻔했다. 그것도 틀렸다.
 *     코드는 정말 안 만든다(008:26 등은 읽기만 한다). 그런데 «사람이 DB 를 직접 고쳐» 만든
 *     행이 운영에 있다 — 2026-09-08 실측으로 status='suspended' 인 구성원이 둘이다.
 *     「코드에 없다」에서 「데이터에 없다」를 추론하면 안 된다.
 *     그래서 이 구멍은 「내보내기를 만들면 터진다」가 아니라 «이미 터져 있다». #730 참고.
 *
 *   ★ 내보내기를 만드는 사람에게: «되돌리기» 를 같이 만들어라. 하나만 만들면 사람이 갇힌다.
 *     그리고 그 되돌리기는 «링크» 가 아니라 대표가 직접 누르는 것이어야 한다 —
 *     위에 적은 이유로, 링크로 되살리면 정지된 관리자가 스스로 복귀한다.
 *
 * ★★★ 그리고 내보내기를 «행 DELETE» 로 만들면 위 방어가 통째로 무력화된다.
 *
 *   이 방어는 «org_members 에 행이 남아 있다» 는 전제 위에 서 있다.
 *   행을 지우면 v_status 가 null 이 되어 그 사람은 「처음 오는 사람」이 되고,
 *   링크에 적힌 자리로 그대로 들어온다 — 방금 막은 구멍이 그대로 다시 열린다.
 *
 *       status='removed' 로 «표시»  →  링크로 못 돌아온다   ✅
 *       행을 DELETE                 →  링크로 그냥 돌아온다  ❌
 *
 *   취향이 아니다. org_members.status 의 CHECK 가 removed·leave·expired 를 갖고 있는
 *   이유(006:38-40)가 이것이다. 정말 지워야 하면(개인정보 삭제 요청 등) «지워진 사람» 을
 *   따로 남기는 표가 먼저 있어야 한다 — 지금은 없다.
 *
 * ★ 실패 이유를 여기서만 나눈다. 「없는 링크」와 「죽은 링크」는 계속 한 말(unusable)이지만,
 *   이건 «유효한 링크를 가진 사람» 에게 주는 답이라 회사 존재가 새지 않는다.
 *   그리고 그 사람은 무엇을 해야 하는지 알아야 한다 — 대표에게 말해야 한다.
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

  /*
   * ⑤ 정지·삭제 예정 회사에는 못 들어간다. 147 은 회사 상태를 안 봤다.
   *   들어가 봐야 RLS 가 막지만, 「들어왔다」고 말해 놓고 아무것도 안 보이는 것이 더 나쁘다.
   *
   * ★★ 이 검사는 «구성원 검사보다 먼저» 와야 한다 — 순서를 바꾸지 말 것.
   *   아래 needs_approval 은 회사 «이름» 을 돌려준다. 구성원 검사가 먼저 오면
   *   삭제 예정인 회사의 이름이 옛 구성원에게 새어 나간다. 지금 순서면
   *   문 닫은 회사는 누구에게나 unusable 한 마디만 한다.
   */
  select o.slug, o.name into v_slug, v_name
    from public.orgs o where o.id = v_link.org_id and o.status = 'active';
  if v_slug is null then
    return jsonb_build_object('ok', false, 'reason', 'unusable');
  end if;

  select m.status into v_status
    from public.org_members m
   where m.org_id = v_link.org_id and m.user_id = v_actor;

  if v_status = 'active' then
    -- 이미 이 회사 사람이다. 자리를 안 건드리고 횟수도 안 올린다.
    return jsonb_build_object('ok', true, 'already', true, 'slug', v_slug, 'name', v_name);
  end if;

  if v_status is not null then
    -- ★ 나갔던 사람이다. 되살리지 «않고» 링크도 «안 태운다».
    return jsonb_build_object('ok', false, 'reason', 'needs_approval', 'name', v_name);
  end if;

  -- 처음 오는 사람. 다른 회사에 속해 있어도 상관없다.
  insert into public.org_members(org_id, user_id, role, scope, status)
  values (v_link.org_id, v_actor, v_link.role, v_link.scope, 'active')
  on conflict (org_id, user_id) do nothing;

  if not found then
    /*
     * 그 사이 다른 요청이 행을 넣었다. 횟수를 안 올린다.
     *
     * ★ 「그러니 이미 사람이다」라고 «단정하지» 않는다 — 그 행이 active 라는 보장이 없다.
     *   오늘은 우연히 참이다: 행을 넣는 다른 경로(006:882 승인 · 018 · 030 · 048 · 다른 링크)가
     *   전부 status='active' 로 넣기 때문이다. 그래서 이 갈래는 «지금은» 못 밟힌다.
     *   누군가 invited·pending 으로 넣는 경로를 만드는 순간 이 단정이 거짓이 된다 —
     *   「들어왔습니다」라고 말해 놓고 실제로는 못 들어간 사람이 생긴다.
     *   한 줄로 막으니 지금 막아 둔다.
     */
    select m.status into v_status
      from public.org_members m
     where m.org_id = v_link.org_id and m.user_id = v_actor;
    if v_status is distinct from 'active' then
      return jsonb_build_object('ok', false, 'reason', 'needs_approval', 'name', v_name);
    end if;
    return jsonb_build_object('ok', true, 'already', true, 'slug', v_slug, 'name', v_name);
  end if;

  update public.org_invite_links set used_count = used_count + 1 where id = v_link.id;

  insert into public.org_invite_redemptions(link_id, user_id)
  values (v_link.id, v_actor)
  on conflict (link_id, user_id) do nothing;

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

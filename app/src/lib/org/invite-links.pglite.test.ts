import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * 「사람 부르기」 — 링크가 곧 허가다. 그래서 «누가 무엇을 할 수 있나» 를 DB 에서 직접 잰다.
 *
 * ★ 화면에서 버튼을 감추는 것으로는 아무것도 못 막는다 — 버튼이 없어도 요청은 손으로 만들 수 있다.
 *   이 기능은 «회사 안에 사람을 넣는» 것이라 특히 그렇다.
 */

/*
 * ★ 147 «다음에» 148 을 얹는다 — 운영이 실제로 겪는 순서다.
 *
 *   147 은 이미 머지됐다(PR #723 · merge 6e75c6b). `begin_guarded_migration` 은
 *   digest 가 아니라 **logical_key 로** 판정하므로(094:53), 147 파일을 고쳐 봐야
 *   적용된 DB 에는 절대 안 닿는다. 실제로 그 실수를 한 번 했고 검수가 잡아 줬다.
 *
 *   그래서 이 시험도 «147 만» 읽으면 안 된다. 운영은 둘 다 지나간 상태이고,
 *   여기서 순서대로 얹어야 「148 이 147 을 제대로 덮는가」까지 같이 재진다.
 */
const migrations = ["147_invite_links.sql", "148_invite_links_hardening.sql"].map((name) =>
  readFileSync(resolve(process.cwd(), `../supabase/migrations/${name}`), "utf8"),
);

/*
 * ★ 006:38-40 이 org_members.status 에 허용하는 «전부». active 를 뺀 여섯이다.
 *   손으로 골라 적지 않는다 — 처음 판은 「suspended·inactive·removed」를 적었는데
 *   `inactive` 는 006 이 허용하지도 않는 값이었고(시험 스텁에 제약이 없어 통과했다),
 *   정작 운영에 실재하는 invited·pending·leave·expired 는 한 번도 안 밟았다.
 */
const NON_ACTIVE_STATUSES = ["invited", "pending", "suspended", "removed", "leave", "expired"] as const;

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  orgA: id("a1"),
  orgB: id("b1"),
  owner: id("1a"),
  admin: id("2a"),
  member: id("3a"),
  lead: id("4a"),
  outsider: id("9a"),
  ownerB: id("1b"),
};

/*
 * ★ pgcrypto 를 «extensions» 스키마에 둔다 — 운영과 같은 배치다.
 *
 *   이 프로젝트의 pgcrypto 는 public 이 아니라 extensions 에 있다. 그래서
 *   `set search_path = public, pg_temp` 인 함수가 gen_random_bytes 를 부르면
 *   42883 으로 «항상» 죽는다 (#653 이 정확히 그것이었다).
 *
 *   여기서 같은 배치를 재현해 두면, 다음 사람이 147 의 search_path 에서
 *   extensions 를 빼는 순간 이 시험이 빨개진다. 그게 이 스텁의 진짜 목적이다.
 */
const SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create schema extensions;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

  -- pgcrypto 대역. 매번 다른 16바이트를 준다 (토큰이 유일해야 하므로).
  create function extensions.gen_random_bytes(n integer) returns bytea
    language sql volatile as
    $$ select decode(substring(replace(gen_random_uuid()::text, '-', '') from 1 for n * 2), 'hex') $$;

  create type public.member_role as enum ('owner','admin','team_lead','member');
  create type public.member_scope as enum ('all','department','assigned');
  create table public.orgs(
    id uuid primary key, slug text not null unique, name text not null,
    status text not null default 'active',
    -- ★ 006:29-32 의 «진짜» 제약. 147 은 회사 상태를 아예 안 봤다 —
    --   정지되거나 삭제 예정인 회사에도 링크로 들어가졌다.
    constraint orgs_status_check check (
      status in ('active','provisioning','suspended','pending_delete','deleted'))
  );
  create table public.users(id uuid primary key);
  create table public.org_members(
    org_id uuid not null references public.orgs(id) on delete cascade,
    user_id uuid not null references public.users(id),
    role public.member_role not null,
    scope public.member_scope not null default 'assigned',
    status text not null default 'active',
    primary key(org_id, user_id),
    -- ★ 006:38-40 의 «진짜» 제약. 처음 판에는 이게 없어서 강등 버그가 안 보였다 —
    --   시험이 아무 status 나 받으니 「suspended·inactive·removed」 같은 임의 값으로
    --   돌았고, 정작 운영이 허용하는 여섯 상태를 다 못 밟았다. 검수가 이걸 짚었다.
    constraint org_members_status_check check (
      status in ('active','invited','pending','suspended','removed','leave','expired'))
  );
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id uuid, p_foundation boolean
  ) returns void language sql as $$ select $$;
`;

const SEED = `
  insert into public.orgs(id, slug, name) values
    ('${ids.orgA}', 'alpha', '알파 회사'),
    ('${ids.orgB}', 'beta', '베타 회사');
  insert into public.users values
    ('${ids.owner}'), ('${ids.admin}'), ('${ids.member}'),
    ('${ids.lead}'), ('${ids.outsider}'), ('${ids.ownerB}');
  insert into public.org_members(org_id, user_id, role, scope) values
    ('${ids.orgA}', '${ids.owner}', 'owner', 'all'),
    ('${ids.orgA}', '${ids.admin}', 'admin', 'all'),
    ('${ids.orgA}', '${ids.member}', 'member', 'assigned'),
    ('${ids.orgA}', '${ids.lead}', 'team_lead', 'department'),
    ('${ids.orgB}', '${ids.ownerB}', 'owner', 'all');
`;

describe("147+148 — 사람 부르기 링크", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    for (const sql of migrations) await db.exec(sql);
    await db.exec(SEED);
  });
  afterEach(async () => { await db.close(); });

  const as = (uid: string) => db.exec(`set app.uid = '${uid}';`);
  const anon = () => db.exec(`set app.uid = '';`);
  async function call<T = Record<string, unknown>>(sql: string): Promise<T> {
    const rows = await db.query<{ out: T }>(sql);
    return rows.rows[0].out;
  }
  const create = (uid: string, role = "member", scope = "assigned", days: number | null = 7, max: number | null = null) =>
    (as(uid), call(`select public.create_org_invite_link('${ids.orgA}', '${role}', '${scope}',
      ${days === null ? "null" : days}, ${max === null ? "null" : max}) as out`));

  describe("만들기 — 대표·관리자만", () => {
    it("대표가 만들면 토큰과 만료가 나온다", async () => {
      const made = await create(ids.owner) as { token: string; expiresAt: string };
      expect(made.token).toMatch(/^[A-Za-z0-9]{10,64}$/u);
      expect(made.expiresAt).toBeTruthy();
    });

    it("관리자도 만들 수 있다", async () => {
      await expect(create(ids.admin)).resolves.toBeTruthy();
    });

    it.each([["구성원", ids.member], ["팀장", ids.lead], ["다른 회사 대표", ids.ownerB], ["남", ids.outsider]])(
      "%s 는 못 만든다",
      async (_label, uid) => { await expect(create(uid)).rejects.toThrow(); },
    );

    it("★ 대표 자리는 링크로 못 준다", async () => {
      await expect(create(ids.owner, "owner")).rejects.toThrow();
    });

    it("횟수 0·음수와 말도 안 되는 기간은 거부한다", async () => {
      await expect(create(ids.owner, "member", "assigned", 7, 0)).rejects.toThrow();
      await expect(create(ids.owner, "member", "assigned", 0, null)).rejects.toThrow();
      await expect(create(ids.owner, "member", "assigned", 400, null)).rejects.toThrow();
    });

    /*
     * ★ 승인 단계를 없앤 대가를 막는 것이 «유효기간 · 횟수 · 끄기» 셋인데,
     *   처음 판은 앞의 둘을 «둘 다» 비울 수 있었다. 그러면 카톡방에 남은 링크가
     *   끄기 전까지 영원히 살아 있는 열쇠가 된다 (총괄 결정 2026-09-07).
     */
    it("★ 「기한 없음 + 무제한」은 못 만든다 — 영원히 사는 열쇠가 된다", async () => {
      await expect(create(ids.owner, "member", "assigned", null, null)).rejects.toThrow();
    });

    it("하나만 정하면 만들어진다 — 「기한없음·1명」도 「30일·무제한」도", async () => {
      await expect(create(ids.owner, "member", "assigned", null, 1)).resolves.toBeTruthy();
      await expect(create(ids.owner, "member", "assigned", 30, null)).resolves.toBeTruthy();
    });

    /*
     * ★ 검수 P2 — 위 규칙이 «큰 수 하나» 로 뚫렸다.
     *   `max_uses = 2147483647` 은 형식상 «제한» 이라 규칙을 통과하는데,
     *   실질은 무제한이다. 기존 초대(006:643)가 쓰는 상한 1~1000 을 여기도 쓴다.
     */
    it("★ 「기한없음 + 21억번」으로 규칙을 우회하지 못한다", async () => {
      await expect(create(ids.owner, "member", "assigned", null, 2147483647)).rejects.toThrow();
      await expect(create(ids.owner, "member", "assigned", null, 1001)).rejects.toThrow();
      await expect(create(ids.owner, "member", "assigned", null, 1000)).resolves.toBeTruthy();
    });

    /*
     * ★ 총괄 결정(2026-09-07) — 관리자도 «관리자 자리» 링크를 만들 수 있다.
     *   006 이 자리 배정을 대표 전용으로 두는 것과 «의도적으로» 다르다.
     *   사고가 아니라 결정이라는 것을 시험으로도 못 박는다 —
     *   다음 사람이 006 주석을 읽고 「이건 버그다」라며 되돌리지 않도록.
     */
    it("★ 관리자도 «관리자» 링크를 만들 수 있다 — 의도된 넓히기다", async () => {
      await expect(create(ids.admin, "admin", "all", 7, null)).resolves.toBeTruthy();
    });

    it("★ 토큰이 매번 다르다 — 같으면 하나가 다른 회사의 열쇠가 된다", async () => {
      const a = await create(ids.owner) as { token: string };
      const b = await create(ids.owner) as { token: string };
      expect(a.token).not.toBe(b.token);
    });
  });

  describe("쓰기 — 링크를 가진 것이 허가다", () => {
    it("처음 온 사람이 링크에 적힌 자리로 들어온다", async () => {
      const { token } = await create(ids.owner, "team_lead", "department") as { token: string };
      as(ids.outsider);
      const out = await call<{ ok: boolean; already: boolean; slug: string; name: string }>(
        `select public.redeem_org_invite('${token}') as out`);
      expect(out).toMatchObject({ ok: true, already: false, slug: "alpha", name: "알파 회사" });

      const row = await db.query<{ role: string; scope: string }>(
        `select role::text, scope::text from public.org_members
          where org_id='${ids.orgA}' and user_id='${ids.outsider}'`);
      expect(row.rows[0]).toEqual({ role: "team_lead", scope: "department" });
    });

    it("★ 이미 이 회사 사람이면 자리를 «안 덮어쓴다»", async () => {
      const { token } = await create(ids.owner, "member", "assigned") as { token: string };
      as(ids.lead);
      const out = await call<{ ok: boolean; already: boolean }>(
        `select public.redeem_org_invite('${token}') as out`);
      expect(out).toMatchObject({ ok: true, already: true });

      const row = await db.query<{ role: string }>(
        `select role::text from public.org_members where org_id='${ids.orgA}' and user_id='${ids.lead}'`);
      expect(row.rows[0].role, "팀장이 구성원으로 강등됐다").toBe("team_lead");

      const used = await db.query<{ used_count: number }>(
        `select used_count from public.org_invite_links where token='${token}'`);
      expect(used.rows[0].used_count, "새로 들어온 사람이 아닌데 횟수가 올랐다").toBe(0);
    });

    /*
     * ★★★ 여기가 이 기능에서 제일 잘 깨지는 자리다 — 두 번 연달아 틀렸다.
     *
     *   위 시험은 「이미 **active** 인 사람」만 봤다. 그런데 147 의
     *   `on conflict do update` 는 «active 가 아닌 행» 에서 돈다. 그 갈래를
     *   두 가지 방식으로 채워 봤고 «둘 다» 틀렸다:
     *
     *     147 그대로     정지된 «팀장» 이 «구성원» 링크로  →  member 로 «강등»
     *     자리를 보존     정지된 «관리자» 가 «구성원» 링크로 →  admin 으로 «복귀»
     *
     *   두 번째가 더 나쁘다. 검수가 재현 경로까지 적어 줬다:
     *
     *       관리자가 30일짜리 링크를 만들어 둔다
     *       → 사고를 쳐서 정지당한다
     *       → 자기가 만든 그 링크를 자기가 누른다  →  admin 으로 «복귀»
     *       → 다시 관리자 링크를 찍어낸다
     *
     *   즉 «내보내기» 자체가 무력화된다. 자리를 덮어쓰든 보존하든, «되살리는» 순간 진다.
     *
     * ★ 링크는 «새 사람을 부르는» 물건이지 «징계를 되돌리는» 물건이 아니다.
     *   한 번 나간 사람의 재입장은 대표가 조직관리 화면에서 정한다.
     */
    it.each(NON_ACTIVE_STATUSES.map((s) => [s]))(
      "★ %s 이던 사람은 링크로 «못» 돌아온다 — 자리를 바꾸든 지키든 되살리면 진다",
      async (status) => {
        await db.exec(
          `update public.org_members set status='${status}'
            where org_id='${ids.orgA}' and user_id='${ids.lead}'`);
        const { token } = await create(ids.owner, "member", "assigned") as { token: string };
        as(ids.lead);
        const out = await call<{ ok: boolean; reason: string }>(
          `select public.redeem_org_invite('${token}') as out`);
        expect(out, `${status} → 링크로 되살아났다`).toMatchObject({ ok: false, reason: "needs_approval" });

        const row = await db.query<{ role: string; scope: string; status: string }>(
          `select role::text, scope::text, status from public.org_members
            where org_id='${ids.orgA}' and user_id='${ids.lead}'`);
        expect(row.rows[0], `${status} → 행이 손대졌다`).toEqual({
          role: "team_lead", scope: "department", status,
        });
      },
    );

    /*
     * ★ 검수가 낸 구체적 공격 그대로를 재현한다. 위 시험이 죽으면 이것도 죽지만,
     *   «왜 그 규칙이 있는가» 를 다음 사람이 한눈에 보게 남긴다.
     */
    it("★★ 정지된 관리자가 자기 링크로 관리자로 «복귀» 하지 못한다", async () => {
      const { token } = await create(ids.admin, "member", "assigned", 30, null) as { token: string };
      await db.exec(
        `update public.org_members set status='suspended'
          where org_id='${ids.orgA}' and user_id='${ids.admin}'`);

      as(ids.admin);
      const out = await call<{ ok: boolean }>(`select public.redeem_org_invite('${token}') as out`);
      expect(out).toMatchObject({ ok: false });

      const row = await db.query<{ status: string }>(
        `select status from public.org_members where org_id='${ids.orgA}' and user_id='${ids.admin}'`);
      expect(row.rows[0].status, "정지가 풀렸다 — 내보내기가 무력화된다").toBe("suspended");

      // 그리고 여전히 관리자 일을 못 한다.
      await expect(create(ids.admin, "admin", "all", 7, null)).rejects.toThrow();
    });

    /*
     * ★ 검수 P2 — 나갔던 사람이 눌러도 링크가 «타면» 1회용 링크가 헛되이 소모된다.
     *   진짜로 부른 사람이 못 들어온다.
     */
    it("★ 나갔던 사람이 눌러도 1회용 링크가 «안 탄다»", async () => {
      await db.exec(
        `update public.org_members set status='removed'
          where org_id='${ids.orgA}' and user_id='${ids.lead}'`);
      const { token } = await create(ids.owner, "member", "assigned", null, 1) as { token: string };

      as(ids.lead);
      await call(`select public.redeem_org_invite('${token}') as out`);

      // 정작 부르려던 사람은 아직 들어올 수 있어야 한다.
      as(ids.outsider);
      expect(await call<{ ok: boolean }>(`select public.redeem_org_invite('${token}') as out`))
        .toMatchObject({ ok: true, already: false });
    });

    it("★ 다른 회사에 속해 있어도 «추가로» 들어온다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      as(ids.ownerB);
      await call(`select public.redeem_org_invite('${token}') as out`);
      const rows = await db.query(
        `select org_id from public.org_members where user_id='${ids.ownerB}'`);
      expect(rows.rows.length, "옛 회사에서 빠지거나 새 회사에 안 들어갔다").toBe(2);
    });

    it("로그인하지 않았으면 거부한다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      anon();
      await expect(call(`select public.redeem_org_invite('${token}') as out`)).rejects.toThrow();
    });
  });

  describe("★ 죽은 링크는 «없는 링크와 같은 말» 을 한다", () => {
    it.each([
      ["없는 토큰", async () => "zzzzzzzzzzzzzzzzzzzzzz"],
      ["기간 지남", async () => {
        const { token } = await create(ids.owner) as { token: string };
        await db.exec(`update public.org_invite_links set expires_at = now() - interval '1 day' where token='${token}'`);
        return token;
      }],
      ["꺼짐", async () => {
        const { token } = await create(ids.owner) as { token: string };
        as(ids.owner);
        await call(`select public.revoke_org_invite_link('${ids.orgA}','${token}') as out`);
        return token;
      }],
      ["다 씀", async () => {
        const { token } = await create(ids.owner, "member", "assigned", 7, 1) as { token: string };
        as(ids.outsider);
        await call(`select public.redeem_org_invite('${token}') as out`);
        return token;
      }],
    ])("%s → 전부 'unusable'", async (_label, make) => {
      const token = await make();
      as(ids.ownerB);
      const out = await call<{ ok: boolean; reason: string }>(
        `select public.redeem_org_invite('${token}') as out`);
      expect(out).toEqual({ ok: false, reason: "unusable" });
    });

    it("왜 뭉치나 — 이유를 나누면 «이 회사가 있다» 가 새어 나간다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      await db.exec(`update public.org_invite_links set revoked_at = now() where token='${token}'`);
      as(ids.ownerB);
      const dead = await call(`select public.redeem_org_invite('${token}') as out`);
      const missing = await call(`select public.redeem_org_invite('nosuchtokenxxxxxxxxxxx') as out`);
      expect(dead).toEqual(missing);
    });
  });

  describe("횟수", () => {
    it("★ 정해진 수를 넘지 않는다", async () => {
      const { token } = await create(ids.owner, "member", "assigned", 7, 1) as { token: string };
      as(ids.outsider);
      expect(await call<{ ok: boolean }>(`select public.redeem_org_invite('${token}') as out`))
        .toMatchObject({ ok: true });
      as(ids.ownerB);
      expect(await call<{ ok: boolean }>(`select public.redeem_org_invite('${token}') as out`))
        .toMatchObject({ ok: false });
    });

    /*
     * ★ 동시에 누르는 경우는 여기서 못 잰다 — PGlite 는 연결이 하나다.
     *   그건 `redeem_org_invite` 의 `for update` 가 막는다. 「확인 못 함」으로 남긴다.
     */
  });

  describe("미리보기 — 로그인 전에도 부른다", () => {
    it("회사 이름과 자리«만» 준다", async () => {
      const { token } = await create(ids.owner, "team_lead", "department") as { token: string };
      anon();
      const out = await call(`select public.peek_org_invite('${token}') as out`);
      expect(out).toEqual({ ok: true, name: "알파 회사", role: "team_lead", scope: "department" });
    });

    it("★ 사람 수·주소 같은 회사 내부는 안 나간다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      anon();
      const out = await call<Record<string, unknown>>(`select public.peek_org_invite('${token}') as out`);
      expect(Object.keys(out).sort()).toEqual(["name", "ok", "role", "scope"]);
    });

    it("죽은 링크는 없는 링크와 같은 말을 한다", async () => {
      anon();
      const missing = await call(`select public.peek_org_invite('nosuchtokenxxxxxxxxxxx') as out`);
      expect(missing).toEqual({ ok: false, reason: "unusable" });
    });
  });

  describe("끄기·목록 — 대표·관리자만", () => {
    it("끄면 못 쓴다. 그리고 «지우지 않는다» — 누가 들어왔는지는 남아야 한다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      as(ids.outsider);
      await call(`select public.redeem_org_invite('${token}') as out`);
      as(ids.owner);
      await call(`select public.revoke_org_invite_link('${ids.orgA}','${token}') as out`);

      const row = await db.query<{ used_count: number; revoked_at: string | null }>(
        `select used_count, revoked_at from public.org_invite_links where token='${token}'`);
      expect(row.rows[0].used_count).toBe(1);
      expect(row.rows[0].revoked_at).not.toBeNull();
    });

    it.each([["구성원", ids.member], ["팀장", ids.lead], ["다른 회사 대표", ids.ownerB]])(
      "%s 는 못 끄고 목록도 못 본다",
      async (_label, uid) => {
        const { token } = await create(ids.owner) as { token: string };
        as(uid);
        await expect(call(`select public.revoke_org_invite_link('${ids.orgA}','${token}') as out`)).rejects.toThrow();
        await expect(call(`select public.list_org_invite_links('${ids.orgA}') as out`)).rejects.toThrow();
      },
    );

    it("목록이 산 것과 죽은 것을 «구분해» 보여 준다", async () => {
      const live = await create(ids.owner) as { token: string };
      const dead = await create(ids.owner) as { token: string };
      as(ids.owner);
      await call(`select public.revoke_org_invite_link('${ids.orgA}','${dead.token}') as out`);

      const list = await call<Array<{ token: string; usable: boolean }>>(
        `select public.list_org_invite_links('${ids.orgA}') as out`);
      const byToken = new Map(list.map((l) => [l.token, l.usable]));
      expect(byToken.get(live.token)).toBe(true);
      expect(byToken.get(dead.token)).toBe(false);
    });
  });

  describe("★ 누가 들어왔는지 남는다 — 승인하는 사람이 없으므로 유일한 추적 수단이다", () => {
    it("링크로 들어온 사람이 기록되고, 목록에서 보인다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      as(ids.outsider);
      await call(`select public.redeem_org_invite('${token}') as out`);
      as(ids.owner);
      const list = await call<Array<{ token: string; joined: Array<{ userId: string }> }>>(
        `select public.list_org_invite_links('${ids.orgA}') as out`);
      const row = list.find((l) => l.token === token);
      expect(row?.joined.map((j) => j.userId), "누가 들어왔는지 안 보인다").toEqual([ids.outsider]);
    });

    /*
     * ★★ 이 시험은 처음에 «제목이 말하는 것을 재지 않았다». 검수가 돌연변이로 증명했다:
     *
     *     148 에서 `on conflict (link_id, user_id) do nothing` 을 «통째로» 지워도
     *     → 49개 전부 통과. 안 빨개진다.
     *
     *   두 번째 redeem 이 `v_status='active'` 갈래에서 끊겨 redemption insert 에
     *   «도달조차» 안 했기 때문이다. 제목은 「두 번 눌러도 한 번만」인데
     *   두 번째 누름이 그 절을 한 번도 안 밟았다.
     *
     * ★ 그 절을 실제로 밟으려면 «행이 지워진 뒤 다시 들어오는» 경로가 필요하다.
     *   그리고 그 경로는 마침 148 이 경고하는 바로 그 경로다 —
     *   내보내기를 DELETE 로 만들면 needs_approval 방어가 무력화된다(#730).
     *   그래서 이 시험 하나가 셋을 동시에 잡는다:
     *     ① on conflict do nothing 이 «처음으로» 밟힌다
     *     ② 제목이 사실이 된다
     *     ③ used_count 와 redemptions 가 어긋나는 유일한 갈래를 «문서로» 남긴다
     */
    it("★ 행이 지워진 뒤 같은 링크로 다시 들어와도 «들어온 기록» 은 한 줄이다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      as(ids.outsider);
      await call(`select public.redeem_org_invite('${token}') as out`);

      // ★ 내보내기를 «행 삭제» 로 만들었다고 가정한다 — 148 이 하지 말라고 경고하는 그것이다.
      await db.exec(
        `delete from public.org_members
          where org_id='${ids.orgA}' and user_id='${ids.outsider}'`);

      as(ids.outsider);
      const back = await call<{ ok: boolean; already: boolean }>(
        `select public.redeem_org_invite('${token}') as out`);
      // 행이 없으니 «처음 오는 사람» 이 된다. 이게 바로 #730 이 경고하는 구멍이다.
      expect(back, "행을 지우면 링크로 그냥 돌아온다 — 148 의 방어가 행 존재를 전제한다")
        .toMatchObject({ ok: true, already: false });

      const n = await db.query<{ n: number }>(
        `select count(*)::int as n from public.org_invite_redemptions`);
      expect(n.rows[0].n, "같은 사람이 두 줄로 남았다 — on conflict do nothing 이 안 돈다").toBe(1);

      // ★ 「확인 못 함」이 아니라 «알고 있는 어긋남» 으로 남긴다:
      //   기록은 한 줄인데 횟수는 둘이다. 뿌리는 위의 DELETE 다 (#730).
      const used = await db.query<{ used_count: number }>(
        `select used_count from public.org_invite_links where token='${token}'`);
      expect(used.rows[0].used_count).toBe(2);
    });

    it("★ 「지우지 않는다 — 누가 들어왔는지는 남아야 한다」가 이제 «사실» 이다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      as(ids.outsider);
      await call(`select public.redeem_org_invite('${token}') as out`);
      as(ids.owner);
      await call(`select public.revoke_org_invite_link('${ids.orgA}','${token}') as out`);
      const n = await db.query<{ n: number }>(
        `select count(*)::int as n from public.org_invite_redemptions`);
      expect(n.rows[0].n, "끄면 들어온 기록까지 사라진다").toBe(1);
    });
  });

  /*
   * ★ 검수 P2 — 147 은 회사 상태를 «아예» 안 봤다.
   *   정지되거나 삭제 예정인 회사에도 링크로 들어가졌다. 들어가 봐야 RLS 가 막지만,
   *   「들어왔다」고 말해 놓고 아무것도 안 보이는 것이 더 나쁘다.
   */
  describe("★ 문 닫은 회사에는 못 들어간다", () => {
    it.each([["provisioning"], ["suspended"], ["pending_delete"], ["deleted"]])(
      "%s 인 회사 → 죽은 링크와 같은 말을 한다",
      async (status) => {
        const { token } = await create(ids.owner) as { token: string };
        await db.exec(`update public.orgs set status='${status}' where id='${ids.orgA}'`);

        as(ids.outsider);
        expect(await call(`select public.redeem_org_invite('${token}') as out`))
          .toEqual({ ok: false, reason: "unusable" });

        const n = await db.query<{ n: number }>(
          `select count(*)::int as n from public.org_members
            where org_id='${ids.orgA}' and user_id='${ids.outsider}'`);
        expect(n.rows[0].n, "문 닫은 회사에 사람이 들어갔다").toBe(0);
      },
    );

    it("미리보기도 «있다» 고 말하지 않는다", async () => {
      const { token } = await create(ids.owner) as { token: string };
      await db.exec(`update public.orgs set status='suspended' where id='${ids.orgA}'`);
      anon();
      expect(await call(`select public.peek_org_invite('${token}') as out`))
        .toEqual({ ok: false, reason: "unusable" });
    });

    /*
     * ★★ 148:204-212 가 「회사 상태 검사가 «구성원 검사보다 먼저» 와야 한다」를 주석으로
     *   못 박아 놨는데, 그것을 재는 시험이 «없었다». 검수가 짚었다.
     *
     *   위 시험들은 전부 «한 번도 구성원이 아닌 사람»(outsider) 으로만 돈다.
     *   순서가 뒤집혔을 때 새는 것은 «옛 구성원» 이다 — needs_approval 이 회사 «이름» 을
     *   돌려주기 때문이다. 그 사람으로 안 밟으면 불변식이 안 지켜져도 조용하다.
     *
     * ★ 주석으로만 있고 시험이 없는 규칙은 다음 사람이 지울 수 있다.
     */
    it("★ 옛 구성원에게도 문 닫은 회사의 «이름» 이 새지 않는다 — 검사 순서 불변식", async () => {
      const { token } = await create(ids.owner) as { token: string };
      await db.exec(
        `update public.org_members set status='removed'
          where org_id='${ids.orgA}' and user_id='${ids.lead}'`);
      await db.exec(`update public.orgs set status='pending_delete' where id='${ids.orgA}'`);

      as(ids.lead);
      const out = await call<Record<string, unknown>>(
        `select public.redeem_org_invite('${token}') as out`);
      // needs_approval 이 아니라 unusable 이어야 하고, name 키가 «아예 없어야» 한다.
      expect(out, "구성원 검사가 먼저 돌아 삭제 예정 회사 이름이 샜다")
        .toEqual({ ok: false, reason: "unusable" });
    });
  });

  describe("표에 직접 손대지 못한다", () => {
    /*
     * ★ 처음 판은 grantee 에서 `service_role` 을 빼고 셌다 — 그래서 «남아 있는데도» 0 이 나왔다.
     *   Supabase 의 service_role 은 BYPASSRLS 라 FORCE RLS 로도 안 막힌다.
     *   136·139·146 이 전부 service_role 까지 뗀다. 검수가 이걸 짚었다.
     */
    it.each([["org_invite_links"], ["org_invite_redemptions"]])(
      "★ %s — 토큰·기록을 «훑을» 수 있으면 그 자체가 사고다",
      async (table) => {
        const grants = await db.query<{ n: number }>(`
          select count(*)::int as n from information_schema.role_table_grants
           where table_name = '${table}'
             and grantee in ('anon','authenticated','public','service_role')`);
        expect(grants.rows[0].n, `${table} 에 직접 권한이 남아 있다`).toBe(0);
      },
    );
  });
});

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

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/147_invite_links.sql"),
  "utf8",
);

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
  create table public.orgs(id uuid primary key, slug text not null unique, name text not null);
  create table public.users(id uuid primary key);
  create table public.org_members(
    org_id uuid not null references public.orgs(id) on delete cascade,
    user_id uuid not null references public.users(id),
    role public.member_role not null,
    scope public.member_scope not null default 'assigned',
    status text not null default 'active',
    primary key(org_id, user_id)
  );
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id uuid, p_foundation boolean
  ) returns void language sql as $$ select $$;
`;

const SEED = `
  insert into public.orgs values
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

describe("147 — 사람 부르기 링크", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(SCHEMA);
    await db.exec(migration);
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

  describe("표에 직접 손대지 못한다", () => {
    it("★ 토큰 목록을 «훑을» 수 있으면 그 자체가 사고다", async () => {
      const grants = await db.query<{ n: number }>(`
        select count(*)::int as n from information_schema.role_table_grants
         where table_name = 'org_invite_links' and grantee in ('anon','authenticated','public')`);
      expect(grants.rows[0].n, "표에 직접 권한이 남아 있다").toBe(0);
    });
  });
});

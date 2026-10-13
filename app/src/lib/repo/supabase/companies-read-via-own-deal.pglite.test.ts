import { PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// QA #883 — migration 173: 내 담당 딜이 걸린 회사는 읽기만 열리고, 수정·삭제는 예전 정책 그대로다.
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/173_companies_read_via_own_deal.sql"),
  "utf8",
);

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const ids = {
  org: id("a1"), otherOrg: id("a2"), owner: id("1a"), member: id("2a"), outsider: id("3a"),
  ownCompany: id("c1"), viaDeal: id("c2"), unrelated: id("c3"), otherOrgCompany: id("c4"),
};

// 운영 001 의 companies_rw·deals_rw 를 같은 모양으로 둔다(이 시험의 기준선).
const SCHEMA = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.org_members(org_id uuid, user_id uuid, role text, scope text, primary key(org_id, user_id));
  create function public.is_org_member(p uuid) returns boolean language sql stable security definer as
    $$ select exists(select 1 from public.org_members where org_id = p and user_id = auth.uid()) $$;
  create function public.org_role(p uuid) returns text language sql stable security definer as
    $$ select role from public.org_members where org_id = p and user_id = auth.uid() $$;
  create function public.org_scope(p uuid) returns text language sql stable security definer as
    $$ select scope from public.org_members where org_id = p and user_id = auth.uid() $$;
  create table public.companies(id uuid primary key, org_id uuid not null, name text not null, assigned_to uuid);
  create table public.deals(id uuid primary key default gen_random_uuid(), org_id uuid not null, company_id uuid, assigned_to uuid);
  alter table public.companies enable row level security;
  alter table public.deals enable row level security;
  create policy companies_rw on public.companies for all to authenticated using (
    public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id) = 'all' or assigned_to = auth.uid()));
  create policy deals_rw on public.deals for all to authenticated using (
    public.is_org_member(org_id) and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id) = 'all' or assigned_to = auth.uid()));
  grant select, insert, update, delete on public.companies, public.deals to authenticated;
  create function public.begin_guarded_migration(
    p_logical_key text, p_file_name text, p_file_digest text,
    p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
  ) returns void language sql as $$ select $$;
`;

let db: PGliteInterface;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(migration);
  await db.exec(`
    insert into public.org_members values
      ('${ids.org}','${ids.owner}','owner','all'),
      ('${ids.org}','${ids.member}','member','assigned'),
      ('${ids.otherOrg}','${ids.outsider}','owner','all');
    insert into public.companies values
      ('${ids.ownCompany}','${ids.org}','내 회사','${ids.member}'),
      ('${ids.viaDeal}','${ids.org}','딜만 내 것','${ids.owner}'),
      ('${ids.unrelated}','${ids.org}','상관없는 회사','${ids.owner}'),
      ('${ids.otherOrgCompany}','${ids.otherOrg}','다른 워크스페이스','${ids.outsider}');
    insert into public.deals(org_id, company_id, assigned_to) values
      ('${ids.org}','${ids.viaDeal}','${ids.member}'),
      ('${ids.org}','${ids.unrelated}','${ids.owner}'),
      ('${ids.otherOrg}','${ids.otherOrgCompany}','${ids.member}');
  `);
});
afterAll(async () => { await db.close(); });

async function asUser<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('app.uid', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('app.uid', '', false);`); }
}

const names = async () =>
  (await db.query<{ name: string }>("select name from public.companies order by name")).rows.map((r) => r.name);

describe("migration 173 companies_read_via_own_deal", () => {
  it("본인 담당 멤버는 내 회사 + 내 딜이 걸린 회사를 읽는다 (상관없는 회사·다른 워크스페이스는 안 보임)", async () => {
    expect(await asUser(ids.member, names)).toEqual(["내 회사", "딜만 내 것"].sort());
  });

  it("딜로만 보이는 회사는 수정·삭제가 안 된다", async () => {
    const changed = await asUser(ids.member, async () => {
      const u = await db.query(`update public.companies set name = '바꿈' where id = '${ids.viaDeal}' returning id`);
      const d = await db.query(`delete from public.companies where id = '${ids.viaDeal}' returning id`);
      return u.rows.length + d.rows.length;
    });
    expect(changed).toBe(0);
    expect((await db.query<{ name: string }>(`select name from public.companies where id='${ids.viaDeal}'`)).rows[0]?.name).toBe("딜만 내 것");
  });

  it("대표는 예전처럼 워크스페이스 회사 전체를 본다", async () => {
    expect(await asUser(ids.owner, names)).toEqual(["내 회사", "딜만 내 것", "상관없는 회사"].sort());
  });

  it("다른 워크스페이스에 내 딜이 있어도 멤버가 아니면 그 회사는 안 보인다", async () => {
    const seen = await asUser(ids.member, names);
    expect(seen).not.toContain("다른 워크스페이스");
  });
});

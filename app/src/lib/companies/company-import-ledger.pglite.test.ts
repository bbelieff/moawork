import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 100 · 고객사 CSV 가져오기 멱등 원장.
 *
 * ★ 「다시 눌러도 중복 저장되지 않는다」는 주장을 코드가 아니라 «DB 제약» 으로 증명한다.
 *   앱 코드만 보면 그 주장이 참인지 알 수 없다 — 두 요청이 동시에 오면 앱의 검사는 통과한다.
 */
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/100_bbe236_company_csv_import.sql"),
  "utf8",
);

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000010";
const REQ = "00000000-0000-4000-8000-000000000099";

describe("고객사 CSV 가져오기 멱등 원장", () => {
  const opened: PGlite[] = [];
  afterEach(async () => { await Promise.all(opened.splice(0).map((db) => db.close())); });

  async function boot() {
    const db = new PGlite(); opened.push(db);
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.orgs(id uuid primary key);
      create function public.is_org_member(uuid) returns boolean language sql stable as $$ select true $$;
      create function public.begin_guarded_migration(
        p_logical_key text, p_file_name text, p_file_digest text,
        p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
      ) returns void language sql as $$ select $$;
      insert into public.orgs values('${ORG}');
    `);
    await db.exec(migration);
    return db;
  }

  it("같은 request_id 를 두 번 쓰면 두 번째가 거절된다 — 23505", async () => {
    const db = await boot();
    await db.exec(`insert into company_import_requests(org_id,request_id,actor_id,row_count) values('${ORG}','${REQ}','${USER}',3)`);
    await expect(
      db.exec(`insert into company_import_requests(org_id,request_id,actor_id,row_count) values('${ORG}','${REQ}','${USER}',3)`),
    ).rejects.toMatchObject({ code: "23505" });
    expect((await db.query<{ n: number }>("select count(*)::int n from company_import_requests")).rows[0].n).toBe(1);
  });

  it("행 상한 500 을 DB 가 막는다 — 앱만 막으면 다음 호출자가 그 규칙을 모른다", async () => {
    const db = await boot();
    await expect(
      db.exec(`insert into company_import_requests(org_id,request_id,row_count) values('${ORG}',gen_random_uuid(),501)`),
    ).rejects.toThrow(/company_import_row_cap/);
    // 500 은 통과한다 — 상한이 «501 부터» 막는지 확인한다
    await db.exec(`insert into company_import_requests(org_id,request_id,row_count) values('${ORG}',gen_random_uuid(),500)`);
  });

  it("다른 조직은 같은 request_id 를 쓸 수 있다 — 멱등 범위가 조직이다", async () => {
    const db = await boot();
    const other = "00000000-0000-4000-8000-000000000002";
    await db.exec(`insert into public.orgs values('${other}')`);
    await db.exec(`insert into company_import_requests(org_id,request_id,row_count) values('${ORG}','${REQ}',1)`);
    await db.exec(`insert into company_import_requests(org_id,request_id,row_count) values('${other}','${REQ}',1)`);
    expect((await db.query<{ n: number }>("select count(*)::int n from company_import_requests")).rows[0].n).toBe(2);
  });
});

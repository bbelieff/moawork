import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * BBE-239 · storage.objects RLS 가 org 경계를 지키는가.
 *
 * 경로 규약 {orgId}/{boardId}/{itemId}/{fileId}__{filename} 이라서
 * storage.foldername(name)[1] 이 orgId 다. 다른 org 접두사로는
 * select/insert/delete 전부 막혀야 한다 — 하나라도 새면 다른 회사 공문을 볼 수 있다.
 */
const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/102_bbe239_board_item_files_storage.sql"),
  "utf8",
);

const ids = {
  orgA: "00000000-0000-4000-8000-00000000000a",
  orgB: "00000000-0000-4000-8000-00000000000b",
  userA: "00000000-0000-4000-8000-00000000001a",
  userB: "00000000-0000-4000-8000-00000000001b",
};

async function setup(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean not null default false);
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text,
      name text not null,
      owner uuid
    );
    -- 실 Supabase 의 storage.foldername 을 흉내낸다: 마지막 세그먼트(파일명) 뺀 폴더 부분.
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
    $$;
    alter table storage.objects enable row level security;

    create table public.orgs(id uuid primary key);
    create table public.org_members(org_id uuid not null, user_id uuid not null, primary key(org_id, user_id));
    create function public.is_org_member(p_org uuid) returns boolean language sql stable as
      $$ select exists(select 1 from public.org_members where org_id = p_org and user_id = auth.uid()) $$;
    create function public.begin_guarded_migration(
      p_logical_key text, p_file_name text, p_file_digest text,
      p_expected_predecessor text, p_executor text, p_thread_id text, p_foundation boolean
    ) returns void language sql as $$ select $$;

    grant usage on schema storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant usage on schema public to authenticated;
    grant execute on function public.is_org_member(uuid) to authenticated;
    grant select on public.org_members, public.orgs to authenticated;

    insert into public.orgs values ('${ids.orgA}'), ('${ids.orgB}');
    insert into public.org_members values ('${ids.orgA}','${ids.userA}'), ('${ids.orgB}','${ids.userB}');
  `);
  await db.exec(migration);
  return db;
}

function actAs(db: PGlite, userId: string): Promise<unknown> {
  return db.exec(`select set_config('app.uid','${userId}',false); set role authenticated;`);
}

describe("BBE-239 · board-item-files 버킷 storage.objects RLS", () => {
  let db: PGlite | undefined;
  afterEach(async () => {
    await db?.close();
  });

  it("버킷이 생성되고 정책 3개가 붙는다", async () => {
    db = await setup();
    const bucket = await db.query<{ id: string }>(`select id from storage.buckets where id='board-item-files'`);
    expect(bucket.rows).toHaveLength(1);
  });

  it("같은 org 접두사면 insert/select/delete 가 전부 된다", async () => {
    db = await setup();
    await actAs(db, ids.userA);
    const path = `${ids.orgA}/board-1/item-1/file-1__a.pdf`;
    await db.exec(`insert into storage.objects(bucket_id,name) values('board-item-files','${path}')`);

    const seen = await db.query(`select 1 from storage.objects where name='${path}'`);
    expect(seen.rows).toHaveLength(1);

    await db.exec(`delete from storage.objects where name='${path}'`);
    const afterDelete = await db.query(`select 1 from storage.objects where name='${path}'`);
    expect(afterDelete.rows).toHaveLength(0);
  });

  it("다른 org 접두사로는 insert 가 막힌다(RLS 위반 에러)", async () => {
    db = await setup();
    await actAs(db, ids.userA);
    const otherOrgPath = `${ids.orgB}/board-1/item-1/file-1__a.pdf`;
    await expect(
      db.exec(`insert into storage.objects(bucket_id,name) values('board-item-files','${otherOrgPath}')`),
    ).rejects.toThrow();
  });

  it("다른 org 소유 파일은 select 로 안 보이고 delete 도 안 지워진다", async () => {
    db = await setup();
    // superuser 로 org-B 소유 행을 직접 심는다(RLS 우회 — 시드 목적).
    await db.exec("reset role");
    const orgBPath = `${ids.orgB}/board-1/item-1/file-1__b.pdf`;
    await db.exec(`insert into storage.objects(bucket_id,name) values('board-item-files','${orgBPath}')`);

    await actAs(db, ids.userA);
    const seenByA = await db.query(`select 1 from storage.objects where name='${orgBPath}'`);
    expect(seenByA.rows).toHaveLength(0); // select 는 조용히 0행(에러 아님).

    await db.exec(`delete from storage.objects where name='${orgBPath}'`);
    await db.exec("reset role");
    const stillThere = await db.query(`select 1 from storage.objects where name='${orgBPath}'`);
    expect(stillThere.rows).toHaveLength(1); // A 의 delete 는 대상 0행이라 실제로 안 지워졌다.
  });
});

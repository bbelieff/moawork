import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);

test("boards survive database restart and RLS isolates organizations", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "moawork-boards-"));
  const userA = "24000000-0000-4000-8000-000000000001";
  const orgA = "24000000-0000-4000-8000-000000000010";
  const orgB = "24000000-0000-4000-8000-000000000011";
  let db = new PGlite(dataDir);
  try {
    await db.exec(`
      create schema auth;
      create role authenticated nologin;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create table org_members(org_id uuid, user_id uuid, role text not null, scope text not null, primary key(org_id,user_id));
      create function is_org_member(p_org_id uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
        select exists(select 1 from org_members where org_id=p_org_id and user_id=auth.uid())
      $$;
      create function org_role(p_org_id uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
        select role from org_members where org_id=p_org_id and user_id=auth.uid()
      $$;
      create function org_scope(p_org_id uuid) returns text language sql stable security definer set search_path=public,pg_temp as $$
        select scope from org_members where org_id=p_org_id and user_id=auth.uid()
      $$;
      create table boards(id uuid primary key,org_id uuid not null,name text not null,source text);
      create table board_groups(id uuid primary key,org_id uuid not null,board_id uuid not null,name text not null);
      create table board_columns(id uuid primary key,org_id uuid not null,board_id uuid not null,key text not null,label text not null);
      create table items(id uuid primary key,org_id uuid not null,board_id uuid not null,group_id uuid,title text not null,assigned_to uuid);
      create table item_values(org_id uuid not null,item_id uuid not null,column_key text not null,value_jsonb jsonb,primary key(item_id,column_key));
      create table board_views(
        id uuid primary key,
        org_id uuid not null,
        board_id uuid not null,
        user_id uuid,
        name text not null,
        shared boolean not null default false
      );
      alter table boards enable row level security;
      alter table board_groups enable row level security;
      alter table board_columns enable row level security;
      alter table items enable row level security;
      alter table item_values enable row level security;
      alter table board_views enable row level security;
      create policy boards_rw on boards for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      create policy groups_rw on board_groups for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      create policy columns_rw on board_columns for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      create policy items_rw on items for all to authenticated using(
        is_org_member(org_id) and (
          org_role(org_id) in ('owner','admin')
          or org_scope(org_id) = 'all'
          or assigned_to = auth.uid()
        )
      ) with check(is_org_member(org_id));
      create policy itemvals_rw on item_values for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      create policy bviews_rw on board_views for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      create policy boardviews_rw on board_views for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      grant usage on schema public,auth to authenticated;
      grant select,insert,update,delete on boards,board_groups,board_columns,items,item_values,board_views to authenticated;
      grant execute on function auth.uid(),is_org_member(uuid),org_role(uuid),org_scope(uuid) to authenticated;
      insert into org_members values('${orgA}','${userA}','member','assigned');
      insert into boards values
        ('24000000-0000-4000-8000-000000000020','${orgA}','제품 보드','pack.seoul.policyfund1/newcust'),
        ('24000000-0000-4000-8000-000000000022','${orgA}','공지사항','core.notice'),
        ('24000000-0000-4000-8000-000000000021','${orgB}','타 조직 보드','pack.seoul.policyfund1/newcust');
      insert into board_groups values('24000000-0000-4000-8000-000000000030','${orgA}','24000000-0000-4000-8000-000000000020','진행');
      insert into board_columns values('24000000-0000-4000-8000-000000000040','${orgA}','24000000-0000-4000-8000-000000000020','status','상태');
      insert into items values
        ('24000000-0000-4000-8000-000000000050','${orgA}','24000000-0000-4000-8000-000000000020','24000000-0000-4000-8000-000000000030','재시작 유지','${userA}'),
        ('24000000-0000-4000-8000-000000000051','${orgA}','24000000-0000-4000-8000-000000000020','24000000-0000-4000-8000-000000000030','assigned 범위에서 숨김',null),
        ('24000000-0000-4000-8000-000000000052','${orgA}','24000000-0000-4000-8000-000000000022',null,'조직 공지',null);
      insert into item_values values
        ('${orgA}','24000000-0000-4000-8000-000000000050','status','"ready"'),
        ('${orgA}','24000000-0000-4000-8000-000000000051','status','"hidden"'),
        ('${orgA}','24000000-0000-4000-8000-000000000052','body','"organization-wide"');
      insert into board_views values
        ('24000000-0000-4000-8000-000000000060','${orgA}','24000000-0000-4000-8000-000000000020','${userA}','내 뷰',false),
        ('24000000-0000-4000-8000-000000000061','${orgA}','24000000-0000-4000-8000-000000000020','24000000-0000-4000-8000-000000000002','공유 뷰',true),
        ('24000000-0000-4000-8000-000000000062','${orgA}','24000000-0000-4000-8000-000000000020','24000000-0000-4000-8000-000000000002','타인 비공개',false),
        ('24000000-0000-4000-8000-000000000063','${orgA}','24000000-0000-4000-8000-000000000020',null,'기본 뷰',false);
    `);
    const rlsMigration = await readFile(path.join(
      root,
      "supabase",
      "migrations",
      "061_board_rls_visibility.sql",
    ), "utf8");
    await db.exec(rlsMigration);
    await db.exec(rlsMigration);
    await db.close();

    db = new PGlite(dataDir);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${userA}',false)`);
    assert.deepEqual(
      (await db.query("select policyname from pg_policies where tablename='item_values' order by policyname")).rows,
      [
        { policyname: "item_values_delete_assigned_scope" },
        { policyname: "item_values_insert_assigned_scope" },
        { policyname: "item_values_update_assigned_scope" },
        { policyname: "item_values_visible" },
      ],
    );
    const boards = (await db.query("select name,source from boards order by name")).rows;
    assert.deepEqual(boards, [
      { name: "공지사항", source: "core.notice" },
      { name: "제품 보드", source: "pack.seoul.policyfund1/newcust" },
    ]);
    assert.equal((await db.query("select count(*)::int as n from board_groups")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from board_columns")).rows[0].n, 1);
    assert.equal((await db.query("select count(*)::int as n from items")).rows[0].n, 2);
    assert.deepEqual(
      (await db.query("select title from items where id='24000000-0000-4000-8000-000000000052'")).rows,
      [{ title: "조직 공지" }],
    );
    await assert.rejects(
      db.query("update items set assigned_to='24000000-0000-4000-8000-000000000002' where id='24000000-0000-4000-8000-000000000050' returning id"),
      /row-level security/i,
    );
    assert.deepEqual(
      (await db.query("select value_jsonb from item_values order by value_jsonb")).rows,
      [{ value_jsonb: "organization-wide" }, { value_jsonb: "ready" }],
    );
    assert.equal(
      (await db.query("update item_values set value_jsonb='\"blocked\"' where item_id='24000000-0000-4000-8000-000000000051' returning item_id")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(`insert into item_values values ('${orgA}','24000000-0000-4000-8000-000000000051','blocked','"blocked"')`),
      /row-level security/i,
    );
    assert.equal(
      (await db.query("update items set title='차단' where id='24000000-0000-4000-8000-000000000052' returning id")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("update item_values set value_jsonb='\"blocked\"' where item_id='24000000-0000-4000-8000-000000000052' returning item_id")).rows.length,
      0,
    );
    assert.deepEqual(
      (await db.query("select name from board_views order by name")).rows,
      [{ name: "공유 뷰" }, { name: "기본 뷰" }, { name: "내 뷰" }],
    );
    assert.equal(
      (await db.query("update board_views set name='침범' where id='24000000-0000-4000-8000-000000000062' returning id")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("update board_views set name='공유 뷰 침범' where id='24000000-0000-4000-8000-000000000061' returning id")).rows.length,
      0,
    );
    await assert.rejects(
      db.query(`insert into board_views values ('24000000-0000-4000-8000-000000000064','${orgA}','24000000-0000-4000-8000-000000000020','24000000-0000-4000-8000-000000000002','타인 소유 생성',false)`),
      /row-level security/i,
    );
    assert.equal(
      (await db.query("update board_views set name='내 뷰 수정' where id='24000000-0000-4000-8000-000000000060' returning id")).rows.length,
      1,
    );
    assert.equal((await db.query(`select count(*)::int as n from boards where org_id='${orgB}'`)).rows[0].n, 0);
  } finally {
    await db.close().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  }
});

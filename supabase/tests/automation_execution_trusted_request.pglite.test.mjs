import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pgliteRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(pgliteRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js")).href);

const org = "73000000-0000-4000-8000-000000000010";
const otherOrg = "73000000-0000-4000-8000-000000000011";
const board = "73000000-0000-4000-8000-000000000020";
const groupA = "73000000-0000-4000-8000-000000000030";
const groupB = "73000000-0000-4000-8000-000000000031";
const item = "73000000-0000-4000-8000-000000000040";
const rule = "73000000-0000-4000-8000-000000000050";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create function public.gen_random_uuid() returns uuid language sql volatile as $$ select ('00000000-0000-4000-8000-' || lpad((floor(random()*999999999999)::bigint)::text,12,'0'))::uuid $$;
    create table public.orgs(id uuid primary key);
    create table public.boards(id uuid primary key, org_id uuid not null references public.orgs(id));
    create table public.board_groups(id uuid primary key, org_id uuid not null references public.orgs(id), board_id uuid not null references public.boards(id));
    create table public.items(id uuid primary key, org_id uuid not null references public.orgs(id), board_id uuid not null references public.boards(id), group_id uuid, title text not null, updated_at timestamptz not null default now());
    create table public.item_values(org_id uuid not null references public.orgs(id), item_id uuid not null references public.items(id), column_key text not null, value_jsonb jsonb, primary key(item_id,column_key));
    create table public.board_automation_rules(id uuid primary key, org_id uuid not null references public.orgs(id), board_id uuid not null references public.boards(id), status_column_key text not null, status_value text not null, trigger_label_id text, conditions jsonb not null default '[]'::jsonb, to_group_id uuid not null references public.board_groups(id), enabled boolean not null default true);
    grant usage on schema public to anon,authenticated,service_role;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  `);
  await db.exec(await readFile(path.join(root, "supabase", "migrations", "051_automation_execution.sql"), "utf8"));
  await db.exec(await readFile(path.join(root, "supabase", "migrations", "057_automation_execution_trusted_request.sql"), "utf8"));
  await db.exec(`
    insert into public.orgs values('${org}'),('${otherOrg}');
    insert into public.boards values('${board}','${org}');
    insert into public.board_groups values('${groupA}','${org}','${board}'),('${groupB}','${org}','${board}');
    insert into public.items(id,org_id,board_id,group_id,title) values('${item}','${org}','${board}','${groupA}','Synthetic item');
    insert into public.item_values values('${org}','${item}','status','{"label_id":"label:done","value":"Done"}');
    insert into public.board_automation_rules values('${rule}','${org}','${board}','status','Done','label:done','[]','${groupB}',true);
  `);
  return db;
}

async function request(db, key, overrides = {}) {
  const row = { org_id: org, item_id: item, rule_id: rule, from_group_id: groupA, source_column_key: "status", source_label_id: "label:done", visited_rule_ids: [], ...overrides };
  await db.exec(`insert into public.board_automation_execution_requests(execution_key,org_id,item_id,rule_id,from_group_id,source_column_key,source_label_id,visited_rule_ids) values('${key}','${row.org_id}','${row.item_id}','${row.rule_id}',${row.from_group_id ? `'${row.from_group_id}'` : "null"},'${row.source_column_key}','${row.source_label_id}','${JSON.stringify(row.visited_rule_ids)}'::jsonb)`);
}

async function asService(db) { await db.exec("set role service_role;"); }

test("blocked no-match and loop requests replay once without duplicate terminal history", async () => {
  const db = await setup();
  try {
    await request(db, "no-match", { source_label_id: "label:stale" });
    await request(db, "loop", { visited_rule_ids: [rule] });
    await asService(db);
    const noMatch = await db.query("select * from public.execute_trusted_board_automation('no-match')");
    assert.deepEqual(noMatch.rows[0], { status: "blocked", error_code: "status_or_condition_not_current", visited_rule_ids: [] });
    const noMatchReplay = await db.query("select * from public.execute_trusted_board_automation('no-match')");
    assert.equal(noMatchReplay.rows[0].status, "duplicate");
    const loop = await db.query("select * from public.execute_trusted_board_automation('loop')");
    assert.equal(loop.rows[0].error_code, "automation_loop_blocked");
    const loopReplay = await db.query("select * from public.execute_trusted_board_automation('loop')");
    assert.equal(loopReplay.rows[0].status, "duplicate");
    await db.exec("reset role;");
    assert.deepEqual((await db.query("select state,count(*)::integer as n from public.board_automation_execution_requests where state='blocked' group by state")).rows, [{ state: "blocked", n: 2 }]);
    assert.equal((await db.query(`select group_id from public.items where id='${item}'`)).rows[0].group_id, groupA);
  } finally { await db.close(); }
});

test("is_not blocks missing and JSON-null condition values without moving or duplicating history", async () => {
  const db = await setup();
  try {
    await db.exec(`update public.board_automation_rules
      set conditions='[{"column_key":"assignee","operator":"is_not","value_kind":"user_id","value":"user-a"}]'::jsonb
      where id='${rule}'`);
    await request(db, "is-not-missing");
    await asService(db);
    const missing = await db.query("select * from public.execute_trusted_board_automation('is-not-missing')");
    assert.equal(missing.rows[0].status, "blocked");
    assert.equal(missing.rows[0].error_code, "status_or_condition_not_current");
    const missingReplay = await db.query("select * from public.execute_trusted_board_automation('is-not-missing')");
    assert.equal(missingReplay.rows[0].status, "duplicate");
    assert.equal((await db.query("select count(*)::integer as n from public.board_automation_execution_requests where execution_key='is-not-missing' and state='blocked'")).rows[0].n, 1);

    await db.exec("reset role;");
    await db.exec(`insert into public.item_values values('${org}','${item}','assignee','null'::jsonb)`);
    await request(db, "is-not-json-null");
    await asService(db);
    const jsonNull = await db.query("select * from public.execute_trusted_board_automation('is-not-json-null')");
    assert.equal(jsonNull.rows[0].status, "blocked");
    assert.equal(jsonNull.rows[0].error_code, "status_or_condition_not_current");
    const jsonNullReplay = await db.query("select * from public.execute_trusted_board_automation('is-not-json-null')");
    assert.equal(jsonNullReplay.rows[0].status, "duplicate");
    assert.equal((await db.query("select count(*)::integer as n from public.board_automation_execution_requests where execution_key='is-not-json-null' and state='blocked'")).rows[0].n, 1);

    await db.exec("reset role;");
    assert.equal((await db.query(`select group_id from public.items where id='${item}'`)).rows[0].group_id, groupA);
  } finally { await db.close(); }
});

test("trusted request transaction recomputes scope and can recover after rollback", async () => {
  const db = await setup();
  try {
    await request(db, "safe-retry");
    await asService(db);
    await db.exec("begin;");
    assert.equal((await db.query("select * from public.execute_trusted_board_automation('safe-retry')")).rows[0].status, "succeeded");
    await db.exec("rollback;");
    assert.equal((await db.query("select * from public.execute_trusted_board_automation('safe-retry')")).rows[0].status, "succeeded");
    await db.exec("reset role;");
    assert.equal((await db.query(`select group_id from public.items where id='${item}'`)).rows[0].group_id, groupB);
    assert.deepEqual((await db.query("select state,count(*)::integer as n from public.board_automation_execution_requests group by state")).rows, [{ state: "succeeded", n: 1 }]);
  } finally { await db.close(); }
});

test("direct callers and cross-tenant or malformed keys fail closed", async () => {
  const db = await setup();
  try {
    await request(db, "cross-org", { org_id: otherOrg });
    await db.exec("set role anon;");
    await assert.rejects(db.query("select * from public.execute_trusted_board_automation('cross-org')"), /permission denied/iu);
    await assert.rejects(db.query("insert into public.board_automation_execution_requests(execution_key,org_id,item_id,rule_id,source_column_key,source_label_id) values('forged','73000000-0000-4000-8000-000000000010','73000000-0000-4000-8000-000000000040','73000000-0000-4000-8000-000000000050','status','label:done')"), /permission denied/iu);
    await db.exec("reset role; set role service_role;");
    const missing = await db.query("select * from public.execute_trusted_board_automation('missing')");
    assert.deepEqual(missing.rows[0], { status: "rejected", error_code: "missing", visited_rule_ids: [] });
    const cross = await db.query("select * from public.execute_trusted_board_automation('cross-org')");
    assert.equal(cross.rows[0].status, "failed");
    await db.exec("reset role;");
    assert.equal((await db.query("select count(*)::integer as n from public.board_automation_execution_requests where execution_key='cross-org' and state='failed'")).rows[0].n, 1);
  } finally { await db.close(); }
});

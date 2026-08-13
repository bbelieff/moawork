import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dependencyRoot = process.env.PGLITE_MODULE_ROOT ?? root;
const { PGlite } = await import(pathToFileURL(path.join(
  dependencyRoot, "node_modules", "@electric-sql", "pglite", "dist", "index.js",
)).href);

async function migrationSql() {
  const names = await readdir(path.join(root, "supabase", "migrations"));
  const name = names.find((candidate) => candidate.endsWith("_board_calculated_values.sql"));
  assert.ok(name, "board calculation migration must exist");
  return readFile(path.join(root, "supabase", "migrations", name), "utf8");
}

async function bootstrap(db) {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create type public.field_source as enum ('auto','in','act','msg','lk','calc');
    create table public.orgs(id uuid primary key);
    create table public.boards(id uuid primary key, org_id uuid not null references public.orgs(id));
    create table public.items(
      id uuid primary key, org_id uuid not null references public.orgs(id),
      board_id uuid not null references public.boards(id)
    );
    create table public.board_columns(
      id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
      board_id uuid not null references public.boards(id), key text not null,
      label text not null, source public.field_source not null default 'in',
      is_readonly boolean not null default false, unique(board_id,key)
    );
    create table public.item_values(
      org_id uuid not null references public.orgs(id),
      item_id uuid not null references public.items(id), column_key text not null,
      value_jsonb jsonb, primary key(item_id,column_key)
    );
  `);
}

const ORG = "00000000-0000-0000-0000-000000000001";
const BOARD = "00000000-0000-0000-0000-000000000002";
const ITEM = "00000000-0000-0000-0000-000000000003";

const columns = [
  ["execution", "실행액", "in", false],
  ["fee_percent", "수수료(%)", "in", false],
  ["funded_on", "조달일", "in", false],
  ["fee_paid_on", "수수료_입금일", "in", false],
  ["review_ends_on", "예상 심사 종료", "in", false],
  ["targets", "대상", "in", false],
  ["readers", "읽은 사람", "auto", false],
  ["fee", "ƒ수수료(원)", "calc", true],
  ["total", "ƒ총 매출액", "calc", true],
  ["reapply", "ƒ재신청 안내일", "calc", true],
  ["d180", "ƒD+180", "calc", true],
  ["dday", "ƒ심사 D-day", "calc", true],
  ["read_count", "읽음", "calc", true],
];

async function seedOne(db) {
  await db.query(`insert into public.orgs(id) values ($1)`, [ORG]);
  await db.query(`insert into public.boards(id,org_id) values ($1,$2)`, [BOARD, ORG]);
  await db.query(`insert into public.items(id,org_id,board_id) values ($1,$2,$3)`, [ITEM, ORG, BOARD]);
  for (const [key, label, source, readOnly] of columns) {
    await db.query(`insert into public.board_columns(org_id,board_id,key,label,source,is_readonly) values($1,$2,$3,$4,$5,$6)`, [ORG, BOARD, key, label, source, readOnly]);
  }
  const values = {
    execution: 100_000_000,
    fee_percent: 3,
    funded_on: "2026-08-20",
    fee_paid_on: "2026-08-01",
    review_ends_on: "2026-10-03",
    targets: ["a", "b", "c"],
    readers: ["b", "c", "x"],
  };
  for (const [key, value] of Object.entries(values)) {
    await db.query(`insert into public.item_values(org_id,item_id,column_key,value_jsonb) values($1,$2,$3,$4::jsonb)`, [ORG, ITEM, key, JSON.stringify(value)]);
  }
}

test("BBE-153 recalculates on source writes, rejects manual calc writes, records freshness and failures", async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await seedOne(db);
    const sql = await migrationSql();
    await db.exec(sql);
    await db.exec(sql);

    const privileges = await db.query(`
      select
        has_function_privilege('authenticated', 'public.bbe153_calculate_item(uuid,date,boolean)', 'execute') as app_can_execute,
        has_function_privilege('service_role', 'public.bbe153_calculate_item(uuid,date,boolean)', 'execute') as service_can_execute,
        has_table_privilege('service_role', 'public.board_calculation_failures', 'select') as service_can_read_failures
    `);
    assert.deepEqual(privileges.rows, [{
      app_can_execute: false,
      service_can_execute: false,
      service_can_read_failures: false,
    }]);

    await db.query(`select public.bbe153_calculate_item($1, '2026-08-13', true)`, [ITEM]);
    const initial = await db.query(`select column_key,value_jsonb,calculated_at,stale_after from public.item_values where item_id=$1 and calculated_at is not null order by column_key`, [ITEM]);
    const values = Object.fromEntries(initial.rows.map((row) => [row.column_key, row.value_jsonb]));
    assert.deepEqual(values, {
      d180: "2027-01-28", dday: "D-51", fee: 3_000_000, read_count: 2,
      reapply: "2027-08-20", total: 3_000_000,
    });
    assert.equal(initial.rows.every((row) => row.calculated_at instanceof Date), true);
    assert.equal(initial.rows.find((row) => row.column_key === "dday").stale_after.toISOString(), "2026-08-13T15:00:00.000Z");

    await db.query(`update public.item_values set value_jsonb='200000000'::jsonb where item_id=$1 and column_key='execution'`, [ITEM]);
    const changed = await db.query(`select column_key,value_jsonb from public.item_values where item_id=$1 and column_key in ('fee','total') order by column_key`, [ITEM]);
    assert.deepEqual(changed.rows, [
      { column_key: "fee", value_jsonb: 6_000_000 },
      { column_key: "total", value_jsonb: 6_000_000 },
    ]);

    await assert.rejects(
      db.query(`update public.item_values set value_jsonb='1'::jsonb where item_id=$1 and column_key='fee'`, [ITEM]),
      /calculated values are server read-only/,
    );

    const beforeDaily = await db.query(`select calculated_at from public.item_values where item_id=$1 and column_key='dday'`, [ITEM]);
    const daily = await db.query(`select public.bbe153_recalculate_daily('2026-08-14') as count`);
    assert.equal(Number(daily.rows[0].count), 1);
    const afterDaily = await db.query(`select value_jsonb,calculated_at from public.item_values where item_id=$1 and column_key='dday'`, [ITEM]);
    assert.equal(afterDaily.rows[0].value_jsonb, "D-50");
    assert.ok(afterDaily.rows[0].calculated_at > beforeDaily.rows[0].calculated_at);

    await db.exec(`
      create function public.zz_bbe153_force_failure() returns trigger language plpgsql as $$
      begin
        if new.column_key='fee' and current_setting('app.bbe153_internal_calculation',true)='on'
        then raise exception 'forced calculation failure'; end if;
        return new;
      end $$;
      create trigger zz_bbe153_force_failure before update of value_jsonb on public.item_values
      for each row execute function public.zz_bbe153_force_failure();
    `);
    await db.query(`update public.item_values set value_jsonb='300000000'::jsonb where item_id=$1 and column_key='execution'`, [ITEM]);
    const failure = await db.query(`select source_column_key,error_message from public.board_calculation_failures where item_id=$1`, [ITEM]);
    assert.deepEqual(failure.rows, [{ source_column_key: "execution", error_message: "forced calculation failure" }]);
    const preserved = await db.query(`select value_jsonb from public.item_values where item_id=$1 and column_key='fee'`, [ITEM]);
    assert.equal(preserved.rows[0].value_jsonb, 6_000_000);
    const source = await db.query(`select value_jsonb from public.item_values where item_id=$1 and column_key='execution'`, [ITEM]);
    assert.equal(source.rows[0].value_jsonb, 300_000_000);
  } finally {
    await db.close();
  }
});

test("BBE-153 daily set-based recalculation covers 8,400 records within 15 seconds", { timeout: 30_000 }, async () => {
  const db = new PGlite();
  try {
    await bootstrap(db);
    await db.query(`insert into public.orgs(id) values ($1)`, [ORG]);
    await db.query(`insert into public.boards(id,org_id) values ($1,$2)`, [BOARD, ORG]);
    for (const row of [
      ["fee_paid_on", "수수료_입금일", "in", false],
      ["review_ends_on", "예상 심사 종료", "in", false],
      ["d180", "ƒD+180", "calc", true],
      ["dday", "ƒ심사 D-day", "calc", true],
    ]) {
      await db.query(`insert into public.board_columns(org_id,board_id,key,label,source,is_readonly) values($1,$2,$3,$4,$5,$6)`, [ORG, BOARD, ...row]);
    }
    await db.query(`insert into public.items(id,org_id,board_id) select gen_random_uuid(),$1,$2 from generate_series(1,8400)`, [ORG, BOARD]);
    await db.query(`insert into public.item_values(org_id,item_id,column_key,value_jsonb) select $1,id,'fee_paid_on','"2026-08-01"'::jsonb from public.items`, [ORG]);
    await db.query(`insert into public.item_values(org_id,item_id,column_key,value_jsonb) select $1,id,'review_ends_on','"2026-10-03"'::jsonb from public.items`, [ORG]);
    await db.exec(await migrationSql());

    const startedAt = performance.now();
    const result = await db.query(`select public.bbe153_recalculate_daily('2026-08-13') as count`);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(Number(result.rows[0].count), 8_400);
    assert.equal(Number((await db.query(`select count(*) as count from public.item_values where calculated_at is not null`)).rows[0].count), 16_800);
    assert.ok(elapsedMs < 15_000, `8,400-record daily recalculation took ${elapsedMs.toFixed(1)}ms`);
    console.log(`BBE-153 PERF 8,400 records: ${elapsedMs.toFixed(1)}ms`);
  } finally {
    await db.close();
  }
});

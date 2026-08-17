import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const foundation = await readFile(new URL("../migrations/094_migration_apply_guard.sql", import.meta.url), "utf8");
const digest = foundation.match(/digest=([0-9a-f]{64})/u)?.[1];

function begin(key, predecessor, suffix = "") {
  return `select public.begin_guarded_migration(
    p_logical_key => '${key}', p_file_name => '${key}.sql',
    p_file_digest => '${digest}', p_expected_predecessor => '${predecessor}',
    p_executor => 'DG-06', p_thread_id => 'bbe188-test${suffix}', p_foundation => false
  );`;
}

async function setup(dataDir) {
  const db = new PGlite(dataDir);
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(foundation);
  await db.exec("create table public.guard_test_body(logical_key text primary key);");
  return db;
}

test("same logical migration concurrent callers produce one body and one guard", async () => {
  const db = await setup();
  try {
    const sql = `begin; ${begin("095_same", "094_migration_apply_guard")} insert into public.guard_test_body values ('095_same'); commit;`;
    const settled = await Promise.allSettled([db.exec(sql), db.exec(sql)]);
    assert.deepEqual(settled.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    await db.exec("rollback;");
    assert.equal((await db.query("select count(*)::int as count from public.guard_test_body")).rows[0].count, 1);
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='095_same'")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("different migrations serialize and reverse predecessor fails closed", async () => {
  const db = await setup();
  try {
    const first = `begin; ${begin("095_first", "094_migration_apply_guard")} select pg_sleep(0.05); insert into public.guard_test_body values ('095_first'); commit;`;
    const second = `begin; ${begin("096_second", "095_first")} insert into public.guard_test_body values ('096_second'); commit;`;
    const serialized = await Promise.allSettled([db.exec(first), db.exec(second)]);
    assert.deepEqual(serialized.map((result) => result.status), ["fulfilled", "fulfilled"]);
    await assert.rejects(
      db.exec(`begin; ${begin("098_reverse", "097_missing")} insert into public.guard_test_body values ('098_reverse'); commit;`),
      /expected guarded predecessor is missing/u,
    );
    await db.exec("rollback;");
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='098_reverse'")).rows[0].count, 0);
  } finally { await db.close(); }
});

test("failed body rolls back its guard and retry succeeds", async () => {
  const db = await setup();
  try {
    await assert.rejects(db.exec(`begin; ${begin("095_retry", "094_migration_apply_guard")} insert into public.missing_table values (1); commit;`));
    await db.exec("rollback;");
    assert.equal((await db.query("select count(*)::int as count from public.migration_apply_guard where logical_key='095_retry'")).rows[0].count, 0);
    await db.exec(`begin; ${begin("095_retry", "094_migration_apply_guard")} insert into public.guard_test_body values ('095_retry'); commit;`);
    assert.equal((await db.query("select count(*)::int as count from public.guard_test_body where logical_key='095_retry'")).rows[0].count, 1);
  } finally { await db.close(); }
});

test("connection crash releases the global lock and direct customer roles remain denied", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "migration-guard-pglite-"));
  let db = await setup(dataDir);
  try {
    await db.exec("begin; select pg_advisory_xact_lock(1297040711, 188);");
    await db.close();
    db = new PGlite(dataDir);
    await db.exec(`begin; ${begin("095_after_crash", "094_migration_apply_guard")} insert into public.guard_test_body values ('095_after_crash'); commit;`);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role};`);
      await assert.rejects(db.query("select * from public.migration_apply_guard"), /permission denied/u);
      await assert.rejects(db.exec(begin("096_denied", "095_after_crash", role)), /permission denied|requires postgres/u);
      await db.exec("reset role;");
    }
  } finally { await db.close(); }
});

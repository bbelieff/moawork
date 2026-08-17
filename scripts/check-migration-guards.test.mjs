import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectMigrationDirectory, migrationDigest } from "./check-migration-guards.mjs";

function guarded(key, predecessor, foundation = false, body = "select 1;") {
  let sql = `-- moa-migration-guard: logical_key=${key} predecessor=${predecessor} digest=${"0".repeat(64)} foundation=${foundation}\n${foundation ? "select pg_advisory_xact_lock(1297040711, 188);\ncreate table guard_foundation(id int);\n" : ""}select public.begin_guarded_migration(p_logical_key => '${key}', p_file_name => '${key}.sql', p_file_digest => '${"0".repeat(64)}', p_expected_predecessor => '${predecessor}', p_foundation => ${foundation});\n${body}\n`;
  const digest = migrationDigest(sql);
  return sql.replaceAll("0".repeat(64), digest);
}

async function fixture(files) {
  const directory = await mkdtemp(join(tmpdir(), "migration-guard-"));
  await Promise.all(Object.entries(files).map(([name, sql]) => writeFile(join(directory, name), sql)));
  return directory;
}

test("accepts an unguarded baseline and a contiguous guarded chain", async () => {
  const directory = await fixture({
    "093_baseline.sql": "select 1;",
    "094_guard.sql": guarded("094_guard", "093_baseline", true),
    "095_next.sql": guarded("095_next", "094_guard"),
  });
  assert.equal((await inspectMigrationDirectory(directory)).guarded.length, 2);
});

test("rejects missing guards, predecessor gaps, and digest drift", async () => {
  await assert.rejects(async () => inspectMigrationDirectory(await fixture({
    "093_baseline.sql": "select 1;", "094_guard.sql": guarded("094_guard", "093_baseline", true), "095_next.sql": "select 2;",
  })), /missing mandatory/u);
  await assert.rejects(async () => inspectMigrationDirectory(await fixture({
    "093_baseline.sql": "select 1;", "094_guard.sql": guarded("094_guard", "092_wrong", true),
  })), /predecessor gap/u);
  await assert.rejects(async () => inspectMigrationDirectory(await fixture({
    "093_baseline.sql": "select 1;", "094_guard.sql": `${guarded("094_guard", "093_baseline", true)}select 2;`,
  })), /digest mismatch/u);
});

test("rejects a migration body placed before its guard call", async () => {
  const bodyBeforeGuard = guarded("095_next", "094_guard").replace(
    "select public.begin_guarded_migration",
    "create table escaped_body(id int);\nselect public.begin_guarded_migration",
  );
  const digest = migrationDigest(bodyBeforeGuard);
  const corrected = bodyBeforeGuard.replace(/digest=[0-9a-f]{64}/u, `digest=${digest}`).replace(/p_file_digest => '[0-9a-f]{64}'/u, `p_file_digest => '${digest}'`);
  await assert.rejects(async () => inspectMigrationDirectory(await fixture({
    "093_baseline.sql": "select 1;",
    "094_guard.sql": guarded("094_guard", "093_baseline", true),
    "095_next.sql": corrected,
  })), /must precede/u);
});

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import {
  assertProductionConnectionTarget,
  collectAddedMigrations,
  productionClientConfig,
  queryHostedGuard,
  validateHostedRows,
  verifyHostedMigrations,
} from "./migration-deploy-gate.mjs";

const migration = {
  logicalKey: "141_issue632_start_company_work_v2",
  fileName: "141_issue632_start_company_work_v2.sql",
  digest: "a".repeat(64),
};

test("only newly added migration files enter the hosted gate", () => {
  assert.deepEqual(collectAddedMigrations([
    { filename: "app/src/a.ts", status: "modified" },
    { filename: `supabase/migrations/${migration.fileName}`, status: "added" },
  ]), [{ path: `supabase/migrations/${migration.fileName}`, fileName: migration.fileName }]);
  assert.throws(() => collectAddedMigrations([
    { filename: "supabase/migrations/140_existing.sql", status: "modified" },
  ]), /EXISTING_FILE_CHANGED/u);
  assert.throws(() => collectAddedMigrations([
    { filename: "supabase/migrations/not-numbered.sql", status: "added" },
  ]), /INVALID_FILE_NAME/u);
  assert.throws(() => collectAddedMigrations([
    { filename: "supabase/migrations/nested/141_hidden.sql", status: "added" },
  ]), /INVALID_FILE_NAME/u);
});

test("exact guard key, file, and digest are required", () => {
  const exact = [{ logicalKey: migration.logicalKey, fileName: migration.fileName, fileDigest: migration.digest }];
  assert.deepEqual(validateHostedRows([migration], exact).verified, [migration]);
  assert.throws(() => validateHostedRows([migration], []), /NOT_APPLIED/u);
  assert.throws(() => validateHostedRows([migration], [{ ...exact[0], fileDigest: "b".repeat(64) }]), /IDENTITY_MISMATCH/u);
  assert.throws(() => validateHostedRows([migration], [exact[0], exact[0]]), /DUPLICATE_GUARD/u);
});

test("migration PR without a local release credential fails closed before a query", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "migration-deploy-gate-"));
  let created = 0;
  await assert.rejects(() => queryHostedGuard([migration], { cwd, clientFactory: async () => { created += 1; } }), /CREDENTIAL_MISSING/u);
  assert.equal(created, 0);
});

test("release credential is bound to the production Supabase project before connection", async () => {
  assert.equal(assertProductionConnectionTarget("postgresql://postgres:secret@db.srtvmpcosekduvsscsyz.supabase.co:5432/postgres").transport, "direct");
  assert.equal(assertProductionConnectionTarget("postgresql://postgres.srtvmpcosekduvsscsyz:secret@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres").transport, "pooler");
  assert.throws(() => assertProductionConnectionTarget("postgresql://postgres:secret@db.other-project.supabase.co/postgres"), /PROJECT_IDENTITY_MISMATCH/u);
  assert.throws(() => assertProductionConnectionTarget("postgresql://postgres.other-project:secret@aws-0-ap-northeast-2.pooler.supabase.com/postgres"), /PROJECT_IDENTITY_MISMATCH/u);
  assert.throws(() => assertProductionConnectionTarget("postgresql://postgres.srtvmpcosekduvsscsyz:secret@example.invalid/postgres"), /PROJECT_IDENTITY_MISMATCH/u);

  const cwd = await mkdtemp(join(tmpdir(), "migration-deploy-gate-"));
  await writeFile(join(cwd, ".env.local"), "SUPABASE_DB_URL=postgresql://postgres:secret@db.other-project.supabase.co/postgres\n");
  let created = 0;
  await assert.rejects(() => queryHostedGuard([migration], { cwd, clientFactory: async () => { created += 1; } }), /PROJECT_IDENTITY_MISMATCH/u);
  assert.equal(created, 0);
});

test("production client requires certificate verification", () => {
  const connectionString = "postgresql://postgres:secret@db.srtvmpcosekduvsscsyz.supabase.co/postgres";
  const config = productionClientConfig(connectionString);
  assert.equal("connectionString" in config, false);
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  const client = new pg.Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.throws(() => productionClientConfig(`${connectionString}?sslmode=no-verify`), /CONNECTION_OPTIONS_FORBIDDEN/u);
  assert.throws(() => productionClientConfig(`${connectionString}?sslmode=disable`), /CONNECTION_OPTIONS_FORBIDDEN/u);
  assert.throws(() => productionClientConfig(`${connectionString}?sslcert=C%3A%5Cattacker.pem`), /CONNECTION_OPTIONS_FORBIDDEN/u);
});

test("hosted query is read-only, parameterized, exact, and closes its client", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "migration-deploy-gate-"));
  await writeFile(join(cwd, ".env.local"), "SUPABASE_DB_URL=postgresql://postgres:secret@db.srtvmpcosekduvsscsyz.supabase.co/postgres\n");
  const calls = [];
  let ended = 0;
  const result = await verifyHostedMigrations([migration], {
    cwd,
    clientFactory: async (config) => ({
      async connect() { calls.push("connect"); },
      async query(sql, values) {
        calls.push({ sql, values });
        return { rows: [{ logicalKey: migration.logicalKey, fileName: migration.fileName, fileDigest: migration.digest }] };
      },
      async end() { ended += 1; },
      config,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(calls[1].sql.trim().startsWith("select logical_key"), true);
  assert.deepEqual(calls[1].values, [[migration.logicalKey]]);
  assert.equal(ended, 1);
});

test("database errors redact connection strings", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "migration-deploy-gate-"));
  await writeFile(join(cwd, ".env"), "SUPABASE_DB_URL=postgresql://postgres:secret@db.srtvmpcosekduvsscsyz.supabase.co/postgres\n");
  await assert.rejects(() => queryHostedGuard([migration], {
    cwd,
    clientFactory: async () => ({
      async connect() { throw new Error("postgresql://postgres:secret@db.srtvmpcosekduvsscsyz.supabase.co/postgres unavailable"); },
      async end() {},
    }),
  }), (error) => {
    assert.match(error.message, /QUERY_FAILED/u);
    assert.doesNotMatch(error.message, /secret/u);
    return true;
  });
});

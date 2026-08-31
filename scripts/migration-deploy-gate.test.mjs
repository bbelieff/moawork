import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  /*
   * #665 — 검증은 «켠 채로» 두고 신뢰 앵커를 박는다.
   *
   * Supabase pooler 는 공개 CA 가 아니라 사설 루트로 서명한다. ca 를 안 주면
   * rejectUnauthorized: true 가 원리적으로 통과할 수 없어 마이그레이션 PR 이
   * 하나도 머지되지 않는다. 반대로 검증을 끄면 관문이 있으나 마나다.
   */
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /-----BEGIN CERTIFICATE-----/u);
  assert.deepEqual(Object.keys(config.ssl).sort(), ["ca", "rejectUnauthorized"]);
  const client = new pg.Client(config);
  assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
  assert.equal(client.connectionParameters.ssl.ca, config.ssl.ca);
  assert.throws(() => productionClientConfig(`${connectionString}?sslmode=no-verify`), /CONNECTION_OPTIONS_FORBIDDEN/u);
  assert.throws(() => productionClientConfig(`${connectionString}?sslmode=disable`), /CONNECTION_OPTIONS_FORBIDDEN/u);
  assert.throws(() => productionClientConfig(`${connectionString}?sslcert=C%3A%5Cattacker.pem`), /CONNECTION_OPTIONS_FORBIDDEN/u);
});

/*
 * #665 — 박아 둔 루트가 «그대로인가».
 *
 * 파일이 갈아끼워지면 관문은 조용히 «다른 것» 을 믿게 된다. 조용한 신뢰 이동이
 * 가장 위험하므로 지문이 다르면 fail-closed 여야 한다.
 */
test("pinned Supabase root certificate is the expected one", async () => {
  const { supabaseRootCertificate } = await import("./migration-deploy-gate.mjs");
  const pem = supabaseRootCertificate();
  assert.match(pem, /-----BEGIN CERTIFICATE-----/u);
  assert.match(pem, /-----END CERTIFICATE-----/u);

  // 지문을 여기서 «한 번 더» 독립적으로 센다 — 소스가 자기 상수를 자기 검사하는 것을 막는다.
  const body = pem.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/u)[1];
  const digest = createHash("sha256")
    .update(Buffer.from(body.replace(/\s/gu, ""), "base64"))
    .digest("hex");
  assert.equal(digest, "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa");
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

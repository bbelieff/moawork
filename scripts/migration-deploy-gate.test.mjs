import assert from "node:assert/strict";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, connect as connectTls } from "node:tls";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import pg from "pg";
import {
  assertProductionConnectionTarget,
  collectAddedMigrations,
  productionClientConfig,
  queryHostedGuard,
  supabaseRootCertificate,
  validateSupabaseRootCertificate,
  validateHostedRows,
  verifyHostedMigrations,
} from "./migration-deploy-gate.mjs";

const execFile = promisify(execFileCallback);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pemFromRaw(raw) {
  const base64 = raw.toString("base64");
  return Buffer.from(`-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/gu).join("\n")}\n-----END CERTIFICATE-----\n`);
}

function validateMutatedCertificate(bytes, now = Date.now()) {
  const certificate = new X509Certificate(bytes);
  return validateSupabaseRootCertificate(bytes, {
    expectedFileSha256: sha256(bytes),
    expectedRawSha256: sha256(certificate.raw),
    now,
  });
}

function opensslExecutable() {
  if (process.platform !== "win32") return "openssl";
  const gitExecPath = execFileSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true }).trim();
  return resolve(gitExecPath, "..", "..", "bin", "openssl.exe");
}

async function generateHostileTlsFixture() {
  const directory = await mkdtemp(join(tmpdir(), "migration-deploy-gate-tls-"));
  const path = (name) => join(directory, name);
  const run = (...args) => execFile(opensslExecutable(), args, { windowsHide: true });
  try {
    await run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", path("ca-key.pem"));
    await run(
      "req", "-x509", "-new", "-sha256", "-days", "2", "-key", path("ca-key.pem"),
      "-subj", "/CN=Issue668 Runtime Attacker Root",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign",
      "-out", path("ca.pem"),
    );
    await run("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", path("server-key.pem"));
    await run(
      "req", "-new", "-key", path("server-key.pem"), "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost", "-out", path("server.csr"),
    );
    await writeFile(
      path("server-ext.cnf"),
      "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n",
    );
    await run(
      "x509", "-req", "-in", path("server.csr"), "-CA", path("ca.pem"), "-CAkey", path("ca-key.pem"),
      "-CAcreateserial", "-days", "2", "-sha256", "-extfile", path("server-ext.cnf"), "-out", path("server.pem"),
    );
    return {
      ca: await readFile(path("ca.pem"), "utf8"),
      cert: await readFile(path("server.pem"), "utf8"),
      key: await readFile(path("server-key.pem"), "utf8"),
      async dispose() { await rm(directory, { recursive: true, force: true }); },
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function authorizeHostileLoopback({ ca, cert, key }, servername = "localhost") {
  const server = createServer({ key, cert });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const socket = connectTls({
        host: "127.0.0.1",
        port,
        servername,
        ca,
        rejectUnauthorized: true,
      });
      socket.once("secureConnect", () => {
        const authorized = socket.authorized;
        socket.end();
        resolve(authorized);
      });
      socket.once("error", reject);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

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
test("pinned Supabase root certificate is one exact current self-signed CA", async () => {
  const pem = supabaseRootCertificate();
  const bytes = await readFile(new URL("./supabase-prod-ca-2021.crt", import.meta.url));
  assert.equal(Buffer.byteLength(pem), bytes.length);
  assert.equal(pem, bytes.toString("utf8"));
  assert.equal(sha256(bytes), "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7");

  const certificate = new X509Certificate(pem);
  assert.equal(sha256(certificate.raw), "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa");
  assert.equal(certificate.ca, true);
  assert.equal(certificate.subject, certificate.issuer);
  assert.equal(certificate.checkIssued(certificate), true);
  assert.equal(certificate.verify(certificate.publicKey), true);
  assert.equal(certificate.validFromDate.getTime() <= Date.now(), true);
  assert.equal(Date.now() <= certificate.validToDate.getTime(), true);
});

test("CA loader rejects extra trust material and non-canonical whole files", async () => {
  const bytes = await readFile(new URL("./supabase-prod-ca-2021.crt", import.meta.url));
  const pem = bytes.toString("utf8");
  const fixture = await generateHostileTlsFixture();
  try {
    const hostileFiles = [
      ["second certificate", Buffer.from(pem + fixture.ca)],
      ["private key marker", Buffer.from(`${pem}-----BEGIN PRIVATE KEY-----\ninvalid-test-marker\n-----END PRIVATE KEY-----\n`)],
      ["prefix", Buffer.from(`untrusted-prefix\n${pem}`)],
      ["trailing bytes", Buffer.from(`${pem}untrusted-trailing\n`)],
      ["truncated", Buffer.from(pem.replace("-----END CERTIFICATE-----\n", ""))],
      ["malformed base64", Buffer.from(pem.replace("MIIDxD", "MIID*D"))],
    ];
    for (const [name, hostile] of hostileFiles) {
      assert.throws(() => validateSupabaseRootCertificate(hostile), /MIGRATION_DEPLOY_GATE_CA_/u, name);
    }
  } finally {
    await fixture.dispose();
  }
});

test("CA loader checks raw fingerprint, CA bit, self-signature, and validity", async () => {
  const bytes = await readFile(new URL("./supabase-prod-ca-2021.crt", import.meta.url));
  const certificate = new X509Certificate(bytes);

  assert.throws(() => validateSupabaseRootCertificate(bytes, {
    expectedFileSha256: sha256(bytes),
    expectedRawSha256: "0".repeat(64),
  }), /CA_FINGERPRINT_MISMATCH/u);

  const nonCaRaw = Buffer.from(certificate.raw);
  const basicConstraints = Buffer.from([0x30, 0x03, 0x01, 0x01, 0xff]);
  const basicConstraintsIndex = nonCaRaw.indexOf(basicConstraints);
  assert.notEqual(basicConstraintsIndex, -1);
  nonCaRaw[basicConstraintsIndex + basicConstraints.length - 1] = 0x00;
  assert.throws(() => validateMutatedCertificate(pemFromRaw(nonCaRaw)), /CA_NOT_CA/u);

  const badSignatureRaw = Buffer.from(certificate.raw);
  badSignatureRaw[badSignatureRaw.length - 1] ^= 0x01;
  assert.throws(() => validateMutatedCertificate(pemFromRaw(badSignatureRaw)), /CA_BAD_SIGNATURE/u);

  const validFrom = certificate.validFromDate.getTime();
  const validTo = certificate.validToDate.getTime();
  assert.equal(validateSupabaseRootCertificate(bytes, { now: validFrom }), bytes.toString("utf8"));
  assert.equal(validateSupabaseRootCertificate(bytes, { now: validTo }), bytes.toString("utf8"));
  assert.throws(() => validateSupabaseRootCertificate(bytes, { now: validFrom - 1 }), /CA_NOT_YET_VALID/u);
  assert.throws(() => validateSupabaseRootCertificate(bytes, { now: validTo + 1 }), /CA_EXPIRED/u);
});

test("an appended CA expands Node trust in a hostile loopback but the gate rejects it", async () => {
  const pinned = supabaseRootCertificate();
  const fixture = await generateHostileTlsFixture();
  try {
    const expandedTrust = pinned + fixture.ca;
    assert.equal(await authorizeHostileLoopback({ ...fixture, ca: expandedTrust }), true);
    await assert.rejects(
      () => authorizeHostileLoopback({ ...fixture, ca: expandedTrust }, "wrong-host.invalid"),
      /altname|hostname/iu,
    );
    assert.throws(() => validateSupabaseRootCertificate(Buffer.from(expandedTrust)), /CA_INVALID|CA_FILE_MISMATCH/u);
  } finally {
    await fixture.dispose();
  }
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

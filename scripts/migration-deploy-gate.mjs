import { createHash, X509Certificate } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIRECTORY_SQL = /^supabase\/migrations\/.+\.sql$/u;
const MIGRATION_PATH = /^supabase\/migrations\/(\d{3}_[^/]+\.sql)$/u;
const URL_KEY = "SUPABASE_DB_URL";
const PRODUCTION_PROJECT_REF = "srtvmpcosekduvsscsyz";
const PRODUCTION_DIRECT_HOST = `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
const SUPABASE_POOLER_HOST = /^(?:[a-z0-9-]+\.)?pooler\.supabase\.com$/u;

/*
 * ── 신뢰 앵커 ────────────────────────────────────────────────────────────
 *
 * Supabase 는 **공개 CA 를 쓰지 않는다.** pooler 가 내미는 체인은 이렇게 끝난다:
 *
 *     *.pooler.supabase.com  ←  Supabase Intermediate 2021 CA  ←  Supabase Root 2021 CA
 *
 * 그 루트는 Node 신뢰 저장소에 없다. 그래서 `rejectUnauthorized: true` 만으로는
 * **원리적으로 통과할 수 없었다** — 관문이 «열릴 수 없는 자물쇠» 였다(#665).
 *
 * ★ 그렇다고 검증을 끄면 안 된다. 이 관문의 존재 이유가 「운영에 정말 올라갔는가」를
 *   **믿을 수 있게** 확인하는 것이다. 검증을 끄면 중간자가 「올라갔다」고 거짓말할 수 있고,
 *   그러면 관문이 있으나 마나다. 그래서 루트를 박아 두고 검증은 켠 채로 둔다.
 *
 * ★ 파일이 바뀌면 «조용히» 다른 것을 믿게 된다. 그래서 지문을 같이 박는다.
 *   누가 .crt 를 갈아끼우면 여기서 fail-closed 된다.
 */
const SUPABASE_ROOT_CA_FILE = "supabase-prod-ca-2021.crt";
/** 저장소에 번들된 파일 전체의 SHA-256. PEM 뒤에 다른 신뢰 앵커를 붙이는 것도 거부한다. */
const SUPABASE_ROOT_CA_FILE_SHA256 =
  "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
/** `X509Certificate.raw` SHA-256 — Supabase Root 2021 CA (2031-04-26 만료). */
const SUPABASE_ROOT_CA_SHA256 =
  "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa";

let cachedRootCa;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeSingleCertificatePem(bytes) {
  if (!Buffer.isBuffer(bytes)) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_INVALID: ${SUPABASE_ROOT_CA_FILE} must be raw bytes`);
  }
  const pem = bytes.toString("utf8");
  if (!Buffer.from(pem, "utf8").equals(bytes)) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_INVALID: ${SUPABASE_ROOT_CA_FILE} is not UTF-8`);
  }
  const match = pem.match(/^-----BEGIN CERTIFICATE-----\n([A-Za-z0-9+/=\n]+)-----END CERTIFICATE-----\n$/u);
  if (!match) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_INVALID: ${SUPABASE_ROOT_CA_FILE} must contain exactly one certificate PEM`);
  }
  const lines = match[1].split("\n");
  const finalEmpty = lines.pop();
  if (finalEmpty !== "" || lines.length === 0 || lines.some((line, index) =>
    line.length === 0 || line.length > 64 || (index < lines.length - 1 && line.length !== 64))) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_INVALID: ${SUPABASE_ROOT_CA_FILE} has non-canonical PEM wrapping`);
  }
  const base64 = lines.join("");
  const raw = Buffer.from(base64, "base64");
  if (raw.length === 0 || raw.toString("base64") !== base64) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_INVALID: ${SUPABASE_ROOT_CA_FILE} has malformed base64`);
  }
  return { pem, raw };
}

export function validateSupabaseRootCertificate(
  bytes,
  {
    expectedFileSha256 = SUPABASE_ROOT_CA_FILE_SHA256,
    expectedRawSha256 = SUPABASE_ROOT_CA_SHA256,
    now = Date.now(),
  } = {},
) {
  const { pem, raw } = decodeSingleCertificatePem(bytes);
  const fileDigest = sha256(bytes);
  if (fileDigest !== expectedFileSha256) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_FILE_MISMATCH: ${fileDigest}`);
  }

  let certificate;
  try {
    certificate = new X509Certificate(raw);
  } catch {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_INVALID: ${SUPABASE_ROOT_CA_FILE} is not X.509`);
  }
  const rawDigest = sha256(certificate.raw);
  if (rawDigest !== expectedRawSha256) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_FINGERPRINT_MISMATCH: ${rawDigest}`);
  }
  if (certificate.ca !== true) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_NOT_CA: ${SUPABASE_ROOT_CA_FILE}`);
  }
  if (certificate.subject !== certificate.issuer || !certificate.checkIssued(certificate)) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_NOT_SELF_ISSUED: ${SUPABASE_ROOT_CA_FILE}`);
  }
  if (!certificate.verify(certificate.publicKey)) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_BAD_SIGNATURE: ${SUPABASE_ROOT_CA_FILE}`);
  }
  const validFrom = certificate.validFromDate.getTime();
  const validTo = certificate.validToDate.getTime();
  if (!Number.isFinite(now) || !Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_NOT_YET_VALID: ${SUPABASE_ROOT_CA_FILE}`);
  }
  if (now > validTo) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_EXPIRED: ${SUPABASE_ROOT_CA_FILE}`);
  }
  return pem;
}

export function supabaseRootCertificate() {
  if (cachedRootCa !== undefined) return cachedRootCa;
  const path = join(dirname(fileURLToPath(import.meta.url)), SUPABASE_ROOT_CA_FILE);
  if (!existsSync(path)) {
    throw new Error(`MIGRATION_DEPLOY_GATE_CA_MISSING: ${SUPABASE_ROOT_CA_FILE}`);
  }
  cachedRootCa = validateSupabaseRootCertificate(readFileSync(path));
  return cachedRootCa;
}

export function collectAddedMigrations(files) {
  const migrations = [];
  for (const file of Array.isArray(files) ? files : []) {
    const path = String(file?.filename ?? "").replaceAll("\\", "/");
    if (!MIGRATION_DIRECTORY_SQL.test(path)) continue;
    const match = path.match(MIGRATION_PATH);
    if (!match) throw new Error(`MIGRATION_DEPLOY_GATE_INVALID_FILE_NAME: ${path}`);
    if (file?.status !== "added") throw new Error(`MIGRATION_DEPLOY_GATE_EXISTING_FILE_CHANGED: ${path}`);
    migrations.push({ path, fileName: match[1] });
  }
  return migrations.sort((a, b) => a.path.localeCompare(b.path));
}

export function validateHostedRows(migrations, rows) {
  const byKey = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = String(row?.logicalKey ?? "");
    if (byKey.has(key)) throw new Error(`MIGRATION_DEPLOY_GATE_DUPLICATE_GUARD: ${key}`);
    byKey.set(key, row);
  }
  for (const migration of migrations) {
    const row = byKey.get(migration.logicalKey);
    if (!row) throw new Error(`MIGRATION_DEPLOY_GATE_NOT_APPLIED: ${migration.logicalKey}`);
    if (row.fileName !== migration.fileName || row.fileDigest !== migration.digest) {
      throw new Error(`MIGRATION_DEPLOY_GATE_IDENTITY_MISMATCH: ${migration.logicalKey}`);
    }
  }
  return { ok: true, verified: migrations.map(({ logicalKey, fileName, digest }) => ({ logicalKey, fileName, digest })) };
}

export function readLocalConnectionString(cwd) {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0 || trimmed.slice(0, eq).trim() !== URL_KEY) continue;
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (value) return { value, source: name };
    }
  }
  throw new Error("MIGRATION_DEPLOY_GATE_CREDENTIAL_MISSING: local .env.local/.env only; CI credentials are forbidden");
}

export function assertProductionConnectionTarget(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("MIGRATION_DEPLOY_GATE_PROJECT_IDENTITY_MISMATCH: database URL is invalid");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("MIGRATION_DEPLOY_GATE_PROJECT_IDENTITY_MISMATCH: PostgreSQL URL required");
  }
  if (url.search || url.hash) {
    throw new Error("MIGRATION_DEPLOY_GATE_CONNECTION_OPTIONS_FORBIDDEN: URL query/fragment options are not allowed");
  }
  const hostname = url.hostname.toLowerCase();
  let username;
  let password;
  let database;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  } catch {
    throw new Error("MIGRATION_DEPLOY_GATE_PROJECT_IDENTITY_MISMATCH: database credential encoding is invalid");
  }
  const direct = hostname === PRODUCTION_DIRECT_HOST && username === "postgres";
  const pooler = SUPABASE_POOLER_HOST.test(hostname) && username === `postgres.${PRODUCTION_PROJECT_REF}`;
  const port = url.port ? Number(url.port) : 5432;
  const validPort = direct ? port === 5432 : port === 5432 || port === 6543;
  if ((!direct && !pooler) || !validPort || database !== "postgres" || !password) {
    throw new Error(`MIGRATION_DEPLOY_GATE_PROJECT_IDENTITY_MISMATCH: expected production project ${PRODUCTION_PROJECT_REF}`);
  }
  return {
    projectRef: PRODUCTION_PROJECT_REF,
    transport: direct ? "direct" : "pooler",
    host: hostname,
    port,
    user: username,
    password,
    database,
  };
}

export function productionClientConfig(connectionString) {
  const target = assertProductionConnectionTarget(connectionString);
  return {
    host: target.host,
    port: target.port,
    user: target.user,
    password: target.password,
    database: target.database,
    ssl: { rejectUnauthorized: true, ca: supabaseRootCertificate() },
    application_name: "moawork-merge-migration-gate",
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  };
}

function redact(error, secrets) {
  let message = String(error?.message ?? error ?? "unknown database failure");
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join("<redacted>");
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "<redacted-connection-string>");
}

export async function queryHostedGuard(migrations, { cwd = process.cwd(), clientFactory } = {}) {
  if (migrations.length === 0) return [];
  const connection = readLocalConnectionString(cwd);
  const clientConfig = productionClientConfig(connection.value);
  let client;
  try {
    if (clientFactory) client = await clientFactory(clientConfig);
    else {
      const pg = (await import("pg")).default;
      client = new pg.Client(clientConfig);
    }
    await client.connect();
    const result = await client.query(
      `select logical_key as "logicalKey", file_name as "fileName", file_digest as "fileDigest"
         from public.migration_apply_guard
        where logical_key = any($1::text[])`,
      [migrations.map((migration) => migration.logicalKey)],
    );
    return result.rows;
  } catch (error) {
    throw new Error(`MIGRATION_DEPLOY_GATE_QUERY_FAILED: ${redact(error, [connection.value, clientConfig.password])}`);
  } finally {
    await client?.end?.().catch(() => {});
  }
}

export async function verifyHostedMigrations(migrations, options = {}) {
  return validateHostedRows(migrations, await queryHostedGuard(migrations, options));
}

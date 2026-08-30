import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_DIRECTORY_SQL = /^supabase\/migrations\/.+\.sql$/u;
const MIGRATION_PATH = /^supabase\/migrations\/(\d{3}_[^/]+\.sql)$/u;
const URL_KEY = "SUPABASE_DB_URL";
const PRODUCTION_PROJECT_REF = "srtvmpcosekduvsscsyz";
const PRODUCTION_DIRECT_HOST = `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
const SUPABASE_POOLER_HOST = /^(?:[a-z0-9-]+\.)?pooler\.supabase\.com$/u;

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
    ssl: { rejectUnauthorized: true },
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

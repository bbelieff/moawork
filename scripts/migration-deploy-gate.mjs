import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATION_DIRECTORY_SQL = /^supabase\/migrations\/.+\.sql$/u;
const MIGRATION_PATH = /^supabase\/migrations\/(\d{3}_[^/]+\.sql)$/u;
const URL_KEY = "SUPABASE_DB_URL";

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

function redact(error, secret) {
  return String(error?.message ?? error ?? "unknown database failure")
    .split(secret).join("<SUPABASE_DB_URL>")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/giu, "<redacted-connection-string>");
}

export async function queryHostedGuard(migrations, { cwd = process.cwd(), clientFactory } = {}) {
  if (migrations.length === 0) return [];
  const connection = readLocalConnectionString(cwd);
  let client;
  try {
    if (clientFactory) client = await clientFactory(connection.value);
    else {
      const pg = (await import("pg")).default;
      client = new pg.Client({
        connectionString: connection.value,
        ssl: { rejectUnauthorized: false },
        application_name: "moawork-merge-migration-gate",
        connectionTimeoutMillis: 10_000,
        query_timeout: 15_000,
      });
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
    throw new Error(`MIGRATION_DEPLOY_GATE_QUERY_FAILED: ${redact(error, connection.value)}`);
  } finally {
    await client?.end?.().catch(() => {});
  }
}

export async function verifyHostedMigrations(migrations, options = {}) {
  return validateHostedRows(migrations, await queryHostedGuard(migrations, options));
}

import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = /^-- moa-migration-guard: logical_key=(\S+) predecessor=(\S+) digest=([0-9a-f]{64}) foundation=(true|false)(?: bridge_repo_predecessor=(\S+))?$/mu;
const DIGEST_ARGUMENT = /((?:p_file_digest\s*=>|v_file_digest\s+constant\s+text\s*:=)\s*')[0-9a-f]{64}(')/u;

function namedText(sql, name) {
  return sql.match(new RegExp(`${name}\\s*=>\\s*'([^']+)'`, "u"))?.[1];
}

export function canonicalMigrationSql(sql) {
  return sql
    .replace(/(digest=)[0-9a-f]{64}/u, "$1<canonical>")
    .replace(DIGEST_ARGUMENT, "$1<canonical>$2")
    .replace(/\r\n/gu, "\n");
}

export function migrationDigest(sql) {
  return createHash("sha256").update(canonicalMigrationSql(sql), "utf8").digest("hex");
}

export function inspectGuardedMigration(fileName, sql) {
  const marker = sql.match(MARKER);
  if (!marker) throw new Error(`${fileName}: missing migration guard marker`);
  const [, logicalKey, predecessor, declaredDigest, foundationText, bridgeRepoPredecessor = null] = marker;
  const expectedKey = basename(fileName, ".sql");
  if (logicalKey !== expectedKey) throw new Error(`${fileName}: logical key mismatch`);
  const guardCallCount = (sql.match(/select\s+public\.begin_guarded_migration\s*\(/giu) ?? []).length;
  if (bridgeRepoPredecessor ? guardCallCount !== 0 : guardCallCount !== 1) throw new Error(`${fileName}: guard call count is invalid`);
  if (bridgeRepoPredecessor && !/pg_advisory_xact_lock\(1297040711,\s*188\)/iu.test(sql)) throw new Error(`${fileName}: bridge must acquire migration lock`);
  if (bridgeRepoPredecessor && (sql.match(/insert\s+into\s+public\.migration_apply_guard/giu) ?? []).length !== 1) throw new Error(`${fileName}: bridge must insert exactly one canonical guard row`);
  if (bridgeRepoPredecessor) {
    const lockAt = sql.search(/pg_advisory_xact_lock\(1297040711,\s*188\)/iu);
    const insertAt = sql.search(/insert\s+into\s+public\.migration_apply_guard/iu);
    if (lockAt < 0 || insertAt < 0 || lockAt > insertAt) throw new Error(`${fileName}: bridge lock must precede its guard mutation`);
    if (!new RegExp(`v_logical_key\\s+constant\\s+text\\s*:=\\s*'${logicalKey}'`, "u").test(sql)) throw new Error(`${fileName}: bridge logical key is not bound to marker`);
    if (!new RegExp(`v_file_name\\s+constant\\s+text\\s*:=\\s*'${fileName}'`, "u").test(sql)) throw new Error(`${fileName}: bridge file name is not bound to marker`);
    const predecessorChoice = new RegExp(`values\\s*\\(\\s*v_logical_key,\\s*v_file_name,\\s*v_file_digest,\\s*case\\s+when\\s+v_repo_ok\\s+then\\s+'${bridgeRepoPredecessor}'\\s+else\\s+'${predecessor}'\\s+end`, "isu");
    if (!predecessorChoice.test(sql)) throw new Error(`${fileName}: bridge insert metadata is not structurally bound`);
  }
  if (!bridgeRepoPredecessor && namedText(sql, "p_logical_key") !== logicalKey) throw new Error(`${fileName}: guard logical key argument mismatch`);
  if (!bridgeRepoPredecessor && namedText(sql, "p_file_name") !== fileName) throw new Error(`${fileName}: guard file name argument mismatch`);
  if (!bridgeRepoPredecessor && namedText(sql, "p_expected_predecessor") !== predecessor) throw new Error(`${fileName}: guard predecessor argument mismatch`);
  const digestArgument = sql.match(DIGEST_ARGUMENT)?.[0].match(/[0-9a-f]{64}/u)?.[0];
  if (digestArgument !== declaredDigest) throw new Error(`${fileName}: digest argument mismatch`);
  const actualDigest = migrationDigest(sql);
  if (actualDigest !== declaredDigest) throw new Error(`${fileName}: digest mismatch; expected ${actualDigest}`);
  const foundation = foundationText === "true";
  if (!foundation) {
    const markerEnd = sql.indexOf("\n") + 1;
    const guardStart = bridgeRepoPredecessor ? sql.search(/do\s+\$bridge\$/iu) : sql.search(/select\s+public\.begin_guarded_migration\s*\(/iu);
    if (sql.slice(markerEnd, guardStart).trim() !== "") throw new Error(`${fileName}: guard call must precede migration body`);
    if (!bridgeRepoPredecessor && !/p_foundation\s*=>\s*false/iu.test(sql)) throw new Error(`${fileName}: future migration cannot claim foundation`);
  } else if (!/select\s+pg_advisory_xact_lock\(1297040711,\s*188\)/iu.test(sql.slice(0, sql.indexOf("create table")))) {
    throw new Error(`${fileName}: foundation must lock before DDL`);
  }
  if (foundation && bridgeRepoPredecessor) throw new Error(`${fileName}: foundation cannot be a frontier bridge`);
  return { fileName, logicalKey, predecessor, digest: actualDigest, foundation, bridgeRepoPredecessor };
}

export async function inspectMigrationDirectory(directory) {
  const names = (await readdir(directory)).filter((name) => /^\d{3}_.+\.sql$/u.test(name)).sort();
  const guarded = [];
  let foundationIndex = -1;
  for (let index = 0; index < names.length; index += 1) {
    const sql = await readFile(join(directory, names[index]), "utf8");
    if (!MARKER.test(sql)) continue;
    const metadata = inspectGuardedMigration(names[index], sql);
    if (metadata.foundation) {
      if (foundationIndex !== -1) throw new Error("multiple migration guard foundations");
      foundationIndex = index;
    }
    guarded.push({ ...metadata, index });
  }
  if (foundationIndex === -1) throw new Error("migration guard foundation missing");
  let bridgeCount = 0;
  for (let index = foundationIndex + 1; index < names.length; index += 1) {
    const metadata = guarded.find((entry) => entry.index === index);
    if (!metadata) throw new Error(`${names[index]}: missing mandatory migration guard`);
    const expectedPredecessor = basename(names[index - 1], ".sql");
    if (metadata.bridgeRepoPredecessor) {
      bridgeCount += 1;
      if (metadata.bridgeRepoPredecessor !== expectedPredecessor) throw new Error(`${names[index]}: bridge repository predecessor gap`);
      if (metadata.predecessor === expectedPredecessor) throw new Error(`${names[index]}: bridge must join a distinct hosted predecessor`);
      const keyNumber = Number.parseInt(metadata.logicalKey.slice(0, 3), 10);
      const repoNumber = Number.parseInt(metadata.bridgeRepoPredecessor.slice(0, 3), 10);
      const hostedNumber = Number.parseInt(metadata.predecessor.slice(0, 3), 10);
      if (keyNumber !== repoNumber + 1 || hostedNumber !== repoNumber) throw new Error(`${names[index]}: bridge must join same-number frontiers at the next key`);
    } else if (metadata.predecessor !== expectedPredecessor) {
      throw new Error(`${names[index]}: predecessor gap`);
    }
    if (metadata.foundation) throw new Error(`${names[index]}: only the first guarded migration may be foundation`);
  }
  if (bridgeCount > 1) throw new Error("multiple migration frontier bridges");
  const foundation = guarded.find((entry) => entry.index === foundationIndex);
  const baseline = foundationIndex > 0 ? basename(names[foundationIndex - 1], ".sql") : null;
  if (foundation.predecessor !== baseline) throw new Error(`${foundation.fileName}: foundation predecessor gap`);
  return { names, guarded, foundation };
}

export async function writeDigest(filePath) {
  const sql = await readFile(filePath, "utf8");
  const digest = migrationDigest(sql);
  const updated = sql
    .replace(/(digest=)[0-9a-f]{64}/u, `$1${digest}`)
    .replace(DIGEST_ARGUMENT, `$1${digest}$2`);
  await writeFile(filePath, updated, "utf8");
  return digest;
}

async function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (process.argv[2] === "--write") {
    const target = resolve(process.argv[3] ?? "");
    if (!target.startsWith(join(root, "supabase", "migrations"))) throw new Error("digest target must be a migration");
    console.log(await writeDigest(target));
    return;
  }
  const result = await inspectMigrationDirectory(join(root, "supabase", "migrations"));
  console.log(`migration guard: ${result.guarded.length} guarded migration(s); foundation ${result.foundation.fileName}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

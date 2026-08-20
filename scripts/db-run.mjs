#!/usr/bin/env node
/**
 * 운영 DB 직접 실행기 — 마이그레이션 적용과 조회를 터미널에서 한다.
 *
 * 접속 문자열은 «파일에서만» 온다. 인자로 받지 않는다 — 셸 히스토리에 남기지 않기 위해서다.
 *   .env 또는 .env.local 의 SUPABASE_DB_URL
 *
 * 사용법
 *   node scripts/db-run.mjs --whoami                  현재 접속 역할·DB 확인
 *   node scripts/db-run.mjs --file supabase/migrations/103_....sql
 *   node scripts/db-run.mjs --sql "select 1"
 *   node scripts/db-run.mjs --ledger                  가드 원장 조회
 *
 * ★ 이 스크립트는 접속 문자열을 절대 출력하지 않는다. 오류 메시지에서도 지운다.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

const ENV_FILES = [".env.local", ".env"];
const URL_KEY = "SUPABASE_DB_URL";

function readConnectionString() {
  for (const name of ENV_FILES) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      if (trimmed.slice(0, eq).trim() !== URL_KEY) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return { value, source: name };
    }
  }
  return null;
}

/** 접속 문자열이 어떤 경로로든 화면에 새지 않게 지운다. */
function redact(text, secret) {
  if (!text) return text;
  let out = String(text);
  if (secret) out = out.split(secret).join("<SUPABASE_DB_URL>");
  return out.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "<redacted-connection-string>");
}

function parseArgs(argv) {
  const args = { mode: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--whoami") args.mode = "whoami";
    else if (arg === "--ledger") args.mode = "ledger";
    else if (arg === "--file") {
      args.mode = "file";
      args.target = argv[i + 1];
      i += 1;
    } else if (arg === "--sql") {
      args.mode = "sql";
      args.target = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

const LEDGER_SQL =
  "select logical_key, file_name, applied_at from public.migration_apply_guard order by applied_at";

function statementFor(args) {
  if (args.mode === "whoami") {
    return "select current_user, current_database(), version()";
  }
  if (args.mode === "ledger") return LEDGER_SQL;
  if (args.mode === "sql") return args.target;
  return readFileSync(resolve(process.cwd(), args.target), "utf8");
}

function printResult(result) {
  const results = Array.isArray(result) ? result : [result];
  for (const one of results) {
    if (!one) continue;
    if (one.rows && one.rows.length > 0) {
      console.table(one.rows);
    } else {
      console.log(`${one.command ?? "OK"} — rows: ${one.rowCount ?? 0}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.mode) {
    console.error("사용법: --whoami | --ledger | --file <path.sql> | --sql \"<query>\"");
    process.exit(2);
  }
  if ((args.mode === "file" || args.mode === "sql") && !args.target) {
    console.error(`${args.mode} 인자가 비었습니다.`);
    process.exit(2);
  }

  const conn = readConnectionString();
  if (!conn) {
    console.error(
      `${URL_KEY} 가 없습니다. .env 또는 .env.local 에 다음 한 줄을 넣어 주세요:\n` +
        `  ${URL_KEY}=postgresql://...\n` +
        `(.env 는 .gitignore 에 잡혀 있어 저장소에 올라가지 않습니다.)`,
    );
    process.exit(2);
  }

  let statement;
  try {
    statement = statementFor(args);
  } catch (error) {
    console.error(redact(error.message, conn.value));
    process.exit(2);
  }

  const client = new pg.Client({
    connectionString: conn.value,
    ssl: { rejectUnauthorized: false },
    application_name: "moawork-db-run",
  });

  try {
    await client.connect();
    console.log(`접속됨 (${conn.source} 의 ${URL_KEY} 사용)`);
    const result = await client.query(statement);
    printResult(result);
  } catch (error) {
    console.error("실패:", redact(error.message, conn.value));
    if (error.code) console.error("  코드:", error.code);
    if (error.detail) console.error("  상세:", redact(error.detail, conn.value));
    if (error.hint) console.error("  힌트:", redact(error.hint, conn.value));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

main();

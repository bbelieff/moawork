#!/usr/bin/env node
/**
 * pgcrypto 를 «스키마 없이» 부르는 SECURITY DEFINER 함수를 막는다. (#653)
 *
 * ## 왜 이 검사가 있나
 *
 * 이 프로젝트의 pgcrypto 는 `public` 이 아니라 **`extensions`** 스키마에 설치돼 있다(Supabase 기본).
 * 그런데 함수를 `security definer ... set search_path = public, pg_temp` 로 만들면
 * 그 안에서 `digest(...)` 를 스키마 없이 부를 때 이름이 안 풀린다.
 *
 *     function digest(text, unknown) does not exist        SQLSTATE 42883
 *
 * ## 왜 아무도 못 알아챘나 — 이게 이 검사가 존재하는 이유다
 *
 * **PGlite 시험은 pgcrypto 를 `public` 에 설치한다.** 로컬에서는 `digest` 가 그냥 풀린다.
 * 그래서 시험 3,497개가 전부 초록인데 운영에서는 100% 실패했다.
 * 2026-08-31 실측: `board_columns` 398개인데 `board_column_command_receipts` 0건 —
 * 보드 컬럼 명령이 «한 번도» 커밋된 적이 없었다.
 *
 * **로컬과 운영의 «스키마 배치» 가 다른 종류의 결함은 시험으로 잡히지 않는다.**
 * 그래서 시험이 아니라 «글자» 로 잡는다.
 *
 * ## 무엇을 FAIL 로 보나
 *
 * `create [or replace] function` 블록이 셋을 «동시에» 만족하면 FAIL:
 *   ① security definer 다
 *   ② search_path 에 extensions 가 없다
 *   ③ 본문에서 pgcrypto 함수를 스키마 없이 부른다
 *
 * 고치는 법은 둘 중 하나다.
 *   · `set search_path = public, extensions, pg_temp`  ← 141 이 쓴 방법
 *   · 호출부를 `extensions.digest(...)` 로 스키마까지 적기
 *
 * 사용법
 *   node scripts/check-pgcrypto-search-path.mjs --self-test
 *   node scripts/check-pgcrypto-search-path.mjs
 */
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** pgcrypto 가 심는 것 중 이 저장소가 실제로 쓰거나 쓸 만한 것들. */
const PGCRYPTO_FUNCTIONS = ["digest", "crypt", "gen_salt", "hmac", "gen_random_bytes", "pgp_sym_encrypt", "pgp_sym_decrypt"];

/** 앞에 `.` 이나 식별자 글자가 없어야 «스키마 없이» 부른 것이다 — `extensions.digest` 는 걸리지 않는다. */
const BARE_CALL = new RegExp(String.raw`(^|[^.\w])(${PGCRYPTO_FUNCTIONS.join("|")})\s*\(`, "iu");

/** `create [or replace] function` 부터 그 정의가 닫히는 `$…$;` 까지를 한 덩어리로 자른다. */
export function splitFunctionBlocks(sql) {
  const blocks = [];
  const opener = /create\s+(?:or\s+replace\s+)?function\s/giu;
  let match;
  while ((match = opener.exec(sql)) !== null) {
    const start = match.index;
    // 본문을 감싸는 달러 인용부호를 찾는다 ($$ 또는 $function$ 등).
    const tag = sql.slice(start).match(/\$([A-Za-z_]\w*)?\$/u);
    if (!tag) continue;
    const bodyStart = start + tag.index + tag[0].length;
    const closeAt = sql.indexOf(tag[0], bodyStart);
    const end = closeAt < 0 ? sql.length : closeAt + tag[0].length;
    blocks.push({ start, text: sql.slice(start, end) });
    opener.lastIndex = end;
  }
  return blocks;
}

/** `-- 주석` 과 문자열 리터럴을 지운다. 주석 속의 `digest(` 를 결함으로 세지 않기 위해서다. */
function withoutCommentary(text) {
  return text.replace(/--[^\n]*/gu, " ").replace(/'[^']*'/gu, "''");
}

/** 반환: `{ key, message }` 목록. key 는 baseline 이 무엇을 이미 아는지 대조하는 이름표다. */
export function inspectSql(fileName, sql) {
  const problems = [];
  for (const block of splitFunctionBlocks(sql)) {
    const head = block.text.slice(0, block.text.indexOf("$"));
    if (!/security\s+definer/iu.test(head)) continue;

    const searchPath = head.match(/set\s+search_path\s*(?:=|to)\s*([^\n;]*)/iu)?.[1] ?? "";
    if (/\bextensions\b/iu.test(searchPath)) continue;

    const body = withoutCommentary(block.text.slice(block.text.indexOf("$")));
    const bare = body.match(BARE_CALL);
    if (!bare) continue;

    const name = head.match(/function\s+([\w.]+)/iu)?.[1] ?? "(이름 불명)";
    const line = sql.slice(0, block.start).split("\n").length;
    problems.push({
      key: `${fileName}::${name}`,
      message:
        `${fileName}:${line} ${name} — security definer 인데 search_path 에 extensions 가 없고 ` +
        `«${bare[2]}(» 를 스키마 없이 부릅니다. 운영에서 42883 으로 죽습니다. ` +
        `search_path 에 extensions 를 넣거나 extensions.${bare[2]}(...) 로 적으세요.`,
    });
  }
  return problems;
}

const GOOD = `
create or replace function public.ok_one(p uuid) returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin return encode(digest(p::text, 'sha256'), 'hex'); end $$;

create or replace function public.ok_two(p uuid) returns text
language plpgsql security definer set search_path = '' as $$
begin return encode(extensions.digest(p::text, 'sha256'), 'hex'); end $$;

-- security definer 가 아니면 호출자의 search_path 를 쓴다 — 이 검사의 대상이 아니다.
create or replace function public.ok_three(p uuid) returns text
language plpgsql set search_path = public, pg_temp as $$
begin return encode(digest(p::text, 'sha256'), 'hex'); end $$;

-- 주석 안의 digest( 는 결함이 아니다.
create or replace function public.ok_four(p uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 예전에는 digest( 를 여기서 불렀다
  return p::text;
end $$;
`;

const BAD = `
create or replace function public.bad_one(p uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin return encode(digest(p::text, 'sha256'), 'hex'); end $$;
`;

function selfTest() {
  const clean = inspectSql("good.sql", GOOD);
  if (clean.length !== 0) throw new Error(`self-test: 멀쩡한 함수를 잡았습니다 — ${clean.map((p) => p.key).join(" / ")}`);
  const caught = inspectSql("bad.sql", BAD);
  if (caught.length !== 1) throw new Error(`self-test: 결함을 못 잡았습니다 (잡은 수 ${caught.length})`);
  if (!caught[0].key.endsWith("::public.bad_one")) throw new Error("self-test: 잡았는데 어느 함수인지 못 말합니다");
  if (!caught[0].message.includes("42883")) throw new Error("self-test: 무엇이 일어나는지 말하지 않습니다");
  console.log("pgcrypto search_path 자체검사: 통과 (멀쩡한 4개 통과 · 결함 1개 적발)");
}

async function main() {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  if (process.argv[2] === "--self-test") {
    selfTest();
    return;
  }
  const dir = join(root, "supabase", "migrations");
  const names = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const problems = [];
  for (const name of names) {
    problems.push(...inspectSql(`supabase/migrations/${name}`, await readFile(join(dir, name), "utf8")));
  }

  /*
   * ★ baseline 은 «이미 알고 있고 141 이 덮는다» 는 뜻이다.
   *   마이그레이션은 고쳐 쓰지 않으므로(AGENTS.md §9.1) 옛 파일의 글자는 영원히 남는다.
   *   살아 있는 DB 는 141 의 alter function 이 고친다. 그러니 옛 글자로 게이트를 빨갛게
   *   두면 아무도 못 고치는 빨간불이 되고, 그러면 이 검사 자체가 꺼진다.
   *   여기 «없는» 새 항목만 막는다 — 이 게이트가 지키는 것은 과거가 아니라 다음 사람이다.
   */
  const baseline = JSON.parse(await readFile(join(root, "scripts", "pgcrypto-search-path-baseline.json"), "utf8"));
  const known = new Set(baseline.known);
  const fresh = problems.filter((problem) => !known.has(problem.key));
  const seen = new Set(problems.map((problem) => problem.key));
  const stale = [...known].filter((key) => !seen.has(key));

  if (fresh.length > 0) {
    console.error(`pgcrypto search_path: 새로 생긴 ${fresh.length}건`);
    fresh.forEach((problem) => console.error(`  - ${problem.message}`));
    console.error("\n  #653 과 같은 함정입니다. 085_workspace_join_digest_schema.sql 이 이미 한 번 고쳤는데");
    console.error("  089·115·118 이 다시 팠습니다. 고치는 법: search_path 에 extensions 를 넣거나 호출을 스키마까지 적기.");
    process.exitCode = 1;
    return;
  }
  if (stale.length > 0) {
    // 목록은 «줄어들기만» 해야 한다. 사라진 항목이 남아 있으면 baseline 이 사실과 어긋난다.
    console.error(`pgcrypto search_path: baseline 에 «이제 없는» 항목 ${stale.length}건 — 지워 주세요`);
    stale.forEach((key) => console.error(`  - ${key}`));
    process.exitCode = 1;
    return;
  }
  console.log(
    `pgcrypto search_path: 마이그레이션 ${names.length}개 확인 — 새로 생긴 것 없음 (알려진 ${known.size}건은 ${baseline.fixedBy} 가 덮음)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

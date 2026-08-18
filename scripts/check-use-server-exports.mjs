#!/usr/bin/env node
// check-use-server-exports.mjs — "use server" 파일이 async 함수 «외의 것» 을 export 하는지 센다.
//
// ── 왜 이 검사기가 있나 ────────────────────────────────────────────────
// Next 는 `"use server"` 파일의 모든 export 가 async 함수이기를 요구한다. 어기면
// 그 페이지의 «서버 액션 로더 모듈» 이 평가 단계에서 통째로 죽는다:
//
//     A "use server" file can only export async functions, found object.
//
// 그러면 그 페이지의 **액션이 전부** 시작조차 못 하고 전면 오류 화면이 된다.
// GET 렌더는 그 모듈을 안 타므로 «새로고침하면 멀쩡» 해 보인다 — 그래서 더 헷갈린다.
//
// ★★ 기존 게이트가 이것을 못 잡는다. 추측이 아니라 실측이다(2026-08-18):
//
//     export class …        → next build 가 «잡는다»
//     export const { … }    → next build 가 «통과»    ← 같은 규칙 위반인데 놓친다
//
//   그리고 두 형태 모두 `tsc --noEmit` 과 vitest 는 통과한다. 타입 규칙이 아니라
//   프레임워크 규칙이라서다. 즉 **dev 런타임에서 그 액션을 실제로 눌렀을 때만** 드러난다.
//   화면이 200 이고 배너가 0 이어도 눌러 보기 전에는 모른다.
//
// 실제로 이 함정을 «주석으로» 적어 둔 파일(lib/boards/boardActionFlash.ts, BBE-201)의
// 두 칸 옆 파일이 그것을 밟고 있었다. 주석은 그 파일을 여는 사람만 본다.
// 그래서 규칙을 «읽는 것» 이 아니라 «세는 것» 으로 바꾼다.
//
// ── 판정 원칙 ──────────────────────────────────────────────────────────
// 「모르면 빨간불」. 이 검사기가 형태를 확정하지 못한 export(재수출·default 등)는
// 통과가 아니라 «확인필요» 로 세고 종료코드 1 이다. 판정 불능을 통과로 접지 않는다.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_ROOT = join(REPO_ROOT, "app", "src");

/** CRLF 로 저장된 파일에서도 같은 결과가 나와야 한다. */
const normalize = (source) => source.split("\r\n").join("\n");

/**
 * 파일 «머리» 의 지시어만 파일 규칙으로 인정한다.
 * 함수 본문 안의 "use server" 는 그 함수 하나에만 걸리는 인라인 지시어라 대상이 아니다.
 */
export function isUseServerFile(source) {
  let head = normalize(source).replace(/^﻿/, "").trimStart();
  // ★ 선행 «주석» 도 벗긴다 (DC-16 검수 지적).
  //   JS 지시자 프롤로그는 주석 뒤에 와도 유효하다. 주석을 안 벗기면
  //   「// 설명」 한 줄이 붙은 파일이 «대상 집합에서 조용히 빠진다».
  //   그러면 이 검사기의 「위반 0」이 «깨끗하다» 가 아니라 «안 봤다» 가 된다.
  //   export 판정에서는 「판정 불능을 통과로 접지 마라」를 지켰는데
  //   파일 «분류» 에서만 놓쳤던 자리다.
  for (;;) {
    const before = head;
    head = head.replace(/^\/\*[\s\S]*?\*\//, "").replace(/^\/\/[^\n]*\n?/, "").trimStart();
    if (head === before) break;
  }
  return /^(["'])use server\1\s*;?/.test(head);
}

/**
 * "use server" 파일에서 규칙을 어기는 export 를 찾는다.
 * 반환: { kind: "violation" | "unknown", line }[]
 */
export function findBadExports(source) {
  const found = [];
  for (const raw of normalize(source).split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("export")) continue;

    // 허용 — 이것만이 "use server" 파일의 정상 export 다.
    if (/^export\s+async\s+function\s/.test(line)) continue;

    // 타입은 컴파일에서 지워지므로 런타임 export 가 아니다.
    if (/^export\s+(type|interface)\s/.test(line)) continue;
    if (/^export\s+type\s*\{/.test(line)) continue;

    // 값 export 인데 async 함수가 아니다 — 확정 위반.
    if (/^export\s+(const|let|var|class|enum)\s/.test(line)) {
      found.push({ kind: "violation", line });
      continue;
    }
    // async 가 빠진 함수 선언도 같은 위반이다.
    if (/^export\s+function\s/.test(line)) {
      found.push({ kind: "violation", line });
      continue;
    }

    // 여기부터는 이 줄만 보고 형태를 확정할 수 없다. 통과시키지 않는다.
    found.push({ kind: "unknown", line });
  }
  return found;
}

function listSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

function selfTest() {
  const cases = [
    ["파일 머리의 지시어를 인정한다", () => isUseServerFile('"use server";\nexport async function a() {}') === true],
    ["작은따옴표도 인정한다", () => isUseServerFile("'use server';\n") === true],
    ["CRLF 로 저장돼도 인정한다", () => isUseServerFile('"use server";\r\nexport async function a() {}\r\n') === true],
    ["지시어가 없으면 대상이 아니다", () => isUseServerFile("export const a = 1;\n") === false],
    [
      "함수 «안» 의 지시어는 파일 규칙이 아니다",
      () => isUseServerFile('export function f() {\n  "use server";\n}\n') === false,
    ],
    [
      "★ 줄주석이 먼저 와도 대상이다 (JS 프롤로그는 주석 뒤를 허용한다)",
      () => isUseServerFile('// 이 파일의 서버 액션들\n"use server";\n') === true,
    ],
    [
      "★ 블록주석이 먼저 와도 대상이다",
      () => isUseServerFile('/* 머리주석\n   여러 줄 */\n"use server";\n') === true,
    ],
    [
      "★★ 주석 «안» 에만 use server 가 있고 실제 지시자는 없으면 대상이 아니다",
      // 주석을 벗기게 만들면서 생긴 반대방향 위험이다 — 벗긴 뒤 판정하므로 false 여야 한다.
      () => isUseServerFile('// "use server" 를 쓰지 않는다\nexport const a = 1;\n') === false,
    ],
    [
      "★ 주석이 앞서도 위반을 찾는다 (분류와 탐지가 이어져 있는지)",
      () => {
        const src = '// 머리주석\n"use server";\nexport const A = 1;\n';
        return isUseServerFile(src) === true && findBadExports(src)[0]?.kind === "violation";
      },
    ],
    ["async 함수만 있으면 깨끗하다", () => findBadExports('"use server";\nexport async function a() {}').length === 0],
    [
      "const export 는 위반이다",
      () => {
        const found = findBadExports('"use server";\nexport const A = { ok: true };');
        return found.length === 1 && found[0].kind === "violation";
      },
    ],
    [
      "class export 는 위반이다",
      () => findBadExports('"use server";\nexport class E extends Error {}')[0]?.kind === "violation",
    ],
    [
      "async 가 빠진 함수도 위반이다",
      () => findBadExports('"use server";\nexport function f() {}')[0]?.kind === "violation",
    ],
    ["interface 는 지워지므로 위반이 아니다", () => findBadExports('"use server";\nexport interface S { ok: boolean }').length === 0],
    ["type 별칭도 위반이 아니다", () => findBadExports('"use server";\nexport type S = { ok: boolean };').length === 0],
    [
      "★ 재수출은 «통과» 가 아니라 «확인필요» 다",
      () => findBadExports('"use server";\nexport { a } from "./x";')[0]?.kind === "unknown",
    ],
    [
      "★ default export 도 확인필요다",
      () => findBadExports('"use server";\nexport default foo;')[0]?.kind === "unknown",
    ],
    [
      "CRLF 파일에서도 위반을 찾는다",
      () => findBadExports('"use server";\r\nexport const A = 1;\r\n')[0]?.kind === "violation",
    ],
  ];

  let failed = 0;
  for (const [name, run] of cases) {
    let ok = false;
    try {
      ok = run() === true;
    } catch {
      ok = false;
    }
    if (!ok) {
      console.error(`  ✗ ${name}`);
      failed += 1;
    }
  }
  if (failed > 0) {
    console.error(`use-server export self-test: ${failed} failed`);
    process.exit(1);
  }
  console.log(`use-server export self-test: ${cases.length} passed`);
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const files = listSourceFiles(SCAN_ROOT);
  let serverFiles = 0;
  let violations = 0;
  let unknowns = 0;

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    if (!isUseServerFile(source)) continue;
    serverFiles += 1;

    const rel = relative(REPO_ROOT, file).split(sep).join("/");
    for (const { kind, line } of findBadExports(source)) {
      if (kind === "violation") violations += 1;
      else unknowns += 1;
      console.log(`${kind === "violation" ? "VIOLATION" : "UNKNOWN  "} ${rel}`);
      console.log(`          ${line}`);
    }
  }

  console.log(`use-server exports: ${serverFiles} file(s), ${violations} violation(s), ${unknowns} unknown(s)`);
  if (violations > 0 || unknowns > 0) {
    console.error('❌ "use server" 파일은 async 함수만 export 할 수 있다.');
    console.error("   상수·클래스·타입 짝은 순수 모듈로 옮겨라(예: boards/trash-action-state.ts).");
    console.error("   확인필요(UNKNOWN)도 실패다 — 판정 불능을 통과로 접지 않는다.");
    process.exit(1);
  }
}

main();

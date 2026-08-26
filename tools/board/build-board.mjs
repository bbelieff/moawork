#!/usr/bin/env node
/**
 * 모아워크 V6 관제판 — 정적 생성기
 *
 * 왜 필요한가:
 *   대시보드 원본은 Cowork 안에서만 돈다(window.cowork.callMcpTool 로 Linear 를 읽는다).
 *   그래서 belie 화면에만 뜨고 데탑·노트북 세션은 못 본다.
 *   이 스크립트는 같은 화면을 «파일 하나»로 구워서 레포에 넣는다.
 *   그러면 git pull 만 하면 어느 기기든, 어느 세션이든 같은 것을 본다.
 *
 * 설계 원칙 — 디자인은 한 곳에서만 관리한다:
 *   board.template.html 은 Cowork 판과 «같은 파일»이다. 렌더링 코드를 복사하지 않는다.
 *   대신 window.cowork.callMcpTool 을 «구워둔 데이터를 돌려주는 가짜»로 갈아끼운다.
 *   → 디자인을 고치면 템플릿만 바꾸면 되고, 두 판이 절대 갈라지지 않는다.
 *
 * 쓰는 법:
 *   gh auth login                              (토큰을 어디에도 적지 않는다)
 *   node tools/board/build-board.mjs
 *   → docs/dashboard/board.html  생성
 *
 * 언제 돌리나:
 *   세션이 착수/완주 도장을 남길 때 1회. 총괄은 배차 뒤 1회.
 *   자동 갱신이 아니다 — 파일 위쪽에 «언제 구운 판인지»가 찍힌다.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGithubReader } from "../github-issues.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, "board.template.html");
const OUT = resolve(HERE, "../../docs/dashboard/board.html");
const PROJECT = "MoaWork · 운영 안정화 및 어드민";

const github = createGithubReader();
if (!github.hasAuth()) {
  console.error(`
❌ GitHub 로그인을 찾지 못했다.

  1) gh auth login       (GitHub.com · HTTPS · 브라우저 로그인)
  2) 다시 실행

※ 토큰을 어디에 붙여 넣을 필요는 없다 — 이 도구가 gh 에게 직접 물어본다.
   그래서 레포에 키가 들어갈 자리 자체가 없다.
`);
  process.exit(1);
}

/* 2026-08-26 — 출처를 Linear 에서 GitHub Issues 로 옮겼다.
   Linear 는 READ_ONLY_ARCHIVE 라 카드가 거기서 더 안 움직인다 —
   구운 판이 «얼어붙은 스냅샷» 을 실시간인 척 담고 있었다.
   실시간 판(dashboard-server.mjs)과 «같은 모듈» 을 쓴다. 출처가 갈라지지 않는다. */
const issues = await github.listIssues();

console.log(`· 이슈 ${issues.length}건`);

// ── 2. 도장 (진행 중 카드의 코멘트만) ────────────────────
const DONE = ["Done", "Canceled", "Duplicate"];
const live = issues.filter((i) => !DONE.includes(i.status));

const comments = {};
let n = 0;
for (const i of live) {
  try {
    // 실시간 판과 «같은» 읽기다 — 최신 20개, 같은 정렬 규칙.
    const { comments: rows } = await github.listComments(i.id, 20, null);
    comments[i.id] = { comments: rows.map((c) => ({ body: c.body })) };
  } catch {
    comments[i.id] = { comments: [] };
  }
  if (++n % 10 === 0) process.stdout.write(`\r· 도장 ${n}/${live.length}`);
}
console.log(`\r· 도장 ${n}/${live.length} 읽음`);

// ── 3. 굽기 ─────────────────────────────────────────────
// 렌더링 코드는 손대지 않는다. callMcpTool 만 «구운 데이터를 주는 가짜»로 바꾼다.
const shim = `
<script>
/* ── 정적 판 · ${new Date().toISOString()} 구움 ──
   Cowork 판과 «같은 템플릿»이다. Linear 를 실시간으로 읽는 대신
   구워둔 응답을 돌려준다. 렌더링 코드는 한 줄도 다르지 않다. */
window.__BAKED__ = ${JSON.stringify({ issues, comments })};
window.__BAKED_AT__ = ${JSON.stringify(new Date().toISOString())};
window.cowork = {
  async callMcpTool(tool, args){
    const wrap = o => ({ isError:false, structuredContent:o, content:[{text:JSON.stringify(o)}] });
    if (tool.endsWith("list_issues")) {
      let out = window.__BAKED__.issues;
      if (args && args.state) out = out.filter(i => i.status === args.state);
      return wrap({ issues: out });
    }
    if (tool.endsWith("list_comments")) {
      return wrap(window.__BAKED__.comments[args.issueId] || { comments: [] });
    }
    return wrap({});
  }
};
</script>
<div style="max-width:1200px;margin:0 auto 4px;padding:9px 14px;border-radius:10px;
 background:#FEF6E7;border:1px solid #F6E0B8;color:#8A5A00;font:12px/1.5 -apple-system,Pretendard,sans-serif">
 <b>구워둔 판이다 — 실시간이 아니다.</b>
 <span id="bakedAt"></span> 기준.
 최신으로 보려면 <code style="background:#fff;padding:1px 5px;border-radius:4px">node tools/board/build-board.mjs</code> 를 다시 돌리고 커밋한다.
</div>
<script>
(function(){ const d=new Date(window.__BAKED_AT__);
  document.getElementById("bakedAt").textContent =
   d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")
   +" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
})();
</script>
`;

let html = readFileSync(TEMPLATE, "utf8");
if (!html.includes("<body>")) throw new Error("템플릿에 <body> 가 없다");
html = html.replace("<body>", "<body>" + shim);
html = html.replace(/<title>.*?<\/title>/, "<title>모아워크 V6 관제판 (구운 판)</title>");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, "utf8");

const done = issues.filter((i) => i.status === "Done").length;
console.log(`\n✓ ${OUT}`);
console.log(`  카드 ${issues.length} · 완주 ${done} · 진행 중 ${live.length}`);
console.log(`\n  다음: git add docs/dashboard/board.html && git commit && git push`);
console.log(`        다른 기기는 git pull 후 브라우저로 열면 같은 화면을 본다.`);

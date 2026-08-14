/* 관제판 실시간 서버 — node tools/dashboard-server.mjs
 *
 * 무엇을 하나
 *   tools/board/board.template.html 을 «그대로» 내보내되,
 *   window.cowork.callMcpTool 만 «Linear 를 지금 읽어오는 것» 으로 갈아끼운다.
 *
 * 왜 이 구조인가 (docs/design/관제판_표준규격_v1.md §9)
 *   Cowork 판 · 구운 판(build-board.mjs) · 이 실시간 판이 «같은 템플릿» 을 쓴다.
 *   갈아끼우는 것은 데이터 공급뿐이라 렌더링 코드가 한 줄도 갈라지지 않는다.
 *   디자인을 세 번 고치는 일이 없다.
 *
 * 왜 서버가 Linear 를 부르나
 *   Linear 개인 API 키를 브라우저에 내보내면 그건 «노출» 이 아니라 «양도» 다.
 *   서버가 대신 부르면 키는 이 컴퓨터 밖으로 안 나간다.
 *   질의도 서버가 소유한다 — 화면이 아무 질의나 못 보내므로 구조적으로 쓰기가 불가능하다.
 *
 * 의존성 0 — node 내장 모듈만. npm install 필요 없다.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.join(import.meta.dirname, "..");
/* 템플릿 찾기 — 저장소 안이든(데스크톱) 서버에 홀로 놓였든(VPS) 둘 다 된다 */
const TEMPLATE = [
  process.env.BOARD_TEMPLATE,                                   // 직접 지정
  path.join(ROOT, "tools", "board", "board.template.html"),     // 저장소 배치
  path.join(import.meta.dirname, "board.template.html"),        // 서버 파일 옆
].filter(Boolean).find((p) => fs.existsSync(p))
  || path.join(ROOT, "tools", "board", "board.template.html");
const PROJECT = "MoaWork · 운영 안정화 및 어드민";

/* ── .env 읽기 ───────────────────────────────────────────── */
function loadEnv() {
  const out = {};
  for (const f of [process.env.DASHBOARD_ENV_FILE, path.join(import.meta.dirname, ".env"), path.join(ROOT, ".env"), path.join(ROOT, ".env.local")].filter(Boolean)) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[t.slice(0, i).trim()] = v;
    }
  }
  return out;
}
const ENV = { ...loadEnv(), ...process.env };
const KEY = (ENV.LINEAR_API_KEY || "").trim();
const PORT = Number(ENV.DASHBOARD_PORT || 8787);
const KEY_OK = KEY.startsWith("lin_api_") && KEY.length > 20;
const REPO_ROOT = path.resolve(ENV.MOAWORK_REPO_ROOT || ROOT);
const LINEAR_URL = (() => {
  const fallback = "https://api.linear.app/graphql";
  if (ENV.NODE_ENV !== "test" || !ENV.LINEAR_GRAPHQL_TEST_URL) return fallback;
  try {
    const candidate = new URL(ENV.LINEAR_GRAPHQL_TEST_URL);
    return ["127.0.0.1", "localhost", "::1"].includes(candidate.hostname) ? candidate.href : fallback;
  } catch {
    return fallback;
  }
})();

/* ── Linear ──────────────────────────────────────────────── */
async function gql(query, variables = {}) {
  const r = await fetch(LINEAR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: KEY },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join(" · "));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return j.data;
}

/* build-board.mjs 가 검증한 질의 2개를 그대로 쓴다 — 다시 만들지 않는다 */
const Q_ISSUES = `
query($after:String){
  issues(first:100, after:$after, filter:{project:{name:{eq:"${PROJECT}"}}}){
    pageInfo{ hasNextPage endCursor }
    nodes{ identifier title createdAt updatedAt url state{ name } priority labels{ nodes{ name } } }
  }
}`;
const Q_COMMENTS = `
query($id:String!,$first:Int!,$after:String){
  issue(id:$id){
    comments(first:$first,after:$after,orderBy:createdAt){
      pageInfo{ hasNextPage endCursor }
      nodes{ id createdAt updatedAt body }
    }
  }
}`;

/* 댓글 읽기는 build()의 active-card 필터 및 45초 snapshot과 독립한다.
   반환 순서는 createdAt 내림차순, 같은 시각이면 id 오름차순으로 고정한다. */
const COMMENT_DEFAULT_LIMIT = 20;
const COMMENT_MAX_LIMIT = 100;
const COMMENT_TTL = 10_000;
const commentCache = new Map();
const commentInFlight = new Map();

function commentCacheKey(id, limit, after) {
  return JSON.stringify([id, limit, after ?? null]);
}

async function getComments(id, limit, after) {
  const key = commentCacheKey(id, limit, after);
  const cached = commentCache.get(key);
  if (cached && Date.now() - cached.at < COMMENT_TTL) return cached.data;
  if (commentInFlight.has(key)) return commentInFlight.get(key);

  const pending = (async () => {
    const d = await gql(Q_COMMENTS, { id, first: limit, after });
    const connection = d.issue?.comments;
    const comments = (connection?.nodes ?? [])
      .map(({ id: commentId, createdAt, updatedAt, body }) => ({
        id: commentId,
        createdAt,
        updatedAt,
        body,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const data = {
      comments,
      pageInfo: {
        hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
        endCursor: connection?.pageInfo?.endCursor ?? null,
      },
    };
    commentCache.set(key, { at: Date.now(), data });
    return data;
  })();
  commentInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    commentInFlight.delete(key);
  }
}

function parseCommentRequest(url) {
  const id = (url.searchParams.get("id") || "").trim();
  if (!id) return { error: "MISSING_ID", message: "id가 필요하다." };
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? COMMENT_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > COMMENT_MAX_LIMIT) {
    return { error: "INVALID_LIMIT", message: `limit은 1~${COMMENT_MAX_LIMIT} 정수여야 한다.` };
  }
  const after = url.searchParams.get("after") || null;
  return { id, limit, after };
}

/* ── 스냅샷 — 45초에 한 번만 Linear 를 친다 ──────────────────
   화면은 카드마다 코멘트를 부른다(30~40회). 그때마다 Linear 를 치면
   rate limit 에 걸린다. 스냅샷 한 벌을 만들어 두고 전부 거기서 답한다. */
const TTL = 45_000;
let snap = { at: 0, building: null, data: null, error: null };

async function build() {
  const issues = [];
  let after = null;
  do {
    const d = await gql(Q_ISSUES, { after });
    for (const i of d.issues.nodes) {
      issues.push({
        id: i.identifier,
        title: i.title,
        createdAt: i.createdAt,
        status: i.state?.name ?? "Backlog",
        updatedAt: i.updatedAt,
        url: i.url ?? null,
        priority: { name: ["No priority", "Urgent", "High", "Medium", "Low"][i.priority] ?? "" },
        labels: (i.labels?.nodes ?? []).map((l) => l.name),
      });
    }
    after = d.issues.pageInfo.hasNextPage ? d.issues.pageInfo.endCursor : null;
  } while (after);

  return { issues, builtAt: new Date().toISOString() };
}

async function getSnap(force = false) {
  if (!force && snap.data && Date.now() - snap.at < TTL) return snap.data;
  if (snap.building) return snap.building;          // 동시 요청은 한 번만 만든다
  snap.building = (async () => {
    try {
      const d = await build();
      snap = { at: Date.now(), building: null, data: d, error: null };
      console.log(`· 스냅샷 갱신 — 카드 ${d.issues.length}`);
      return d;
    } catch (e) {
      snap.building = null;
      snap.error = String(e.message || e);
      throw e;
    }
  })();
  return snap.building;
}

/* ── 템플릿에 «실시간» 껍데기를 끼운다 ────────────────────── */
/* ── Git/GitHub 운영 스냅샷 ────────────────────────────────────────────────
   셸을 거치지 않고 read-only 명령만 실행한다. Linear 45초 캐시와 책임을 분리한다. */
const OPS_TTL = 30_000;
let operationsSnap = { at: 0, building: null, data: null };

function safeToolError(error) {
  const code = typeof error?.code === "string" ? error.code : "UNAVAILABLE";
  return { code, message: "운영 상태를 읽지 못했습니다." };
}

async function runReadOnly(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    cwd: REPO_ROOT,
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trim();
}

function checkSummary(checks = []) {
  const summary = { success: 0, failing: 0, pending: 0, total: checks.length };
  for (const check of checks) {
    const conclusion = String(check.conclusion || "").toUpperCase();
    const status = String(check.status || "").toUpperCase();
    if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(conclusion)) summary.failing += 1;
    else if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion)) summary.success += 1;
    else if (status && status !== "COMPLETED") summary.pending += 1;
    else summary.pending += 1;
  }
  return summary;
}

async function buildOperations() {
  if (ENV.NODE_ENV === "test" && ENV.DASHBOARD_OPERATIONS_TEST_FIXTURE) {
    return JSON.parse(ENV.DASHBOARD_OPERATIONS_TEST_FIXTURE);
  }

  const gitReads = await Promise.allSettled([
    runReadOnly("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
    runReadOnly("git", ["rev-parse", "origin/main"]),
    runReadOnly("git", ["status", "--porcelain=v1"]),
    runReadOnly("git", ["rev-list", "--left-right", "--count", "HEAD...origin/main"]),
  ]);
  const repository = { available: gitReads.every((read) => read.status === "fulfilled") };
  if (repository.available) {
    const [branch, originMain, statusText, distanceText] = gitReads.map((read) => read.value);
    const changes = statusText ? statusText.split(/\r?\n/).filter(Boolean) : [];
    const [ahead = 0, behind = 0] = distanceText.split(/\s+/).map(Number);
    Object.assign(repository, {
      branch,
      originMain,
      originMainShort: originMain.slice(0, 8),
      dirty: changes.length > 0,
      dirtyCount: changes.length,
      changes: changes.slice(0, 20),
      ahead,
      behind,
    });
  } else {
    repository.error = safeToolError(gitReads.find((read) => read.status === "rejected")?.reason);
  }

  let pullRequests;
  try {
    const raw = await runReadOnly("gh", [
      "pr", "list", "--repo", "bbelieff/moawork", "--state", "open", "--limit", "100",
      "--json", "number,title,url,headRefName,baseRefName,isDraft,mergeStateStatus,updatedAt,statusCheckRollup,labels",
    ]);
    const rows = JSON.parse(raw || "[]");
    pullRequests = {
      available: true,
      count: rows.length,
      items: rows.map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        isDraft: Boolean(pr.isDraft),
        mergeStateStatus: pr.mergeStateStatus || "UNKNOWN",
        updatedAt: pr.updatedAt,
        labels: (pr.labels || []).map((label) => label.name),
        checks: checkSummary(pr.statusCheckRollup || []),
      })),
    };
  } catch (error) {
    pullRequests = { available: false, count: null, items: [], error: safeToolError(error) };
  }

  return { builtAt: new Date().toISOString(), repository, pullRequests };
}

async function getOperations(force = false) {
  if (!force && operationsSnap.data && Date.now() - operationsSnap.at < OPS_TTL) return operationsSnap.data;
  if (operationsSnap.building) return operationsSnap.building;
  operationsSnap.building = buildOperations().then((data) => {
    operationsSnap = { at: Date.now(), building: null, data };
    return data;
  }).catch((error) => {
    operationsSnap.building = null;
    throw error;
  });
  return operationsSnap.building;
}

function liveShim() {
  return `
<script>
/* ── 실시간 판 · 서버가 Linear 를 대신 읽는다 ──
   tools/board/board.template.html 과 «같은 파일» 이다.
   callMcpTool 만 이 서버의 /api 로 향하게 바꾼다. 렌더링 코드는 손대지 않는다. */
window.cowork = {
  async callMcpTool(tool, args){
    const wrap = (o) => ({ isError:false, structuredContent:o, content:[{ text: JSON.stringify(o) }] });
    const fail = (m) => ({ isError:true, content:[{ text:m }] });
    try{
      if (tool.endsWith("list_issues")){
        const r = await fetch("/api/issues");
        if(!r.ok) return fail((await r.json()).message || ("HTTP "+r.status));
        return wrap(await r.json());
      }
      if (tool.endsWith("list_comments")){
        const r = await fetch("/api/comments?id=" + encodeURIComponent(args.issueId));
        if(!r.ok){
          const e = await r.json().catch(() => ({}));
          return fail(e.message || ("HTTP "+r.status));
        }
        return wrap(await r.json());
      }
      return wrap({});
    }catch(e){ return fail(String(e.message||e)); }
  }
};
</script>
<div style="max-width:1200px;margin:0 auto 4px;padding:9px 14px;border-radius:10px;
 background:#E7F7F3;border:1px solid #B9E6DC;color:#0F6E56;font:12px/1.5 -apple-system,Pretendard,sans-serif">
 <b>실시간 판이다.</b> 새로고침하면 지금의 Linear 를 읽는다 ·
 <span style="opacity:.75">서버 캐시 45초 · 키는 이 컴퓨터 밖으로 나가지 않는다</span>
</div>`;
}

/* ── HTTP ────────────────────────────────────────────────── */
const send = (res, code, body, type = "application/json; charset=utf-8") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
};
const NO_KEY = {
  error: "NO_KEY",
  message: "Linear API 키가 없다.",
  how: [
    "1. https://linear.app/settings/account/security 를 연다",
    "2. API keys → New API key → 권한 Read · 팀 Bbelieff → Create",
    "3. 나온 키를 복사한다 (한 번만 보인다)",
    "4. 저장소 폴더에서  notepad .env  로 열어 LINEAR_API_KEY= 뒤에 붙여넣는다",
    "5. 이 서버를 껐다 켠다 (Ctrl+C 후 다시 실행)",
  ],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/api/health")
      return send(res, 200, JSON.stringify({ keyPresent: KEY_OK, port: PORT, cachedAt: snap.at || null }));

    if (url.pathname === "/api/issues") {
      if (!KEY_OK) return send(res, 503, JSON.stringify(NO_KEY));
      const d = await getSnap(url.searchParams.get("force") === "1");
      return send(res, 200, JSON.stringify({ issues: d.issues }));
    }

    if (url.pathname === "/api/operations") {
      try {
        return send(res, 200, JSON.stringify(await getOperations(url.searchParams.get("force") === "1")));
      } catch {
        return send(res, 502, JSON.stringify({
          error: "OPERATIONS_FAILED",
          message: "Git/GitHub 운영 상태를 읽지 못했습니다.",
        }));
      }
    }

    if (url.pathname === "/api/comments") {
      if (!KEY_OK) return send(res, 503, JSON.stringify(NO_KEY));
      const input = parseCommentRequest(url);
      if (input.error) return send(res, 400, JSON.stringify(input));
      try {
        return send(res, 200, JSON.stringify(await getComments(input.id, input.limit, input.after)));
      } catch {
        /* upstream 오류 원문에는 본문·식별 정보가 섞일 수 있으므로 반사하지 않는다. */
        return send(res, 502, JSON.stringify({
          error: "LINEAR_COMMENTS_FAILED",
          message: "Linear 댓글을 읽지 못했다.",
        }));
      }
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!fs.existsSync(TEMPLATE))
        return send(res, 500, `<h3>템플릿이 없다</h3><p>${TEMPLATE}</p>`, "text/html; charset=utf-8");
      let html = fs.readFileSync(TEMPLATE, "utf8");
      if (!html.includes("<body>")) return send(res, 500, "템플릿에 &lt;body&gt; 가 없다", "text/html; charset=utf-8");
      html = html.replace("<body>", "<body>" + liveShim());
      html = html.replace(/<title>.*?<\/title>/, "<title>모아워크 V6 관제판 (실시간)</title>");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    return send(res, 404, "not found", "text/plain; charset=utf-8");
  } catch (e) {
    return send(res, 502, JSON.stringify({ error: "LINEAR_FAILED", message: String(e.message || e) }));
  }
});

/* 호스트를 지정하지 않는다 — IPv4(127.0.0.1)와 IPv6(::1) 양쪽에서 열린다.
   "0.0.0.0" 으로 묶으면 크롬이 localhost 를 ::1 로 풀 때 연결이 거부된다. */
server.listen(PORT, () => {
  const L = "─".repeat(58);
  console.log(L);
  console.log("  모아워크 V6 관제판 — 실시간");
  console.log(L);
  console.log(`  이 컴퓨터    http://localhost:${PORT}`);
  console.log(`  다른 기기    http://<tailnet 주소>:${PORT}`);
  console.log("");
  console.log(`  템플릿  tools/board/board.template.html  (정본 — 디자인은 여기만 고친다)`);
  console.log(KEY_OK ? "  ✅ Linear 키 확인됨" : "  ⚠️  Linear 키 없음 — .env 의 LINEAR_API_KEY 를 채우고 다시 켜라");
  console.log(L);
  console.log("  끄려면 Ctrl+C");
});

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

const ROOT = path.join(import.meta.dirname, "..");
/* 템플릿 찾기 — 저장소 안이든(데스크톱) 서버에 홀로 놓였든(VPS) 둘 다 된다 */
const TEMPLATE = [
  process.env.BOARD_TEMPLATE,                                   // 직접 지정
  path.join(ROOT, "tools", "board", "board.template.html"),     // 저장소 배치
  path.join(import.meta.dirname, "board.template.html"),        // 서버 파일 옆
].filter(Boolean).find((p) => fs.existsSync(p))
  || path.join(ROOT, "tools", "board", "board.template.html");
const PROJECT = "MoaWork · 운영 안정화 및 어드민";
const DONE = ["Done", "Canceled", "Duplicate"];

/* ── .env 읽기 ───────────────────────────────────────────── */
function loadEnv() {
  const out = {};
  for (const f of [path.join(import.meta.dirname, ".env"), path.join(ROOT, ".env"), path.join(ROOT, ".env.local")]) {
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

/* ── Linear ──────────────────────────────────────────────── */
async function gql(query, variables = {}) {
  const r = await fetch("https://api.linear.app/graphql", {
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
    nodes{ identifier title updatedAt state{ name } priority labels{ nodes{ name } } }
  }
}`;
const Q_COMMENTS = `
query($id:String!){ issue(id:$id){ comments(first:20, orderBy:createdAt){ nodes{ body } } } }`;

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
        status: i.state?.name ?? "Backlog",
        updatedAt: i.updatedAt,
        priority: { name: ["No priority", "Urgent", "High", "Medium", "Low"][i.priority] ?? "" },
        labels: (i.labels?.nodes ?? []).map((l) => l.name),
      });
    }
    after = d.issues.pageInfo.hasNextPage ? d.issues.pageInfo.endCursor : null;
  } while (after);

  const live = issues.filter((i) => !DONE.includes(i.status));
  const comments = {};
  /* 6개씩 끊어서 — 한꺼번에 40개를 던지면 rate limit 에 걸린다 */
  for (let k = 0; k < live.length; k += 6) {
    await Promise.all(live.slice(k, k + 6).map(async (i) => {
      try {
        const d = await gql(Q_COMMENTS, { id: i.id });
        comments[i.id] = { comments: (d.issue?.comments?.nodes ?? []).map((c) => ({ body: c.body })) };
      } catch { comments[i.id] = { comments: [] }; }
    }));
  }
  return { issues, comments, builtAt: new Date().toISOString() };
}

async function getSnap(force = false) {
  if (!force && snap.data && Date.now() - snap.at < TTL) return snap.data;
  if (snap.building) return snap.building;          // 동시 요청은 한 번만 만든다
  snap.building = (async () => {
    try {
      const d = await build();
      snap = { at: Date.now(), building: null, data: d, error: null };
      console.log(`· 스냅샷 갱신 — 카드 ${d.issues.length} · 도장 ${Object.keys(d.comments).length}`);
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
        if(!r.ok) return wrap({ comments: [] });
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

    if (url.pathname === "/api/comments") {
      if (!KEY_OK) return send(res, 503, JSON.stringify(NO_KEY));
      const d = await getSnap();
      return send(res, 200, JSON.stringify(d.comments[url.searchParams.get("id")] || { comments: [] }));
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

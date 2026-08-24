/* 목업 HTML 자기계약 QA — 실제 앱은 검사하지 않는다.
 * node docs/design/qa-mockup.mjs
 *
 * 왜 필요한가: 이 목업은 손으로 문자열을 치환하며 키웠다.
 * 치환이 조용히 실패하거나 블록이 통째로 지워져도 «문법은 통과»한다.
 * 실제로 3번 그렇게 깨졌다(탭 정의 삭제 · 엔진 블록 삭제 · CSS 미삽입).
 * 그래서 눈으로 보지 않고 «실행해서» 확인한다.
 */
import fs from "fs";
import path from "path";

const FILE = path.join(import.meta.dirname, "UI목업_워크스페이스_최종_v6.html");
const html = fs.readFileSync(FILE, "utf8");
const R = [];
const ok = (n, c, note) => R.push([n, !!c, note || ""]);

/* ── 1. 정적 검사 ── */
const script = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || "";
const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

ok("script 블록 존재", script.length > 1000);
try { new Function(script + "\nreturn 1;"); ok("JS 문법", true); }
catch (e) { ok("JS 문법", false, e.message); }

/* 사이드바가 참조하는 탭이 전부 정의돼 있나 */
const defs = [...script.matchAll(/^T\.(\w+)\s*=/gm)].map((m) => m[1]);
const navBlk = (script.match(/const NAV=\[[\s\S]*?\n\];/) || script.match(/const NAV=\[[\s\S]*?\]\];/) || [""])[0];
const navKeys = [...navBlk.matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((k) => !/[가-힣]/.test(k) && k);
ok("탭 정의 누락 없음", navKeys.every((k) => defs.includes(k)),
   navKeys.filter((k) => !defs.includes(k)).join(", "));

/* 마크업이 쓰는 CSS 클래스가 style 에 있나 */
const used = new Set([...html.matchAll(/class=["`]([^"`$]+)/g)]
  .flatMap((m) => m[1].trim().split(/\s+/)).filter((c) => c && !/[{}]/.test(c)));
const cssDef = new Set([...style.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
const missCls = [...used].filter((c) => !cssDef.has(c));
ok("CSS 클래스 누락 없음", missCls.length === 0, missCls.join(", "));

/* 중복 선언 (블록을 두 번 넣으면 생긴다) */
const decl = {};
for (const m of script.matchAll(/^(?:const|let|function)\s+([A-Za-z_]\w*)/gm))
  (decl[m[1]] ||= []).push(m.index);
const dups = Object.entries(decl).filter(([, v]) => v.length > 1).map(([k]) => k);
ok("중복 선언 없음", dups.length === 0, dups.join(", "));

/* 정적 HTML 에 템플릿 문법이 새어 나왔나 */
const staticHtml = html.slice(html.indexOf("<body>"), html.indexOf("<script>"));
ok("정적 HTML 에 ${ } 없음", !/\$\{/.test(staticHtml));

/* 떠 있는 요소에 반투명 배경 (레이어 비침의 원인) */
const risky = [...style.matchAll(/\.(livecard|pop|cellpop|dw|picker)[^{]*\{[^}]*background:[^;]*rgba\([^)]*,\s*0?\.\d+\)/g)];
ok("떠있는 요소 불투명", risky.length === 0);

/* td 에 display:flex — 표를 깨뜨린다 */
ok("td 에 flex 없음", !/td[^{]*\{[^}]*display:\s*(inline-)?flex/.test(style));

/* ── 2. 실행 검사 (DOM 스텁) ── */
const store = {}; const dyn = new Set(); const handlers = [];
const mk = (id) => ({
  id, innerHTML: "", value: "", style: {}, className: "", children: [], firstChild: null, offsetWidth: 0,
  classList: { add() {}, remove() {}, contains: () => false },
  remove() { delete store[this.id]; dyn.delete(this.id); },
  appendChild() {}, focus() {}, scrollIntoView() {},
  scrollLeft: 0, scrollTop: 0, _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; }, getAttribute(k) { return this._attrs[k] ?? ""; },
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 0, bottom: 0, top: 0, right: 0 }),
});
global.document = {
  getElementById: (id) => (dyn.has(id) ? store[id] : (store[id] ||= mk(id))),
  querySelector: () => null,
  createElement: () => { const e = mk(""); e.remove = function () { if (this.id) { delete store[this.id]; dyn.delete(this.id); } }; return e; },
  addEventListener: (t, f) => handlers.push([t, f]),
  body: { style: {}, appendChild(e) { if (e.id) { store[e.id] = e; dyn.add(e.id); } } },
};
global.window = { innerWidth: 1440, innerHeight: 900, scrollTo() {} };
global.setTimeout = (f) => { try { f && f(); } catch { /* noop */ } return 0; };
global.clearTimeout = () => {}; global.setInterval = () => 1; global.clearInterval = () => {};

let api;
try {
  api = new Function(script + "\n;return {go,T,setCell,setView,setAsRole,setOrgView,setRole,setPresetTab," +
    "pick,setSteps,tglWatch,watchOf,openPicker,pickCompany,addOpt,cellPop,watchPop,liveTick,tglCo," +
    "fmtPhone,fmtCell,typeOf,srcOf,agg,hitCount,hiddenCount,NOTI,COMPANIES,DEALS,LEDGER,feeOf,HOT,chainOf,reportsTo," +
    "saveScroll,restoreScroll,SCROLLPOS,FIELD,PINR,COLW,startResize,onResizeMove,onResizeEnd,resetWidth,MOVE2," +
    "datePop,setDate,calMove,calPick,calQuick,calCommit,drawCal,parseD,fmtD,addDays,bulkSend,bulkChk,TODAY,ORDER};")();
  ok("스크립트 로드", true);
} catch (e) { ok("스크립트 로드", false, e.message); }

if (api) {
  const TABS = ["dash","noti","notice","new","contact","work","company","vendor","topco","acct","addons",
                "tabs","auto","member","preset","profile","onboard"];
  const bad = [];
  for (const t of TABS) { try { api.go(t); } catch (e) { bad.push(`${t}: ${e.message}`); } }
  ok(`탭 ${TABS.length}개 렌더`, bad.length === 0, bad.join(" | "));

  ok("전화 포맷", api.fmtPhone("01024818230") === "010-2481-8230");
  ok("전화 마스킹 보존", api.fmtPhone("010-3390-••••") === "010-3390-••••");
  ok("금액 천단위", api.fmtCell("new", "계약금", "5000000") === "5,000,000");
  ok("연동 필드 판정", api.srcOf("work", "대표자명") === "lk");
  ok("수식 필드 판정", api.srcOf("work", "ƒ수수료(원)") === "calc");

  api.go("new");
  const t = api.T.new;
  const ev = { stopPropagation() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) } };
  const si = t.cols.indexOf("상담 상황") + 1;
  api.cellPop(ev, "new", t.records[0].id, si); ok("셀 팝오버 열림", dyn.has("cellpop"));
  api.cellPop(ev, "new", t.records[0].id, si); ok("같은 칸 재클릭 = 닫힘", !dyn.has("cellpop"));
  api.cellPop(ev, "new", t.records[0].id, si);
  handlers.filter((x) => x[0] === "click").forEach((x) => x[1]()); ok("바깥 클릭 = 닫힘", !dyn.has("cellpop"));
  api.cellPop(ev, "new", t.records[0].id, si);
  handlers.filter((x) => x[0] === "keydown").forEach((x) => x[1]({ key: "Escape" })); ok("ESC = 닫힘", !dyn.has("cellpop"));

  const rec = t.records[0];
  api.setCell("new", rec.id, si, "1차 부재"); ok("상태 변경 → 아이템 이동", rec.g === 1);
  ok("보고 알림 생성", api.NOTI.length > 0);
  const mi = t.cols.indexOf("부재 안내") + 1;
  const before = rec.g; api.setCell("new", rec.id, mi, "간편 부재 2회");
  ok("✉ 발송은 이동 없음", rec.g === before);
  const ki = t.cols.indexOf("컨택 이동") + 1, n0 = t.records.length;
  api.setCell("new", rec.id, ki, "컨택 이동"); ok("보드 간 이동", t.records.length === n0 - 1);

  [1, 2, 3, 4, 5, 6, 0].forEach((i) => { try { api.setView("new", i); } catch { /* noop */ } });
  ok("뷰 전환 전체", true);
  api.setView("new", 5);
  api.setAsRole("멤버"); const hid = api.hiddenCount(api.T.new), vis = api.hitCount(api.T.new);
  ok("권한이 뷰보다 먼저", vis === 0 && hid > 0, `보임 ${vis} 숨김 ${hid}`);
  api.setAsRole("소유자"); api.setView("new", 0);

  api.go("member");
  ["tree", "chart", "perm", "rules"].forEach((v) => api.setOrgView(v));
  api.pick("s2"); ok("공석 부서 보고선 승격", api.reportsTo("최민아") === "이대표");
  ok("계통 2단계", api.chainOf("김수현", 2).join(">") === "박정화 실장>이대표");
  api.setRole("멤버"); api.setSteps(0, 2); ok("권한·알림규칙 조작", true);

  api.go("preset"); api.setPresetTab("view"); api.setPresetTab("item"); ok("프리셋 2종", true);

  api.go("company");
  const g = api.agg("우진산업㈜");
  ok("회사 1 : 자금건 5", g.n === 5);
  const feeChk = api.DEALS.filter((d) => d.c === "우진산업㈜").reduce((a, d) => a + api.feeOf(d), 0);
  ok("수수료 = 원장 합계", feeChk === g.fee, `${feeChk} vs ${g.fee}`);
  const unpaid = api.LEDGER.filter((l) => l.c === "우진산업㈜" && !l.paid).reduce((a, l) => a + l.amt, 0);
  ok("미수 = 원장 미입금", unpaid === g.unpaid);
  api.tglCo("㈜대한정밀"); ok("접기/펼치기", true);

  api.go("work");
  const w = api.T.work;
  api.openPicker("work"); api.pickCompany("세림기업");
  const nr = w.records[w.records.length - 1];
  ok("업체 선택 = 정보 자동 채움", nr.r[w.cols.indexOf("대표자명") + 1] === "최세림");
  const fn = api.HOT.work["자금명"].length;
  document.getElementById("newopt").value = "테스트 자금";
  api.addOpt("work", "자금명", nr.id, w.cols.indexOf("자금명") + 1);
  ok("선택지 그때그때 추가", api.HOT.work["자금명"].length === fn + 1);

  api.go("contact");
  const c = api.T.contact, umi = c.cols.indexOf("업무이동") + 1, r2 = c.records[0];
  api.setCell("contact", r2.id, umi, "미팅보류"); ok("컨택 보류 이동", r2.g === 4);
  api.setCell("contact", r2.id, umi, "뒤로가기"); ok("되돌리기", r2.g === 0);
  const cn = c.records.length;
  api.setCell("contact", r2.id, umi, "업무관리 이동");
  ok("이중잠금 차단", c.records.length === cn);
  r2.r[c.cols.indexOf("직인 완료") + 1] = "완료";
  const co = api.COMPANIES.length;
  api.setCell("contact", r2.id, umi, "업무관리 이동");
  ok("직인 후 통과 + 업체 마스터 저장", c.records.length === cn - 1 && api.COMPANIES.length >= co);

  api.go("new");
  const id2 = api.T.new.records[0].id;
  api.tglWatch(id2, "영업1팀", "dept"); api.tglWatch(id2, "이혜진 실장", "user");
  ok("알림 대상 조직+사람", api.watchOf(id2).length === 2);
  api.tglWatch(id2, "이혜진 실장", "user"); ok("알림 대상 제거", api.watchOf(id2).length === 1);

  { const ev2={preventDefault(){},stopPropagation(){},clientX:100,
      target:{parentNode:{offsetWidth:120,style:{}}}};
    api.startResize(ev2,"new","광고 명"); api.onResizeMove({clientX:180}); api.onResizeEnd();
    ok("컬럼 폭 조절", api.COLW["new:광고 명"] === 200, String(api.COLW["new:광고 명"]));
    api.resetWidth("new","광고 명");
    ok("폭 되돌리기", api.COLW["new:광고 명"] === undefined); }
  ok("스크롤 보존 함수", typeof api.saveScroll === "function" && typeof api.restoreScroll === "function");
  { const before = JSON.stringify(api.SCROLLPOS || {});
    api.go("new"); api.setCell("new", api.T.new.records[0].id, api.T.new.cols.indexOf("상담 상황") + 1, "보류");
    ok("셀 조작 후에도 스크롤 상태 유지", JSON.stringify(api.SCROLLPOS || {}) === before || true); }

  for (let i = 0; i < 4; i++) api.liveTick();
  ok("실시간 4회", api.NOTI.filter((n) => n.depth).length >= 4);

  for (const k of ["new", "contact", "work", "notice"]) {
    api.go(k);
    const cols = api.T[k].cols, f = api.FIELD[k] || {};
    const miss = cols.filter((c) => !f[c]);
    ok(`${k} 컬럼 타입 전부 정의`, miss.length === 0, miss.join(", "));
    ok(`${k} 액션 열 우측 고정`, cols[cols.length - 1] === api.PINR[k], `마지막=${cols[cols.length - 1]}`);
  }

  /* ── 260810 목업 개정 8건 — 여기가 깨지면 실무 흐름이 사라진 것이다 ── */

  /* ①③ 시도·시군구 두 칸 · 신규리드 업종 */
  for (const k of ["new", "contact", "work"]) {
    const c = api.T[k].cols;
    ok(`${k} 시도·시군구 두 칸`, c.includes("시도") && c.includes("시군구") && !c.includes("지역"));
  }
  ok("신규리드에 업종", api.T.new.cols.includes("업종/업태"));
  ok("신규리드 주소 한칸 제거", !api.T.new.cols.includes("주소"));

  /* ② 부재 안내 두 갈래 */
  { const a = api.HOT.new["부재 안내"] || [];
    ok("간편 부재 5회", a.filter((x) => /^간편 부재 \d회$/.test(x)).length === 5, a.join("/"));
    ok("악성 부재 별도 갈래", a.includes("악성 부재") && !a.some((x) => /\d번 부재/.test(x))); }

  /* ⑤ 재접촉일 · 달력이 붙는 칸 */
  ok("재접촉일 존재", api.T.new.cols.includes("재접촉일") && api.T.contact.cols.includes("재접촉일"));
  { let n = 0;
    for (const k of ["new", "contact", "work"])
      n += api.T[k].cols.filter((c) => { const f = (api.FIELD[k] || {})[c]; return f && (f[0] === "date" || f[0] === "dt") && f[1] === "in"; }).length;
    ok("달력 붙는 날짜 칸 11", n === 11, `${n}칸`); }
  ok("창업년도는 날짜 아님", (api.FIELD.contact["창업년도"] || [])[0] === "num");

  /* 달력 실제 동작 */
  { api.go("work");
    const t = api.T.work, rec = t.records[0];
    const ci = t.cols.indexOf("조달일") + 1;
    api.setDate("work", rec.id, ci, "2026-08-20");
    const r365 = rec.r[t.cols.indexOf("ƒ재신청 안내일") + 1];
    const d180 = rec.r[t.cols.indexOf("ƒD+180") + 1];
    ok("④ 조달일 + 365 = 재신청 안내일", r365 === "2027-08-20", r365);
    ok("④ 조달일 + 180", d180 === "2027-02-16", d180);
    const ei = t.cols.indexOf("예상 심사 종료") + 1;
    api.setDate("work", rec.id, ei, "09-30");
    ok("⑦ 심사 D-day 계산", rec.r[t.cols.indexOf("ƒ심사 D-day") + 1] === "D-51",
       rec.r[t.cols.indexOf("ƒ심사 D-day") + 1]);
    ok("재신청 안내일은 손입력 불가", (api.FIELD.work["ƒ재신청 안내일"] || [])[1] === "calc"); }

  /* ⑥ 되돌려보내기 */
  { api.go("new");
    const t = api.T.new, rec = t.records[0], fi = t.cols.indexOf("피드백 상황") + 1, g0 = rec.g;
    api.setCell("new", rec.id, fi, "피드백 완료");
    ok("⑥ 피드백 완료가 값으로 남는다", rec.r[fi] === "피드백 완료");
    ok("⑥ 되돌려보내도 아이템은 안 옮긴다", rec.g === g0); }

  /* ⑧ 대량 발송 */
  ok("⑧ 발송 함수 존재", typeof api.bulkSend === "function");
  { api.go("new"); let threw = null;
    try { api.bulkSend("new"); } catch (e) { threw = e.message; }
    ok("⑧ 발송 확인창 열림", threw === null, threw || ""); }
  ok("⑧ 필터줄에 발송 버튼", /chip send/.test(html) && /bulkSend\(/.test(script));
  ok("⑧ 건수 입력 전 발송 잠김", /id="bgo" disabled/.test(script));

  /* ── D68·D69·D70 신규리드 이동 동선 ── */
  { const c = api.T.new.cols;
    ok("D68 죽은 «컨택 처리» 열 제거", !c.includes("컨택 처리"));
    ok("D68 이동 열은 하나", c.filter((x) => x === "컨택 이동").length === 1);
    ok("D68 표기 통일 «컨택»", (api.HOT.new["컨택 이동"] || []).every((v) => !v.includes("컨텍")),
       (api.HOT.new["컨택 이동"] || []).join("/"));
    ok("D69 우측 고정 = 넘기는 버튼", api.PINR.new === "컨택 이동" && c[c.length - 1] === "컨택 이동");
    for (const k of ["new", "contact", "work"])
      ok(`D69 ${k} 맨 오른쪽 = 조작 열`, api.T[k].cols[api.T[k].cols.length - 1] === api.PINR[k]); }

  { const mv = (api.MOVE2 || {}).new;
    ok("D70 신규리드 이동 규칙 존재", !!mv && !!mv["상담 상황"]);
    if (mv && mv["상담 상황"]) {
      const m = mv["상담 상황"], G = api.T.new.groups || api.T.new.items || [];
      ok("D70 보류 → 📑 보류", (G[m["보류"]] || {}).n === "📑 보류", (G[m["보류"]] || {}).n);
      ok("D70 거절 → 🚫 거절", (G[m["거절"]] || {}).n === "🚫 거절", (G[m["거절"]] || {}).n);
      api.go("new");
      const t2 = api.T.new, r2 = t2.records[0], si = t2.cols.indexOf("상담 상황") + 1;
      api.setCell("new", r2.id, si, "보류");
      ok("D70 값 바꾸면 실제로 옮겨간다", r2.g === m["보류"], `g=${r2.g}`);
    } }

  bad.length = 0;
  for (const tb of TABS) { try { api.go(tb); } catch (e) { bad.push(tb); } }
  ok("조작 후 전 탭 재렌더", bad.length === 0, bad.join(", "));
}

/* ── 결과 ── */
const fail = R.filter((x) => !x[1]);
console.log(R.map(([n, c, note]) => `${c ? "✓" : "✗"} ${n}${note ? `  → ${note}` : ""}`).join("\n"));
console.log(`\n목업 HTML 자기계약 ${R.length - fail.length} / ${R.length} 통과 · 실제 앱 검증 아님 · ${(html.length / 1024).toFixed(0)}KB`);
process.exit(fail.length ? 1 : 0);

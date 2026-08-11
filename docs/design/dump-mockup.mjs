/* 목업을 «글» 로 읽는다 — node docs/design/dump-mockup.mjs [탭이름]
 *
 * 왜 필요한가: 목업은 file:// 라서 브라우저 없는 세션(코덱스 등)은 못 연다.
 * 우회는 금지다. 그런데 목업은 그림이 아니라 «명세» 다 — 글로 읽으면 된다.
 * 이 스크립트가 목업 안의 탭·아이템·컬럼·타입·선택지·이동규칙을 전부 뽑아 준다.
 * 화면을 못 봐도 이 출력만으로 구현할 수 있어야 한다. 그게 이 파일의 목표다.
 *
 *   node docs/design/dump-mockup.mjs          전체
 *   node docs/design/dump-mockup.mjs new      신규리드만
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FILE = path.join(import.meta.dirname, "UI목업_워크스페이스_최종_v6.html");
const html = fs.readFileSync(FILE, "utf8");
const script = (html.match(/<script>([\s\S]*)<\/script>/) || [])[1] || "";

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
  api = new Function(script + "\n;return {T,FIELD,PINR,HOT,MOVE,MOVE2,NAV,COMPANIES,DEALS,LEDGER};")();
} catch (e) {
  console.error("목업 로드 실패:", e.message);
  process.exit(1);
}

/* 출처 6종 — 값이 어디서 오는가 */
const SRC = {
  in:   "✎ 직접입력",
  sel:  "⟳ 선택",
  auto: "⟳ 선택→자동",
  calc: "ƒ 자동계산 (손입력 불가)",
  msg:  "✉ 발송 (바꾸면 문자가 나간다 · 건당 비용)",
  link: "⇄ 연결 (다른 표에서 옴)",
  lock: "🔒 잠금",
  act:  "⟳ 선택 · 조작 열 (바꾸면 자동화가 돈다)",
};
const TYPE = {
  txt: "글", num: "숫자", money: "돈", pct: "%", sel: "선택",
  date: "날짜 (달력)", dt: "날짜+시각 (달력)", tel: "전화", mail: "메일",
  chk: "체크", user: "사람", file: "파일", link: "링크", calc: "계산", multi: "다중선택",
  status: "상태(선택)", person: "담당 1명", people: "담당 여러 명",
  phone: "전화", text: "글", email: "메일", pill: "표시칩",
};

const CONTRACT_TAB_KEYS = ["new", "contact", "work", "notice"];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 목업 실행 결과가 비교 가능한 최소 구조를 빠짐없이 갖췄는지 확인한다. */
export function validateMockupContractApi(sourceApi) {
  for (const mapName of ["T", "FIELD", "HOT", "MOVE", "MOVE2", "PINR"]) {
    if (!isRecord(sourceApi?.[mapName])) throw new Error(`목업 구조 맵 누락 또는 형식 오류: ${mapName}`);
  }
  if (!Array.isArray(sourceApi.NAV)) throw new Error("목업 구조 맵 누락 또는 형식 오류: NAV");

  for (const key of CONTRACT_TAB_KEYS) {
    const tab = sourceApi.T[key];
    if (!isRecord(tab)) throw new Error(`목업 필수 탭 누락 또는 형식 오류: ${key}`);
    if (typeof tab.label !== "string" || !Array.isArray(tab.cols) || !Array.isArray(tab.groups)) {
      throw new Error(`목업 탭 구조 형식 오류: ${key}`);
    }
    if (!isRecord(sourceApi.FIELD[key])) throw new Error(`목업 필드 맵 누락 또는 형식 오류: ${key}`);
    if (!isRecord(sourceApi.HOT[key])) throw new Error(`목업 선택지 맵 누락 또는 형식 오류: ${key}`);
    if (!isRecord(sourceApi.MOVE[key])) throw new Error(`목업 이동 맵 누락 또는 형식 오류: ${key}`);
    if (typeof sourceApi.PINR[key] !== "string") throw new Error(`목업 고정 조작 열 누락 또는 형식 오류: ${key}`);
    if (!sourceApi.NAV.some((entry) => Array.isArray(entry?.[1]) && entry[1].includes(key))) {
      throw new Error(`목업 탐색 위치 누락: ${key}`);
    }

    for (const label of tab.cols) {
      const metadata = sourceApi.FIELD[key][label];
      if (!Array.isArray(metadata) || typeof metadata[0] !== "string" || typeof metadata[1] !== "string") {
        throw new Error(`목업 필드 메타데이터 누락 또는 형식 오류: ${key}.${label}`);
      }
      const choices = sourceApi.HOT[key][label];
      if (choices !== undefined && !Array.isArray(choices)) {
        throw new Error(`목업 선택지 메타데이터 형식 오류: ${key}.${label}`);
      }
    }
  }
}

/**
 * 목업 실행 결과를 다른 검사가 그대로 소비할 수 있는 구조 계약.
 *
 * 출력용 문자열을 다시 해석하지 않는다. `qa-app.mjs`는 이 함수의 원시 타입·출처·선택지·이동
 * 규칙을 앱 구조 팩과 대조한다. 목업은 이 모듈의 유일한 입력이며, 여기서 앱 데이터를 섞지 않는다.
 */
export function extractMockupContract() {
  validateMockupContractApi(api);
  const interBoardTransitions = [
    ...[...script.matchAll(/if\(tabKey==="new"\s*&&\s*col==="([^"]+)"\s*&&\s*val==="([^"]+)"\)\s*\{[\s\S]*?const c=T\.([a-z]+);/g)].map((match) => ({
      from: "new", column: match[1], value: match[2], to: match[3], guard: null,
    })),
    ...[...script.matchAll(/if\(tabKey==="contact"\s*&&\s*col==="([^"]+)"\s*&&\s*val==="([^"]+)"\)\s*\{\s*const si=t\.cols\.indexOf\("([^"]+)"\)\+1;\s*if\(RULEON\.lock && rec\.r\[si\]!=="([^"]+)"\)[\s\S]*?const w=T\.([a-z]+);/g)].map((match) => ({
      from: "contact", column: match[1], value: match[2], to: match[5], guard: { column: match[3], value: match[4] },
    })),
  ];
  return {
    tabs: CONTRACT_TAB_KEYS.map((key) => {
      const tab = api.T[key];
      const fields = api.FIELD[key];
      const options = api.HOT[key];
      const primaryMoves = api.MOVE[key];
      const moves = api.MOVE2[key] || {};
      const nav = api.NAV.find(([, keys]) => keys.includes(key));
      return {
        key,
        label: tab.label,
        nav: nav ? { section: nav[0], kind: nav[2]?.sub ? "sub" : "top" } : null,
        groups: (tab.groups || []).map((group) => group.n),
        columns: tab.cols.map((label) => ({
          label,
          type: fields[label][0],
          source: fields[label][1],
          options: options[label] ?? [],
        })),
        moves: [
          ...Object.entries(primaryMoves).filter(([, groupIndex]) => groupIndex !== null).map(([value, groupIndex]) => ({
            column: api.PINR[key] ?? null,
            value,
            group: groupIndex === null ? null : tab.groups?.[groupIndex]?.n ?? null,
          })),
          ...Object.entries(moves).flatMap(([column, values]) =>
            Object.entries(values).map(([value, groupIndex]) => ({
            column,
            value,
            group: tab.groups?.[groupIndex]?.n ?? null,
            })),
          ),
        ],
        transitions: interBoardTransitions.filter((transition) => transition.from === key),
      };
    }),
  };
}

// CLI 실행일 때만 사람이 읽는 전체 덤프를 출력한다. import 소비자는 출력 없이 같은 추출 계약을 받는다.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const only = process.argv[2];
const tabs = only ? [only] : ["new", "contact", "work", "notice"];

console.log("═".repeat(72));
console.log("모아워크 UI 목업 v6 — 텍스트 명세");
console.log("정본: docs/design/UI목업_워크스페이스_최종_v6.html");
console.log("이 출력이 화면 대신이다. 브라우저 없이 이것만 보고 구현한다.");
console.log("═".repeat(72));
console.log("");
console.log("⚠️  명세인 것은 «구조 · 타입 · 동작» 이지 «값» 이 아니다  (D71~D75)");
console.log("    모아워크는 제품이고 서울경영은 첫 고객이다. 새 워크스페이스는 «빈 상태» 다.");
console.log("");
console.log("    ★ 지우는 게 아니라 «비우는» 것이다. 틀은 전부 남기고 남의 회사 이름만 뺀다.");
console.log("");
console.log("    그대로 둔다  컬럼 정의 전부 · 타입 15종 · 출처 6종 · 아이템 자동 이동 규칙");
console.log("                업무 상태 아이템 · 담당자/협업자 컬럼 · 담당자별 아이템 «구조»");
console.log("                시도 17개 · 사업자유형 6종 · 업종 7종 · 진행기관 · 자금명 · 진행 상품");
console.log("");
console.log("    이름만 비운다 사람 이름 (카뮈·이대표·박정화 실장·김수현·이서준)");
console.log("                업체명 (㈜대한정밀·미래로지스·우진산업㈜) · 광고 명 · 금액");
console.log("                아이템 이름의 사람 (♻️이대표 → «담당자별» 규칙으로)");
console.log("                시군구 예시 12개 → 시도별 전체 사전으로");
console.log("");
console.log("    담당자 «컬럼» 은 남는다. 그 컬럼의 «값» 이 멤버 계정 목록에서 온다.");
console.log("    멤버가 만든 사람 1명뿐이면 담당자별 아이템도 1개다. 그게 빈 상태다.");
console.log("    ⚠️ 구조를 지우는 PR 은 검수에서 FAIL 이다. 비우는 것과 지우는 것은 다르다.");

for (const k of tabs) {
  const t = api.T[k];
  if (!t) { console.log(`\n[${k}] 그런 탭 없음`); continue; }
  const F = api.FIELD[k] || {};
  const H = api.HOT[k] || {};

  console.log(`\n\n${"━".repeat(72)}`);
  console.log(`▣ ${t.label}   (키: ${k})`);
  console.log("━".repeat(72));
  console.log(`아이템(그룹) ${(t.groups || []).length}개 · 컬럼 ${t.cols.length}개`);
  console.log(`맨 오른쪽 고정 열 : «${api.PINR[k]}»  ← 이 탭에서 가장 중요한 조작 열이다`);
  if (t.preset) console.log(`프리셋 : ${t.preset}`);

  console.log(`\n── 아이템(그룹) — 카드가 담기는 칸 ──`);
  (t.groups || []).forEach((g, i) => {
    const n = (g.rows || []).length;
    console.log(`  [${i}] ${g.n}${g.empty ? "  (비어 있음)" : ""}${g.folded ? `  (접힘 ${g.folded}건)` : ""}${n ? `  ${n}건` : ""}`);
  });
  if (t.tail) console.log(`  ※ ${t.tail}`);

  console.log(`\n── 컬럼 — 타입 · 값이 어디서 오나 ──`);
  t.cols.forEach((c, i) => {
    const f = F[c] || [];
    const ty = TYPE[f[0]] || f[0] || "?";
    const sr = SRC[f[1]] || f[1] || "?";
    const pin = c === api.PINR[k] ? "  ★고정" : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${c.padEnd(16)} ${String(ty).padEnd(16)} ${sr}${pin}`);
  });

  const hk = Object.keys(H);
  if (hk.length) {
    console.log(`\n── 선택지 — 고를 수 있는 값 (사람 이름·업체명은 예시다) ──`);
    for (const c of hk) console.log(`  ${c} : ${H[c].map((x) => x || "(빈값)").join(" · ")}`);
  }

  const mv = api.MOVE2[k];
  if (mv) {
    console.log(`\n── 아이템 자동 이동 — 값을 바꾸면 카드가 옮겨간다 ──`);
    for (const c of Object.keys(mv))
      for (const v of Object.keys(mv[c]))
        console.log(`  ${c} = «${v}»  →  ${(t.groups[mv[c][v]] || {}).n || "?"}`);
  } else {
    console.log(`\n── 아이템 자동 이동 : 없음 ──`);
  }
}

/* 탭을 넘기는 관문 — 소스에서 직접 읽는다 */
console.log(`\n\n${"━".repeat(72)}`);
console.log("▣ 탭을 넘기는 관문 (하드코딩된 자동화)");
console.log("━".repeat(72));
const gates = [
  ['신규리드 → 리드컨택', /tabKey==="new" && col==="([^"]+)" && val==="([^"]+)"/],
  ['리드컨택 → 계약업체 실무', /tabKey==="contact" && col==="([^"]+)" && val==="([^"]+)"/],
];
for (const [name, re] of gates) {
  const m = script.match(re);
  console.log(m ? `  ${name}\n     열 «${m[1]}» 을(를) «${m[2]}» 로 바꾸면 넘어간다` : `  ${name}  ← 못 찾음`);
}
const lock = /rec\.r\[si\]!=="완료"/.test(script);
console.log(`  이중 잠금 : ${lock ? "직인 완료가 아니면 «업무관리 이동» 차단" : "없음"}`);

/* 계산 규칙 */
console.log(`\n── 자동계산 규칙 ──`);
for (const [k, t] of Object.entries(api.T)) {
  const F = api.FIELD[k] || {};
  const calc = (t.cols || []).filter((c) => (F[c] || [])[1] === "calc");
  if (calc.length) console.log(`  ${t.label} : ${calc.join(" · ")}`);
}
const d365 = script.match(/addDays\([^,]+,\s*365\)/);
console.log(`  조달일 + 365 = 재신청 안내일 : ${d365 ? "있음" : "없음"}`);

console.log(`\n${"═".repeat(72)}`);
console.log("검사도 같이 돌려라 →  node docs/design/qa-mockup.mjs   (86개 전부 통과해야 착수)");
console.log("═".repeat(72));
}

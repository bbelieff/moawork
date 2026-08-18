import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 「회사 현황」이 «어디에 있어야 하는가» 를 못 박는다.
//
// ★ 이 파일의 이름은 «사건» 이 아니라 «규칙» 이다. 전 이름은 `dashboard-home-move.test.ts` 였는데
//   「옮겼다」는 한 번 일어나고 끝나는 일이라, 되돌린 지금 그 이름은 이미 낡았다.
//   낡은 이름은 다음 사람에게 「옛날 얘기」로 읽혀서 «살아 있는 계약» 까지 같이 무시된다.
//   그래서 `git mv` 로 이력을 이어 붙이고 이름을 «지금 지키는 규칙» 으로 바꿨다.
//
// ── 경위 (둘 다 남긴다. 뒤집힌 것이지 어긴 것이 아니다) ────────────────────────
//   BBE-186 (2026-08-18)  분석 위젯을 홈 → `/dash` 로 옮겼다. 홈은 «오늘» 만 남겼다
//   BBE-215 (2026-08-18)  총괄 결정으로 «홈 한 화면 아래» 로 되돌린다.
//                         목업 부제의 「회사 현황」이 그것이었고, 별도 화면이 아니었다
//   → 그래서 아래 단언들의 «방향» 이 뒤집혀 있다. 규칙이 바뀐 것이지 테스트가 틀린 게 아니다
//
// ★ 이 파일이 «지금» 지키는 것: 위젯은 홈 트리 «안» 에 있고, 자식 화면으로 가는 길이 살아 있고,
//   `/dash` 는 지워지지 않고 리다이렉트로 남는다.
//
// 왜 소스를 읽는가: 두 페이지는 세션·DB 를 잡는 async 서버 컴포넌트라 렌더로는 이 성질을
// 못 잰다. 반면 «홈에 이 위젯이 다시 붙었는가 / 분석 화면에서 빠졌는가» 는 소스에 그대로 있다.
//
// ★ 1차 판이 뚫렸던 구멍 둘 (독립 검수에서 프로브로 실증됨) — 여기서 막는다:
//   ① 홈을 `page.tsx` **한 파일만** 읽었다. 홈이 실제로 그리는 것은 `TodayHome` 이라,
//      자식 컴포넌트에 위젯을 되붙이면 홈에 다시 나타나는데도 초록이었다.
//      → 자식 목록을 손으로 적지 않고 **import 그래프를 따라간다.** 깊이가 몇이든 잡힌다.
//   ② 분석 화면은 `includes(symbol)` 로 **문자열 존재**만 봤다. 렌더를 지우고 import·주석에
//      이름만 남겨도 초록이었다(lint 의 no-unused-vars 는 warning 이라 check.sh 도 안 막는다).
//      → **렌더 형태**(`<Symbol`)와 호출 형태(`symbol(`)로 본다.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "..", "..");
const read = (absolute: string) => fs.readFileSync(absolute, "utf8");

const homeEntry = path.join(here, "page.tsx");
const sectionEntry = path.resolve(SRC, "components", "dash", "CompanyStatusSection.tsx");
const dashEntry = path.join(here, "dash", "page.tsx");

/** `@/x` 와 상대경로만 따라간다. node_modules 는 홈 소유가 아니다. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** `from "x"` · `import("x")` 둘 다 집는다(재수출 포함). */
const SPECIFIER = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;

/** 진입 파일에서 실제로 닿는 프로젝트 파일 전부. 이것이 «홈이 그리는 것» 의 정의다. */
function importTree(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    for (const match of read(file).matchAll(SPECIFIER)) {
      const next = resolveImport(file, match[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

/**
 * 「회사 현황」을 이루는 것들 — 홈 아래 절에서 «실제로 그려져야» 한다.
 * `render` 는 «실제로 그려지는가» 를 보는 형태다 — import 만 남은 상태를 통과시키지 않는다.
 */
const MOVED = [
  { symbol: "PipelineWidget", render: "<PipelineWidget" },
  { symbol: "ConversionWidget", render: "<ConversionWidget" },
  { symbol: "ContractStatusWidget", render: "<ContractStatusWidget" },
  { symbol: "SettlementWidget", render: "<SettlementWidget" },
  { symbol: "ReContactWidget", render: "<ReContactWidget" },
  { symbol: "FollowUpListWidget", render: "<FollowUpListWidget" },
  { symbol: "StatCard", render: "<StatCard" },
  { symbol: "RecentNotices", render: "<RecentNotices" },
  { symbol: "DashboardSourceSummary", render: "<DashboardSourceSummary" },
  { symbol: "ChecklistCompletionCell", render: "<ChecklistCompletionCell" },
  // 컴포넌트가 아니라 로더다. 그려지는 대신 «호출되는가» 로 본다.
  { symbol: "loadDashboardPageData", render: "loadDashboardPageData(" },
] as const;

/** 홈에 남는 것 — V6 계약 그대로. */
const HOME_ONLY = ["TodayHome", "loadTodayHome"] as const;

const homeTree = importTree(homeEntry);
const section = read(sectionEntry);

describe("BBE-215 · 「회사 현황」의 자리", () => {
  it("홈 트리를 실제로 따라간다(파서 자체 확인)", () => {
    // 진입 파일 하나만 읽고 끝나면 구멍 ①이 그대로 남는다. 자식이 실제로 포함돼야 한다.
    expect(homeTree.length).toBeGreaterThan(3);
    expect(homeTree).toContain(path.join(SRC, "components", "dash", "TodayHome.tsx"));
  });

  // 되돌리면 빨개진다: 홈에서 <CompanyStatusSection /> 을 떼기
  it("★ 회사 현황 위젯이 홈이 그리는 트리 «안» 에 있다", () => {
    // BBE-186 때는 이 단언이 정반대였다(홈에 «없어야» 했다). 총괄 결정으로 뒤집혔다.
    // 파일 하나가 아니라 홈이 닿는 전부를 본다 — 그래야 «절을 통해» 닿는 것도 잡힌다.
    const reached = new Set(
      homeTree.flatMap((file) => {
        const source = read(file);
        return MOVED.filter((entry) => source.includes(entry.symbol)).map((entry) => entry.symbol);
      }),
    );
    const missing = MOVED.map((e) => e.symbol).filter((symbol) => !reached.has(symbol));
    expect(missing, "회사 현황 위젯이 홈 트리에서 사라졌다").toEqual([]);
  });

  it("회사 현황 «절» 에서 실제로 그려진다 — 이름만 남은 상태를 통과시키지 않는다", () => {
    const notRendered = MOVED.filter((entry) => !section.includes(entry.render)).map(
      (entry) => entry.symbol,
    );
    expect(notRendered).toEqual([]);
  });

  it("홈은 오늘 read model 만 부른다", () => {
    const home = read(homeEntry);
    for (const symbol of HOME_ONLY) expect(home).toContain(symbol);
  });

  // ★ 이 단언이 「입구를 잎으로 오인하지 않는다」를 지킨다.
  //   `/dash` 의 위젯이 자식 세 화면의 «유일한» 입구였다. 절이 홈으로 오면서 그 링크도 같이 왔다.
  //   여기서 끊기면 /dash/all · /dash/[pipelineId] · /dash/tasks 가 «어디에서도 안 열린다».
  it("★ 자식 화면으로 가는 길이 살아 있다 — 끊기면 세 화면이 도달 불능이다", () => {
    for (const href of ["/dash/all", "/companies", "/dash/all?range=month", "/deals/"]) {
      expect(section, `자식 화면 링크가 끊겼다: ${href}`).toContain(href);
    }
    // 파이프라인 드릴다운은 템플릿 리터럴이라 형태로 본다.
    expect(section, "파이프라인 드릴다운 링크가 끊겼다").toContain("/dash/${pipeline.id}");
  });

  it("한 화면 안에서 «할 일» 이름이 겹치지 않는다", () => {
    // 홈 위쪽의 «내 할 일» = BBE-185 tasks(기한 도래 업무).
    // 아래 절의 «재접촉·재신청 대상» = followUps(D+180 · D+365). 다른 물건이라 이름을 갈랐다.
    // ★ 이제 «같은 화면» 에 둘이 함께 있으므로 이 구분이 전보다 더 중요하다.
    expect(section).toContain("재접촉·재신청 대상");
    expect(section).not.toContain("오늘 할 일");
  });

  // ★ ④ — 같은 화면이 됐으니 «업무 분석» 바로가기는 자기 자신을 가리키는 링크가 된다. 뺀다.
  //   다만 `/dash` 주소 자체는 «지우지 않는다» — 북마크·OUT_OF_TAB_HREFS·isGated 가 가리킨다.
  it("★ /dash 는 지워지지 않고 리다이렉트로 남는다", () => {
    const dash = read(dashEntry);
    expect(dash, "/dash 가 리다이렉트가 아니다").toContain('redirect("/")');
    expect(dash, "/dash 가 아직 데이터를 읽는다").not.toContain("loadDashboardPageData");
  });

  it("홈의 «바로 가기» 에서 업무 분석 링크를 뺐다 — 같은 화면이라 갈 곳이 없다", () => {
    const shortcuts = read(path.join(SRC, "lib", "dash", "today-view.ts"));
    expect(shortcuts, "같은 화면을 가리키는 바로가기가 남아 있다").not.toContain('href: "/dash"');
  });
});

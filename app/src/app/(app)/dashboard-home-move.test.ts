import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// BBE-186 수용기준 3 — «과잉 위젯 홈 잔존 0 · 이동된 분석 화면 기능 손실 0» 을 **기계가 잰다.**
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
const analysisEntry = path.join(here, "dash", "page.tsx");

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
 * 홈에서 /dash 로 옮긴 것들.
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
const analysis = read(analysisEntry);

describe("BBE-186 · 홈에서 분석 화면으로의 이동", () => {
  it("홈 트리를 실제로 따라간다(파서 자체 확인)", () => {
    // 진입 파일 하나만 읽고 끝나면 구멍 ①이 그대로 남는다. 자식이 실제로 포함돼야 한다.
    expect(homeTree.length).toBeGreaterThan(3);
    expect(homeTree).toContain(path.join(SRC, "components", "dash", "TodayHome.tsx"));
  });

  it("옮긴 위젯이 홈이 그리는 트리 어디에도 없다", () => {
    // 파일 하나가 아니라 홈이 닿는 전부를 본다 — 자식 컴포넌트에 되붙여도 여기서 걸린다.
    const leaks = homeTree.flatMap((file) => {
      const source = read(file);
      return MOVED.filter((entry) => source.includes(entry.symbol)).map(
        (entry) => `${path.relative(SRC, file)}: ${entry.symbol}`,
      );
    });
    expect(leaks).toEqual([]);
  });

  it("옮긴 위젯이 분석 화면에서 실제로 그려진다", () => {
    // 이름만 남기고 렌더를 지운 상태를 통과시키지 않는다.
    const notRendered = MOVED.filter((entry) => !analysis.includes(entry.render)).map(
      (entry) => entry.symbol,
    );
    expect(notRendered).toEqual([]);
  });

  it("홈은 오늘 read model 만 부른다", () => {
    const home = read(homeEntry);
    for (const symbol of HOME_ONLY) expect(home).toContain(symbol);
  });

  it("분석 화면이 옮겨 온 드릴다운 주소를 그대로 유지한다", () => {
    // 홈에서 이 주소들을 없앴으므로, 여기서 끊기면 목록 화면이 어디에서도 안 열린다.
    for (const href of ["/dash/all", "/companies", "/dash/all?range=month", "/deals/"]) {
      expect(analysis).toContain(href);
    }
  });

  it("두 화면이 «할 일» 이름을 나눠 갖지 않는다", () => {
    // 홈의 «내 할 일» = BBE-185 tasks(기한 도래 업무).
    // 분석의 «재접촉·재신청 대상» = followUps(D+180 · D+365). 이름만 같았지 다른 물건이라 갈랐다.
    expect(analysis).toContain("재접촉·재신청 대상");
    expect(analysis).not.toContain("오늘 할 일");
  });

  it("홈에서 분석 화면으로 돌아갈 길이 있다", () => {
    const shortcuts = read(path.join(SRC, "lib", "dash", "today-view.ts"));
    expect(shortcuts).toContain('href: "/dash"');
  });
});

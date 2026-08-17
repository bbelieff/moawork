import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// BBE-186 수용기준 3 — «과잉 위젯 홈 잔존 0 · 이동된 분석 화면 기능 손실 0» 을 **기계가 잰다.**
//
// 왜 소스를 읽는가: 두 페이지는 세션·DB 를 잡는 async 서버 컴포넌트라 렌더로는 이 성질을
// 못 잰다. 반면 «홈에 이 위젯이 다시 붙었는가 / 분석 화면에서 빠졌는가» 는 소스에 그대로 있다.
//
// 이 테스트가 빨개지는 조건 — 둘 다 실제 회귀다:
//  ① 누가 분석 위젯을 홈에 되돌려 붙인다      → 홈 우선순위가 다시 밀린다
//  ② 누가 분석 화면에서 위젯을 지운다          → 옮긴 게 아니라 사라진 것이 된다
//  ③ 홈이 무거운 분석 로더를 다시 부른다        → 홈이 다시 느려지고 §5 로컬 경로가 다시 500 이 된다

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => fs.readFileSync(path.join(here, relative), "utf8");

const home = read("page.tsx");
const analysis = read("dash/page.tsx");

/** 홈에서 /dash 로 옮긴 것들. 옮김의 정의 = 홈에 없고 분석 화면에 있다. */
const MOVED = [
  "PipelineWidget",
  "ConversionWidget",
  "ContractStatusWidget",
  "SettlementWidget",
  "ReContactWidget",
  "FollowUpListWidget",
  "StatCard",
  "RecentNotices",
  "DashboardSourceSummary",
  "ChecklistCompletionCell",
  "loadDashboardPageData",
] as const;

/** 홈에 남는 것 — V6 계약 그대로 넷. */
const HOME_ONLY = ["TodayHome", "loadTodayHome"] as const;

describe("BBE-186 · 홈에서 분석 화면으로의 이동", () => {
  it("옮긴 위젯이 홈에 하나도 남아 있지 않다", () => {
    const leftover = MOVED.filter((symbol) => home.includes(symbol));
    expect(leftover).toEqual([]);
  });

  it("옮긴 위젯이 분석 화면에 하나도 빠짐없이 있다", () => {
    const missing = MOVED.filter((symbol) => !analysis.includes(symbol));
    expect(missing).toEqual([]);
  });

  it("홈은 오늘 read model 만 부른다", () => {
    for (const symbol of HOME_ONLY) expect(home).toContain(symbol);
  });

  it("분석 화면이 옮겨 온 드릴다운 주소를 그대로 유지한다", () => {
    // 홈에서 이 주소들을 없앴으므로, 여기서 끊기면 목록 화면이 어디에서도 안 열린다.
    for (const href of ["/dash/all", "/companies", "/dash/all?range=month", "/deals/"]) {
      expect(analysis).toContain(href);
    }
  });

  it("홈에서 분석 화면으로 돌아갈 길이 있다", () => {
    const shortcuts = read("../../lib/dash/today-view.ts");
    expect(shortcuts).toContain('href: "/dash"');
  });
});

// T04 · core.dash 배럴.
//
// 소비 규칙: 화면(Server Component)은 buildDashboard(ctx) 만 호출하면 된다.
// 집계는 전부 순수 함수(aggregate.ts)라 단위 테스트 가능하며, 저장하지 않는다(이중저장 금지).

export * from "./types";
export * from "./aggregate";
export * from "./format";
export { buildDashboard, currentMonthKst } from "./service";
export type { DashboardData, BuildOptions } from "./service";

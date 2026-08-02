// T07 · mod.perf 배럴.
//
// 소비 규칙: 화면(Server Component)은 buildPerf(ctx) 만 호출하면 된다.
// 집계는 전부 순수 함수(aggregate.ts)라 단위 테스트 가능하며, 저장하지 않는다(이중저장 금지).
// 표시 포맷터는 T04 core.dash(@/lib/dash/format)를 그대로 쓴다 — 재정의하지 않는다.

export * from "./types";
export * from "./aggregate";
export * from "./incentive";
export { buildSnapshotRows, previousMonthKst, type SnapshotRow } from "./snapshot";
export {
  InMemoryPerfStore,
  getPerfStore,
  snapshotKey,
  type PerfStore,
} from "./store";
export {
  buildPerf,
  getLeaderboard,
  getMonthlyContractCompanies,
  listSnapshots,
  recomputeSnapshots,
  currentMonthKst,
} from "./service";
export type { PerfData, PerfOptions, RecomputeResult } from "./service";

import { formatCount, formatKrw } from "@/lib/dash/format";
import type {
  DashboardBoardsData,
  DashboardLedgerData,
  DashboardSegment,
} from "@/lib/dash/server";
import { StatCard } from "./widgets";

/**
 * 조회 실패 배너 (BBE-208).
 *
 * ★ 이 부품은 «실패만» 표현한다 — 성공 모양이 없다. 그래서 role 은 고정 alert 이 맞다.
 *   판정에 따라 갈리는 배너(ResultBanner)와 다른 종류다. 「불러오지 못함」을 status 로
 *   두면 보조기술 사용자는 그 사실을 놓친다 — 실제로 /dash 에서 렌더되는 살아 있는 경로다.
 */
export function DashboardUnavailable({ label }: { label: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      {label} 데이터를 불러오지 못함
    </div>
  );
}

export function DashboardSourceSummary({
  boards,
  ledger,
}: {
  boards: DashboardSegment<DashboardBoardsData>;
  ledger: DashboardSegment<DashboardLedgerData>;
}) {
  return (
    <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {boards.status === "ready" ? (
        <>
          <StatCard label="보드" value={formatCount(boards.data.boardCount)} href="/boards" />
          <StatCard label="보드 아이템" value={formatCount(boards.data.itemCount)} href="/boards" />
        </>
      ) : (
        <div className="col-span-2"><DashboardUnavailable label="보드" /></div>
      )}
      {ledger.status === "ready" ? (
        <>
          <StatCard label="원장 항목" value={formatCount(ledger.data.entryCount)} href="/settlements" />
          <StatCard label="원장 예상 수수료" value={formatKrw(ledger.data.expectedFeeTotal)} href="/settlements" />
        </>
      ) : (
        <div className="col-span-2"><DashboardUnavailable label="원장" /></div>
      )}
    </section>
  );
}

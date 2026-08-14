import { formatCount, formatKrw } from "@/lib/dash/format";
import type {
  DashboardBoardsData,
  DashboardLedgerData,
  DashboardSegment,
} from "@/lib/dash/server";
import { StatCard } from "./widgets";

export function DashboardUnavailable({ label }: { label: string }) {
  return (
    <div
      role="status"
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

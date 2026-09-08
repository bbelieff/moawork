import Link from "next/link";
import { formatCount, formatKrw, formatMonth } from "@/lib/dash/format";
import type { MemberScope } from "@/lib/types";
import type { MonthlyContractCompanies } from "@/lib/perf/types";

function adjacentMonth(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function paidDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" }).format(new Date(value));
}

export function MonthlyContractCompaniesPage({ data, scope }: { data: MonthlyContractCompanies; scope: MemberScope }) {
  const totals = data.entries.reduce((sum, row) => ({
    deals: sum.deals + row.dealCount,
    exec: sum.exec + row.execSum,
    fees: sum.fees + row.feeSum,
  }), { deals: 0, exec: 0, fees: 0 });
  return (
    <div className="flex flex-col gap-[var(--sp-4)]">
      <header className="flex flex-wrap items-end justify-between gap-[var(--sp-3)]">
        <div>
          <p className="text-[length:var(--fs-12)] font-medium text-[var(--mw-primary)]">계약 후 · 월별 수납 현황</p>
          <h1 className="mt-1 text-[length:var(--fs-22)] font-semibold text-[var(--mw-t-1)]">이달의 계약회사</h1>
          <p className="mt-1 text-[length:var(--fs-13)] text-[var(--mw-t-3)]">
            수수료 입금일 기준입니다. {scope === "assigned" ? "내 담당 회사만 표시합니다." : "조직 전체 회사를 표시합니다."}
          </p>
        </div>
        <nav aria-label="조회 월" className="flex items-center gap-2">
          <Link className="inline-flex min-h-11 items-center rounded-[var(--mw-r-1)] border border-[var(--mw-bd)] px-3 text-sm" href={`/dash/top-companies?month=${adjacentMonth(data.period, -1)}`}>이전 달</Link>
          <span className="min-w-28 text-center font-semibold tabular-nums">{formatMonth(data.period)}</span>
          <Link className="inline-flex min-h-11 items-center rounded-[var(--mw-r-1)] border border-[var(--mw-bd)] px-3 text-sm" href={`/dash/top-companies?month=${adjacentMonth(data.period, 1)}`}>다음 달</Link>
        </nav>
      </header>

      {!data.available ? (
        <section className="rounded-[var(--mw-r-2)] border border-[var(--mw-bd)] bg-[var(--mw-s-1)] px-6 py-14 text-center">
          <h2 className="font-semibold text-[var(--mw-t-1)]">이 달에 수납된 계약이 없습니다</h2>
          <p className="mt-2 text-sm text-[var(--mw-t-3)]">다른 달을 선택하거나 회계 원장에서 수납일을 확인해 주세요.</p>
          <Link className="mt-5 inline-flex min-h-11 items-center rounded-[var(--mw-r-1)] bg-[var(--mw-primary)] px-4 text-sm font-medium text-[var(--mw-on-accent)]" href="/ledger">회계 원장 보기</Link>
        </section>
      ) : (
        <>
          <section aria-label="월 합계" className="grid gap-3 sm:grid-cols-3">
            {[["수납건수", `${formatCount(totals.deals)}건`], ["실행액", formatKrw(totals.exec)], ["수수료합", formatKrw(totals.fees)]].map(([label, value]) => (
              <div key={label} className="rounded-[var(--mw-r-2)] border border-[var(--mw-bd)] bg-[var(--mw-s-1)] p-4"><p className="text-xs text-[var(--mw-t-3)]">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>
            ))}
          </section>
          <section className="overflow-hidden rounded-[var(--mw-r-2)] border border-[var(--mw-bd)] bg-[var(--mw-s-1)]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] border-collapse text-sm">
                <caption className="sr-only">{formatMonth(data.period)} 계약회사 수납 순위</caption>
                <thead className="bg-[var(--mw-s-2)] text-left text-xs text-[var(--mw-t-3)]"><tr><th className="px-4 py-3">순위</th><th className="px-4 py-3">회사</th><th className="px-4 py-3 text-right">최근 수납</th><th className="px-4 py-3 text-right">수납건수</th><th className="px-4 py-3 text-right">실행액</th><th className="px-4 py-3 text-right">수수료합</th></tr></thead>
                <tbody>{data.entries.map((entry, index) => <tr key={entry.companyId ?? "unassigned"} className="border-t border-[var(--mw-bd)]"><td className="px-4 py-3 font-semibold">{index + 1}</td><td className="px-4 py-3 font-medium">{entry.companyId ? <Link className="underline decoration-[var(--mw-bd)] underline-offset-4" href={`/companies/${entry.companyId}`}>{entry.name}</Link> : entry.name}</td><td className="px-4 py-3 text-right tabular-nums">{paidDate(entry.latestPaidAt)}</td><td className="px-4 py-3 text-right tabular-nums">{formatCount(entry.dealCount)}건</td><td className="px-4 py-3 text-right tabular-nums">{formatKrw(entry.execSum)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatKrw(entry.feeSum)}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

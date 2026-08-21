import { DashboardUnavailable } from "@/components/dash/DashboardSourceSummary";
import { formatKrw } from "@/lib/dash/format";
import type { TodayHomeState } from "@/lib/dash/today-server";

/**
 * 「이번달 수납」 — RPC 가 정본이다(BBE-215 (A)).
 *
 * ★ 0 을 «세 상태» 로 가른다. 그냥 0 만 보여주면 「수납이 없다」와 「아무도 입금일을 안 채웠다」가
 *   같은 화면이 된다 — 그건 다른 사실이고, 사용자가 할 일도 다르다.
 *     · 탭이 없다        → missingSources 에 'work'
 *     · 입금일 미입력     → unfilledColumns 에 그 컬럼 이름 (098 이 내보낸다)
 *     · 진짜 0           → 위 둘 다 아님
 */
export function MonthlyCollection({ today }: { today: TodayHomeState }) {
  if (today.kind !== "ready") {
    return <DashboardUnavailable label="이번달 수납" />;
  }
  const { kpis, unfilledColumns, missingSources } = today.snapshot;
  const total = kpis.contractDeposits + kpis.fees;

  if (missingSources.includes("work")) {
    return (
      <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
        계약업체 실무 탭이 아직 없어요. 탭을 만들면 이번 달 수납이 여기에 보여요.
      </p>
    );
  }
  const unfilled = ["contract_deposit_paid_on", "fee_paid_on"].filter((column) =>
    unfilledColumns.includes(column),
  );
  if (total === 0 && unfilled.length > 0) {
    return (
      <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
        입금일이 아직 입력되지 않았어요. 계약업체 실무 탭에서 «계약금 수납일 · 수수료 수납일» 을
        채우면 이번 달 수납이 여기에 보여요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--sp-1)]">
      <p className="text-[length:var(--fs-18)] font-semibold text-[var(--mw-t-1)]">{formatKrw(total)}</p>
      <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
        계약금 {formatKrw(kpis.contractDeposits)} · 수수료 {formatKrw(kpis.fees)}
      </p>
      {total === 0 ? (
        <p className="text-[length:var(--fs-12)] text-[var(--mw-t-3)]">
          이번 달 수납이 아직 없어요.
        </p>
      ) : null}
    </div>
  );
}

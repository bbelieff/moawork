import Link from "next/link";
import { applyAs, getSession } from "@/lib/auth/session";
import { getCrmService } from "@/lib/crm";
import { createRequestCustomService } from "@/lib/custom/server";
import { FeatureGateServer } from "@/components/auth/FeatureGateServer";
import { FEATURES } from "@/lib/product";
import {
  filterDealsByRange,
  monthRangeKst,
  POLICYFUND_FIELD_KEYS,
  toSettlementInputs,
} from "@/lib/dash";
import { currentMonthKst } from "@/lib/dash/service";
import { EMPTY, formatCount, formatKrw, formatMonth } from "@/lib/dash/format";
import type { Deal, FieldDef } from "@/lib/types";

/**
 * 전체 업무 목록 — 대시보드 상단 요약 카드의 드릴다운(BBE-18).
 *
 * "전체 업무"/"이번 달 신규 업무"/"이번달 수납" 세 KPI 가 전부 여기로 온다 —
 * 같은 목록을 쿼리로 좁혀서 보여준다("기간을 바꾸면 전부 다시 계산된다").
 * 담당범위(assigned) 는 repo.listDeals(ctx) 가 적용 — 남의 담당 건은 애초에 안 온다(D24).
 *
 * ⚠ 딜 상세 화면은 core.crm 소유라 여기서는 요약 행만 보여준다
 * (app/(app)/dash/[pipelineId]/page.tsx 의 DealList 와 같은 경계).
 */
export default async function AllDealsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const asParam = typeof sp.as === "string" ? sp.as : undefined;
  const range = sp.range === "month" ? "month" : "all";
  const paidOnly = sp.paid === "1";

  const base = await getSession();
  const ctx = applyAs(base, asParam);

  const custom = await createRequestCustomService();
  const [allDeals, fieldDefs] = await Promise.all([
    getCrmService().listDeals(ctx),
    custom.listFields(ctx.org.id, "deal"),
  ]);

  const month = currentMonthKst();
  const monthRange = monthRangeKst(month);

  let deals: Deal[] = allDeals;
  let title = "전체 업무";
  let subtitle = "담당범위 안의 모든 업무";
  if (range === "month" && paidOnly) {
    const paidDeals = toSettlementInputs(allDeals)
      .filter((e) => e.input.feeDepositDate !== null)
      .filter((e) => {
        const t = e.input.feeDepositDate!.getTime();
        return t >= Date.parse(monthRange.start) && t < Date.parse(monthRange.end);
      })
      .map((e) => e.deal);
    deals = paidDeals;
    title = "이번달 수납";
    subtitle = `수수료입금일이 ${formatMonth(month)}인 업무`;
  } else if (range === "month") {
    deals = filterDealsByRange(allDeals, monthRange);
    title = "이번 달 신규 업무";
    subtitle = `${formatMonth(month)}에 등록된 업무`;
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/" className="hover:underline">
          대시보드
        </Link>
        <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">/</span>
        <span className="text-zinc-700 dark:text-zinc-200">{title}</span>
      </nav>

      <FeatureGateServer orgId={ctx.org.id} feature={FEATURES.dash} label="대시보드">
        <div className="flex flex-col gap-4">
          <header>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-0.5 text-sm text-zinc-500">
              {subtitle} · {formatCount(deals.length)}건
            </p>
          </header>

          {/* 기간을 바꾸면 전부 다시 계산된다 — 같은 목록을 다른 필터로. */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link
              href="/dash/all"
              className={`rounded border px-2 py-1 text-xs ${
                range === "all"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              전체 기간
            </Link>
            <Link
              href="/dash/all?range=month"
              className={`rounded border px-2 py-1 text-xs ${
                range === "month" && !paidOnly
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              이번 달 신규
            </Link>
            <Link
              href="/dash/all?range=month&paid=1"
              className={`rounded border px-2 py-1 text-xs ${
                paidOnly
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              이번 달 수납
            </Link>
          </div>

          <DealList deals={deals} fieldDefs={fieldDefs} />
        </div>
      </FeatureGateServer>
    </div>
  );
}

/** 딜 요약 행 목록. 딜 상세 화면은 core.crm 소유이므로 여기서는 링크하지 않는다. */
function DealList({ deals, fieldDefs }: { deals: Deal[]; fieldDefs: FieldDef[] }) {
  const statusDef = fieldDefs.find(
    (f) => f.entity === "deal" && f.key === POLICYFUND_FIELD_KEYS.contractStatus,
  );
  const labelOf = (d: Deal): string => {
    if (!statusDef?.options_jsonb) return EMPTY;
    const raw = d.custom?.[statusDef.key];
    if (typeof raw !== "string") return EMPTY;
    const opt = statusDef.options_jsonb.options.find(
      (o) => o.id === raw || o.label === raw,
    );
    return opt?.label ?? EMPTY;
  };

  if (deals.length === 0) {
    return (
      <p className="rounded border border-dashed border-zinc-200 p-4 text-sm text-zinc-400 dark:border-zinc-800">
        이 조건에 해당하는 업무가 아직 없어요.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {deals.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span className="text-zinc-800 dark:text-zinc-100">{d.title}</span>
          <span className="flex items-center gap-3 text-xs text-zinc-500">
            <span>{labelOf(d)}</span>
            <span className="tabular-nums">{d.amount === null ? EMPTY : formatKrw(d.amount)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

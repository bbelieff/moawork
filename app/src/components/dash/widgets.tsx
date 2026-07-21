// T04 · core.dash 위젯(프레젠테이션 전용).
//
// 순수 렌더 — 데이터 조회 없음(상위 Server Component 가 buildDashboard 로 주입).
// 모든 위젯은 0건/미가용 상태에서 '—' 또는 0 을 표시한다(NaN·빈화면 금지).

import type { ReactNode } from "react";
import { EMPTY, formatCount, formatKrw, formatPercent } from "@/lib/dash/format";
import type {
  ContractStatusBreakdown,
  ConversionRate,
  PipelineBreakdown,
  ReContactEntry,
  SettlementSummary,
} from "@/lib/dash/types";

/** 상단 고정 요약 카드. */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-400">{hint}</div> : null}
    </div>
  );
}

/** 위젯 컨테이너. */
export function Widget({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** 비율 막대(0~1). */
function Bar({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
      <div className="h-full rounded bg-zinc-900 dark:bg-zinc-100" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 파이프라인 단계별 현황 위젯. */
export function PipelineWidget({ data }: { data: PipelineBreakdown }) {
  if (data.stages.length === 0) {
    return <p className="text-sm text-zinc-400">파이프라인 단계가 없습니다.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {data.stages.map((s) => (
        <div key={s.stageId} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-zinc-700 dark:text-zinc-200">{s.name}</span>
            <span className="tabular-nums text-zinc-500">
              {formatCount(s.count)}건 · {formatPercent(s.ratio)}
            </span>
          </div>
          <Bar ratio={s.ratio} />
        </div>
      ))}
      {data.unassigned > 0 ? (
        <p className="text-xs text-zinc-400">
          단계 미지정 {formatCount(data.unassigned)}건
        </p>
      ) : null}
    </div>
  );
}

/** 전환율 위젯 — 분모/분자를 함께 표기(정의 모호성 제거). */
export function ConversionWidget({ rates }: { rates: ConversionRate[] }) {
  const LABEL: Record<string, string> = {
    marketing: "마케팅",
    meeting: "미팅",
    contract: "계약",
    work: "실행",
    settle: "정산",
    post: "사후관리",
  };
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rates.map((r) => (
        <div key={r.kind} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-zinc-700 dark:text-zinc-200">
              {LABEL[r.kind] ?? r.kind} 도달
            </span>
            <span className="tabular-nums font-medium">{formatPercent(r.rate)}</span>
          </div>
          <Bar ratio={r.rate} />
          <span className="text-xs text-zinc-400 tabular-nums">
            {formatCount(r.reached)} / {formatCount(r.total)}건
          </span>
        </div>
      ))}
    </div>
  );
}

/** 계약상황 분포 위젯 — field_defs 프리셋 기반. */
export function ContractStatusWidget({ data }: { data: ContractStatusBreakdown }) {
  if (!data.available) {
    return (
      <p className="text-sm text-zinc-400">
        {EMPTY} 계약상황 필드가 아직 없습니다{" "}
        <span className="text-zinc-300 dark:text-zinc-600">
          (002 프리셋 로드 후 표시)
        </span>
      </p>
    );
  }
  const shown = data.options.filter((o) => o.count > 0);
  if (shown.length === 0) {
    return <p className="text-sm text-zinc-400">아직 계약상황이 입력된 딜이 없습니다.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {shown.map((o) => (
        <li key={o.optionId} className="flex items-baseline justify-between text-sm">
          <span className="text-zinc-700 dark:text-zinc-200">{o.label}</span>
          <span className="tabular-nums text-zinc-500">
            {formatCount(o.count)}건 · {formatPercent(o.ratio)}
          </span>
        </li>
      ))}
      {data.unset > 0 ? (
        <li className="flex items-baseline justify-between text-sm text-zinc-400">
          <span>미입력</span>
          <span className="tabular-nums">{formatCount(data.unset)}건</span>
        </li>
      ) : null}
    </ul>
  );
}

/** 정산 요약 위젯 — 계약금·수수료·총매출(T09 확정 수식). */
export function SettlementWidget({
  data,
  emptyHint,
}: {
  data: SettlementSummary;
  emptyHint?: string;
}) {
  if (!data.available) {
    return (
      <p className="text-sm text-zinc-400">
        {EMPTY} {emptyHint ?? "정산 데이터가 없습니다."}
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-3 gap-3 text-sm">
      <div>
        <dt className="text-xs text-zinc-500">계약금</dt>
        <dd className="mt-0.5 tabular-nums">{formatKrw(data.downPaymentSum)}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500">수수료</dt>
        <dd className="mt-0.5 tabular-nums">{formatKrw(data.feeSum)}</dd>
      </div>
      <div>
        <dt className="text-xs text-zinc-500">총매출</dt>
        <dd className="mt-0.5 font-semibold tabular-nums">
          {formatKrw(data.totalRevenueSum)}
        </dd>
      </div>
      <div className="col-span-3 text-xs text-zinc-400">
        대상 {formatCount(data.count)}건
      </div>
    </dl>
  );
}

/** 재접촉(D+180) 목록 위젯. */
export function ReContactWidget({ entries }: { entries: ReContactEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-400">이번달 재접촉 대상이 없습니다.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {entries.map((e) => (
        <li key={e.dealId} className="flex items-center justify-between py-2">
          <span className="text-zinc-700 dark:text-zinc-200">{e.title}</span>
          <span className="tabular-nums text-zinc-500">
            D+180 {e.dPlus180 ?? EMPTY}
          </span>
        </li>
      ))}
    </ul>
  );
}

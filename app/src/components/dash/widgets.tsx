// T04 · core.dash 위젯(프레젠테이션 전용).
//
// 순수 렌더 — 데이터 조회 없음(상위 Server Component 가 buildDashboard 로 주입).
// 모든 위젯은 0건/미가용 상태에서 '—' 또는 0 을 표시한다(NaN·빈화면 금지).

import type { ReactNode } from "react";
import Link from "next/link";
import { EMPTY, formatCount, formatKrw, formatPercent } from "@/lib/dash/format";
import { todayKst, type FollowUpEntry } from "@/lib/dash/aggregate";
import { dDayLabel, groupByWeek } from "./date-groups";
import type {
  ContractStatusBreakdown,
  ConversionRate,
  PipelineBreakdown,
  ReContactEntry,
  SettlementSummary,
} from "@/lib/dash/types";

/**
 * 상단 고정 요약 카드.
 *
 * `href` 를 주면 카드 전체가 그 숫자를 만든 목록으로 이동하는 링크가 된다(BBE-18 —
 * "숫자만 있고 못 들어가면 쓸모가 없다"). 안 주면 지금처럼 정적 카드로 남는다
 * (드릴다운 목록이 아직 없는 값 — 예: 합계 금액 — 은 href 없이 둔다).
 */
export function StatCard({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-400">{hint}</div> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-zinc-200 p-4 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
      >
        {body}
      </Link>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">{body}</div>
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
    <section className="rounded-[var(--mw-r-3)] border border-[var(--mw-line)] bg-[var(--mw-card)] p-[var(--sp-4)]">
      <div className="mb-[var(--sp-3)]">
        <h2 className="text-sm font-semibold text-[var(--mw-t-1)]">
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

const clamp01 = (ratio: number) => Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

/** 막대가 차례로 자라나는 간격과 상한 — 전체가 0.9초를 넘지 않게(막대 0.6초 + 지연 최대 0.3초). */
const BAR_STAGGER_MS = 60;
const BAR_STAGGER_MAX_MS = 300;

/**
 * 비율 막대(0~1) — 처음 그려질 때 한 번 왼쪽에서 자라난다(transform 만, CSS 애니메이션).
 * 서버 HTML 에 최종 폭이 그대로 들어 있어 스크립트가 없어도 읽힌다. 움직임 줄이기면 멈춰 있다.
 */
function Bar({ ratio, index = 0 }: { ratio: number; index?: number }) {
  const pct = clamp01(ratio) * 100;
  return (
    <div className="h-[6px] w-full overflow-hidden rounded-full bg-[var(--mw-chart-track)]">
      <div
        data-bar-fill=""
        className="mw-bar-grow h-full rounded-full bg-[var(--mw-record)]"
        style={{ width: `${pct}%`, animationDelay: `${Math.min(index * BAR_STAGGER_MS, BAR_STAGGER_MAX_MS)}ms` }}
      />
    </div>
  );
}

/** 파이프라인 단계별 현황 위젯. */
export function PipelineWidget({ data }: { data: PipelineBreakdown }) {
  if (data.stages.length === 0) {
    return (
      <p className="text-[length:var(--fs-13)] text-[var(--mw-sub)]">
        파이프라인 단계가 아직 없어요. 단계를 만들면 여기에 보여요.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-[var(--sp-3)]">
      {data.stages.map((s, index) => (
        <div key={s.stageId} className="flex flex-col gap-[var(--sp-1)]">
          <div className="flex items-baseline justify-between gap-[var(--sp-2)] text-[length:var(--fs-13)]">
            <span className="text-[var(--mw-body)]">{s.name}</span>
            <span className="tabular-nums text-[var(--mw-sub)]">
              {formatCount(s.count)}건 · {formatPercent(s.ratio)}
            </span>
          </div>
          <Bar ratio={s.ratio} index={index} />
        </div>
      ))}
      {data.unassigned > 0 ? (
        <p className="text-[length:var(--fs-12)] text-[var(--mw-sub)]">
          단계 미지정 {formatCount(data.unassigned)}건
        </p>
      ) : null}
    </div>
  );
}

const CONVERSION_LABEL: Record<string, string> = {
  marketing: "마케팅",
  meeting: "미팅",
  contract: "계약",
  work: "실행",
  settle: "정산",
  post: "사후관리",
};

/**
 * 고리 게이지 — 비율만큼 원을 칠한다(pathLength=100 이라 dasharray 가 곧 퍼센트).
 * 처음 그려질 때 한 번 0 에서 비율까지 돈다. 원은 그림일 뿐이라 숨기고, 숫자는 글자로 둔다.
 */
function RingGauge({ ratio, label }: { ratio: number; label: string }) {
  const pct = clamp01(ratio) * 100;
  return (
    <div className="relative h-[64px] w-[64px] shrink-0">
      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--mw-chart-track)" strokeWidth="4" />
        {pct > 0 ? (
          <circle
            data-ring-arc=""
            className="mw-ring-sweep"
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            stroke="var(--mw-record)"
            strokeWidth="4"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${pct} 100`}
            style={{ ["--mw-ring-from" as string]: `${pct}` }}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[length:var(--fs-12)] font-semibold tabular-nums text-[var(--mw-fg)]">
        {label}
      </span>
    </div>
  );
}

/** 전환율 위젯 — 단계마다 고리 하나. 분모/분자를 함께 표기(정의 모호성 제거). */
export function ConversionWidget({ rates }: { rates: ConversionRate[] }) {
  return (
    <ul className="grid grid-cols-2 gap-[var(--sp-3)] sm:grid-cols-3">
      {rates.map((r) => (
        <li key={r.kind} data-conversion={r.kind} className="flex flex-col items-center gap-[var(--sp-1)] text-center">
          <RingGauge ratio={r.rate} label={formatPercent(r.rate)} />
          <span className="text-[length:var(--fs-13)] text-[var(--mw-body)]">
            {CONVERSION_LABEL[r.kind] ?? r.kind} 도달
          </span>
          <span className="text-[length:var(--fs-12)] tabular-nums text-[var(--mw-sub)]">
            {formatCount(r.reached)} / {formatCount(r.total)}건
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 계약상황 조각 색 — 토큰만(globals.css 의 --mw-chart-*). 다크에서도 토큰이 바뀐다. */
const CHART_COLORS = [
  "var(--mw-chart-1)",
  "var(--mw-chart-2)",
  "var(--mw-chart-3)",
  "var(--mw-chart-4)",
  "var(--mw-chart-5)",
  "var(--mw-chart-6)",
] as const;
const CHART_EMPTY = "var(--mw-chart-empty)";

export interface DonutSlice {
  key: string;
  label: string;
  count: number;
  ratio: number;
  color: string;
}

/** 도넛·범례에 쓰는 조각 — 입력된 계약상황(0건 제외) + 미입력. 비율의 분모는 전체 업무 수다. */
export function contractSlices(data: ContractStatusBreakdown): DonutSlice[] {
  const slices: DonutSlice[] = data.options
    .filter((o) => o.count > 0)
    .map((o, index) => ({
      key: o.optionId,
      label: o.label,
      count: o.count,
      ratio: o.ratio,
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  if (data.unset > 0) {
    slices.push({
      key: "unset",
      label: "미입력",
      count: data.unset,
      ratio: data.total > 0 ? data.unset / data.total : 0,
      color: CHART_EMPTY,
    });
  }
  return slices;
}

/** 계약상황 분포 위젯 — 도넛 + 범례. 범례가 곧 글자 대안이고 도넛 그림은 숨긴다. */
export function ContractStatusWidget({ data }: { data: ContractStatusBreakdown }) {
  if (!data.available) {
    return (
      <p className="text-[length:var(--fs-13)] text-[var(--mw-sub)]">
        {EMPTY} 계약상황을 아직 사용할 수 없어요. 계약상황 항목이 준비되면 여기에 보여요.
      </p>
    );
  }
  if (!data.options.some((o) => o.count > 0)) {
    return (
      <p className="text-[length:var(--fs-13)] text-[var(--mw-sub)]">
        계약상황을 입력한 업무가 아직 없어요. 업무에 계약상황을 입력하면 여기에 보여요.
      </p>
    );
  }
  const slices = contractSlices(data);
  const sum = slices.reduce((acc, slice) => acc + slice.count, 0);
  const arcs = slices.map((slice, index) => {
    const share = sum > 0 ? (slice.count / sum) * 100 : 0;
    const before = slices.slice(0, index).reduce((acc, prev) => acc + (sum > 0 ? (prev.count / sum) * 100 : 0), 0);
    return { slice, share, before };
  });
  return (
    <div className="flex flex-wrap items-center gap-[var(--sp-4)]">
      <div className="mw-pop-in relative h-[120px] w-[120px] shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--mw-chart-track)" strokeWidth="6" />
          {arcs.map(({ slice, share, before }) => (
            <circle
              key={slice.key}
              data-donut-slice={slice.key}
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              stroke={slice.color}
              strokeWidth="6"
              pathLength={100}
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-before}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[length:var(--fs-18)] font-semibold tabular-nums text-[var(--mw-fg)]">
            {formatCount(data.total)}
          </span>
          <span className="text-[length:var(--fs-11)] text-[var(--mw-sub)]">전체 건</span>
        </div>
      </div>
      <ul className="flex min-w-[180px] flex-1 flex-col gap-[var(--sp-2)]" data-donut-legend="">
        {slices.map((slice) => (
          <li key={slice.key} data-legend={slice.key} className="flex items-center gap-[var(--sp-2)] text-[length:var(--fs-13)]">
            <span aria-hidden="true" className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: slice.color }} />
            <span className={slice.key === "unset" ? "text-[var(--mw-sub)]" : "text-[var(--mw-body)]"}>{slice.label}</span>
            <span className="ml-auto tabular-nums text-[var(--mw-sub)]">
              {formatCount(slice.count)}건 · {formatPercent(slice.ratio)}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
        {EMPTY} {emptyHint ?? "정산 정보가 아직 없어요. 실행액과 수수료율을 입력하면 여기에 보여요."}
      </p>
    );
  }

  // 임시 추정(deal.amount 기반)일 때는 총매출만 근사이고 계약금·수수료는 산출 불가.
  if (data.provisional) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            임시
          </span>
          <span className="text-xs text-zinc-500">
            업무 금액으로 계산한 예상값이에요. 실행액과 수수료율을 입력하면 정확한 금액이 보여요.
          </span>
        </div>
        <div>
          <div className="text-xs text-zinc-500">총매출(추정)</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            {formatKrw(data.totalRevenueSum)}
          </div>
        </div>
        <div className="text-xs text-zinc-400">
          대상 {formatCount(data.count)}건 · 계약금·수수료는 실행액·수수료율 입력 후 산출
        </div>
      </div>
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

const FOLLOW_UP_LABEL: Record<FollowUpEntry["kind"], string> = {
  reContact: "재접촉",
  reapply: "재신청 안내",
};

/**
 * 「오늘 할 일」 — 재접촉(D+180)·재신청 안내(D+365) (BBE-18).
 * D26: 이 목록은 보는 사람의 담당범위로 이미 걸러진 채로 들어온다(호출부 buildFollowUps).
 * 사람마다 다른 목록이 나오는 이유가 여기 있는 게 아니라 그 상위(ctx)에 있다.
 */
export function FollowUpListWidget({
  entries,
  emptyHint,
}: {
  entries: FollowUpEntry[];
  emptyHint: string;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-400">{emptyHint}</p>;
  }
  return (
    <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {entries.map((e) => (
        <li
          key={`${e.kind}-${e.dealId}`}
          className="flex items-center justify-between gap-2 py-2"
        >
          <span className="truncate text-[var(--mw-t-1)]">{e.title}</span>
          <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {FOLLOW_UP_LABEL[e.kind]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 재접촉(D+180) 목록 위젯 — 이번 주 / 다음 주 / 그 뒤 / 날짜 없음으로 묶는다(KST).
 * `today` 를 안 주면 지금 KST 날짜를 쓴다(서버 컴포넌트에서 그려지므로 하이드레이션 차이는 없다).
 */
export function ReContactWidget({ entries, today = todayKst() }: { entries: ReContactEntry[]; today?: string }) {
  if (entries.length === 0) {
    return (
      <p className="text-[length:var(--fs-13)] text-[var(--mw-sub)]">
        이번 달에 재접촉할 업무가 없어요. 재접촉 날짜가 다가오면 여기에 보여요.
      </p>
    );
  }
  const groups = groupByWeek(entries, (e) => e.dPlus180, today);
  const thisWeek = groups.find((group) => group.key === "this-week")?.items.length ?? 0;
  return (
    <div className="flex flex-col gap-[var(--sp-2)]">
      <p className="flex justify-end">
        <span
          data-recontact-badge=""
          className="rounded-[var(--mw-r-1)] bg-[var(--mw-tint-blue)] px-[var(--sp-2)] py-[2px] text-[length:var(--fs-12)] font-semibold tabular-nums text-[var(--mw-record)]"
        >
          이번 주 {formatCount(thisWeek)}곳
        </span>
      </p>
      <div className="max-h-[calc(var(--mw-row-h-loose)*8)] overflow-auto">
        {groups.map((group) => (
          <section key={group.key} data-recontact-group={group.key}>
            <h3 className="sticky top-0 z-[1] flex items-baseline gap-[var(--sp-1)] border-b border-[var(--mw-line)] bg-[var(--mw-card)] py-[var(--sp-1)] text-[length:var(--fs-12)] font-semibold text-[var(--mw-body)]">
              {group.label}
              <span className="font-normal tabular-nums text-[var(--mw-sub)]">{formatCount(group.items.length)}곳</span>
            </h3>
            <ul className="text-[length:var(--fs-13)]">
              {group.items.map((e) => (
                <li
                  key={e.dealId}
                  className="flex items-center gap-[var(--sp-2)] border-b border-[var(--mw-line)] py-[var(--sp-2)] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--mw-body)]">{e.title}</span>
                  <span className="shrink-0 text-[length:var(--fs-12)] tabular-nums text-[var(--mw-sub)]">
                    {e.dPlus180 ?? EMPTY}
                  </span>
                  {e.dPlus180 ? (
                    <span
                      data-dday=""
                      className={`shrink-0 rounded-[var(--mw-r-1)] px-[var(--sp-1)] py-[2px] text-[length:var(--fs-11)] font-semibold tabular-nums ${
                        e.dPlus180 <= today
                          ? "bg-[var(--mw-badge-reject-bg)] text-[var(--mw-badge-reject-fg)]"
                          : "bg-[var(--mw-badge-neutral-bg)] text-[var(--mw-badge-neutral-fg)]"
                      }`}
                    >
                      {dDayLabel(e.dPlus180, today)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  buildBoardSummaryModel,
  type BoardSummaryCoverage,
  type BoardSummaryMetricConfig,
  type BoardSummaryMetricResult,
  type BoardSummaryScope,
} from "@/lib/boards/summary";

export type BoardSummaryValueFormatter = (
  value: number,
  type: "number" | "money",
) => string;

function metricText(
  metric: BoardSummaryMetricResult,
  rowCount: number,
  formatValue: BoardSummaryValueFormatter,
): { compact: string; full: string } {
  if (metric.status === "unavailable") {
    const reason = metric.reason === "coverage-failed"
      ? "조회 실패"
      : metric.reason === "hidden-column"
        ? "요약 숨김"
        : metric.reason === "missing-column"
          ? "컬럼 없음"
          : "지원하지 않는 형식";
    return { compact: `${metric.label} · ${reason}`, full: `${metric.label}: ${reason}` };
  }

  if (metric.kind === "sum") {
    if (rowCount === 0) return { compact: `${metric.label} · 데이터 없음`, full: `${metric.label}: 데이터 없음` };
    const value = formatValue(metric.total, metric.valueType);
    const excluded = metric.excludedCount > 0 ? ` · 일부 값 제외 ${metric.excludedCount}건` : "";
    return { compact: `${metric.label} ${value}${excluded}`, full: `${metric.label}: ${value}${excluded}` };
  }

  if (metric.buckets.length === 0) {
    return { compact: `${metric.label} · 데이터 없음`, full: `${metric.label}: 데이터 없음` };
  }
  const fullBuckets = metric.buckets.map((bucket) => `${bucket.label} ${bucket.count}`).join(" · ");
  const visible = metric.buckets.slice(0, 2).map((bucket) => `${bucket.label} ${bucket.count}`).join(" · ");
  const rest = metric.buckets.length > 2 ? ` · 외 ${metric.buckets.length - 2}종` : "";
  return { compact: `${metric.label} ${visible}${rest}`, full: `${metric.label}: ${fullBuckets}` };
}

export function BoardSummaryStrip({
  config,
  columns,
  rows,
  coverage,
  scope,
  formatValue,
  settings,
}: {
  /** Board-shared ordered configuration; the domain enforces maximum three. */
  config: readonly BoardSummaryMetricConfig[];
  columns: readonly BoardColumn[];
  /** Rows already scoped to this group and the active filter/saved view. */
  rows: readonly ItemWithValues[];
  coverage: BoardSummaryCoverage;
  scope: BoardSummaryScope;
  /** Issue #603 adapter seam. This leaf never formats persisted/raw values itself. */
  formatValue: BoardSummaryValueFormatter;
  /** Durable settings integration is supplied by the owning integration card. */
  settings: ReactNode;
}) {
  const model = buildBoardSummaryModel({ config, columns, rows, coverage, scope });
  const coverageLabel = coverage.state === "failed"
    ? "요약 조회 실패"
    : coverage.state === "partial"
      ? "일부 데이터 기준"
      : null;
  const coverageMessage = coverage.state === "complete" ? undefined : coverage.message;

  return (
    <div
      data-board-summary-strip
      aria-label="그룹 한줄 요약"
      aria-live="polite"
      className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 overflow-hidden whitespace-nowrap text-[0.68rem] text-mw-sub"
    >
      <span data-summary-scope className="shrink-0 font-medium text-mw-sub">{model.scopeLabel}</span>
      {coverageLabel ? (
        <span
          role={coverage.state === "failed" ? "alert" : "status"}
          title={coverageMessage}
          className="shrink-0 rounded-full border border-mw-line bg-mw-bg px-2 py-0.5 font-semibold text-mw-body"
        >
          {coverageLabel}
        </span>
      ) : null}
      <div data-summary-metrics className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-2 overflow-hidden">
        {model.metrics.map((metric) => {
          const text = metricText(metric, model.rowCount, formatValue);
          return (
            <span
              key={metric.config.id}
              data-summary-metric={metric.config.id}
              title={text.full}
              className="min-w-0 max-w-56 truncate rounded-full bg-mw-card px-2 py-0.5 text-mw-body"
            >
              {text.compact}
            </span>
          );
        })}
      </div>
      <div data-summary-settings className="shrink-0">{settings}</div>
    </div>
  );
}

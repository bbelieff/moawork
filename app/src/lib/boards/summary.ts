import type { BoardColumn, ItemWithValues } from "./types";

export type BoardSummaryMetricKind = "distribution" | "sum";

export interface BoardSummaryMetricConfig {
  /** Stable UI identity. Persistence is owned by the integration card. */
  id: string;
  kind: BoardSummaryMetricKind;
  columnKey: string;
}

export type BoardSummaryCoverage =
  | { state: "complete" }
  | { state: "partial"; message?: string }
  | { state: "failed"; message?: string };

export type BoardSummaryScope =
  | { kind: "all"; totalCount?: number }
  | { kind: "filtered"; totalCount?: number }
  | { kind: "saved-view"; totalCount?: number };

export interface BoardSummaryDistributionBucket {
  id: string;
  label: string;
  count: number;
  kind: "option" | "empty" | "unknown";
}

interface BoardSummaryBaseResult {
  config: BoardSummaryMetricConfig;
  label: string;
}

export type BoardSummaryMetricResult =
  | (BoardSummaryBaseResult & {
      status: "ready";
      kind: "distribution";
      buckets: BoardSummaryDistributionBucket[];
    })
  | (BoardSummaryBaseResult & {
      status: "ready";
      kind: "sum";
      valueType: "number" | "money";
      total: number;
      excludedCount: number;
    })
  | (BoardSummaryBaseResult & {
      status: "unavailable";
      reason: "coverage-failed" | "missing-column" | "hidden-column" | "unsupported-type";
    });

export interface BoardSummaryModel {
  coverage: BoardSummaryCoverage;
  scopeLabel: string;
  rowCount: number;
  metrics: BoardSummaryMetricResult[];
}

const EMPTY_BUCKET_ID = "__empty__";
const UNKNOWN_BUCKET_ID = "__unknown__";

/** Ordered, duplicate-free, maximum-three board-shared configuration. */
export function normalizeBoardSummaryConfig(
  config: readonly BoardSummaryMetricConfig[],
): BoardSummaryMetricConfig[] {
  const seen = new Set<string>();
  const normalized: BoardSummaryMetricConfig[] = [];
  for (const metric of config) {
    if (!metric.id || !metric.columnKey) continue;
    const identity = `${metric.kind}:${metric.columnKey}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    normalized.push({ ...metric });
    if (normalized.length === 3) break;
  }
  return normalized;
}

export function boardSummaryScopeLabel(
  scope: BoardSummaryScope,
  rowCount: number,
): string {
  if (scope.kind === "all") return `전체 · ${rowCount}건`;
  const prefix = scope.kind === "filtered" ? "필터 결과" : "현재 뷰";
  return typeof scope.totalCount === "number" && scope.totalCount >= rowCount
    ? `${prefix} · ${rowCount}/${scope.totalCount}건`
    : `${prefix} · ${rowCount}건`;
}

function failedScopeLabel(scope: BoardSummaryScope): string {
  const prefix = scope.kind === "all" ? "전체" : scope.kind === "filtered" ? "필터 결과" : "현재 뷰";
  return `${prefix} · 건수 확인 불가`;
}

function unavailable(
  config: BoardSummaryMetricConfig,
  label: string,
  reason: Extract<BoardSummaryMetricResult, { status: "unavailable" }>["reason"],
): BoardSummaryMetricResult {
  return { config, label, status: "unavailable", reason };
}

function distribution(
  config: BoardSummaryMetricConfig,
  column: BoardColumn,
  rows: readonly ItemWithValues[],
): BoardSummaryMetricResult {
  if (column.type !== "select" && column.type !== "status") {
    return unavailable(config, column.label, "unsupported-type");
  }

  const options = column.options_jsonb?.options ?? [];
  const known = new Map(options.map((option) => [option.id, option.label]));
  const counts = new Map<string, number>();
  let emptyCount = 0;
  let unknownCount = 0;

  for (const row of rows) {
    const value = row.values[column.key];
    if (value === null || value === undefined || value === "") {
      emptyCount += 1;
      continue;
    }
    if (typeof value !== "string" || !known.has(value)) {
      unknownCount += 1;
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const buckets: BoardSummaryDistributionBucket[] = options
    .filter((option) => (counts.get(option.id) ?? 0) > 0)
    .map((option) => ({
      id: option.id,
      label: option.label,
      count: counts.get(option.id) ?? 0,
      kind: "option" as const,
    }));
  if (emptyCount > 0) buckets.push({ id: EMPTY_BUCKET_ID, label: "미입력", count: emptyCount, kind: "empty" });
  if (unknownCount > 0) buckets.push({ id: UNKNOWN_BUCKET_ID, label: "알 수 없음", count: unknownCount, kind: "unknown" });

  return { config, label: column.label, status: "ready", kind: "distribution", buckets };
}

function sum(
  config: BoardSummaryMetricConfig,
  column: BoardColumn,
  rows: readonly ItemWithValues[],
): BoardSummaryMetricResult {
  if (column.type !== "number" && column.type !== "money") {
    return unavailable(config, column.label, "unsupported-type");
  }

  let total = 0;
  let excludedCount = 0;
  for (const row of rows) {
    const value = row.values[column.key];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      excludedCount += 1;
      continue;
    }
    const next = total + value;
    if (!Number.isFinite(next)) {
      excludedCount += 1;
      continue;
    }
    total = next;
  }

  return {
    config,
    label: column.label,
    status: "ready",
    kind: "sum",
    valueType: column.type,
    total,
    excludedCount,
  };
}

export function buildBoardSummaryModel({
  config,
  columns,
  rows,
  coverage,
  scope,
}: {
  config: readonly BoardSummaryMetricConfig[];
  columns: readonly BoardColumn[];
  rows: readonly ItemWithValues[];
  coverage: BoardSummaryCoverage;
  scope: BoardSummaryScope;
}): BoardSummaryModel {
  const normalized = normalizeBoardSummaryConfig(config);
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const metrics = normalized.map((metric): BoardSummaryMetricResult => {
    const column = byKey.get(metric.columnKey);
    if (!column) return unavailable(metric, metric.columnKey, "missing-column");
    if (column.summary_hidden) return unavailable(metric, column.label, "hidden-column");
    if (coverage.state === "failed") return unavailable(metric, column.label, "coverage-failed");
    return metric.kind === "distribution"
      ? distribution(metric, column, rows)
      : sum(metric, column, rows);
  });

  return {
    coverage,
    scopeLabel: coverage.state === "failed" ? failedScopeLabel(scope) : boardSummaryScopeLabel(scope, rows.length),
    rowCount: rows.length,
    metrics,
  };
}

export function boardSummaryCandidates(
  columns: readonly BoardColumn[],
  config: readonly BoardSummaryMetricConfig[],
): Array<{ kind: BoardSummaryMetricKind; columnKey: string; label: string; valueType: "number" | "money" | null }> {
  const selected = new Set(normalizeBoardSummaryConfig(config).map((metric) => `${metric.kind}:${metric.columnKey}`));
  return columns.flatMap((column) => {
    if (column.summary_hidden) return [];
    const kind = column.type === "select" || column.type === "status"
      ? "distribution" as const
      : column.type === "number" || column.type === "money"
        ? "sum" as const
        : null;
    if (!kind || selected.has(`${kind}:${column.key}`)) return [];
    return [{
      kind,
      columnKey: column.key,
      label: column.label,
      valueType: column.type === "number" || column.type === "money" ? column.type : null,
    }];
  });
}

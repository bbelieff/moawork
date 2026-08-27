import type { BoardColumn } from "./types";
import type { BoardSummaryMetricConfig } from "./summary";

export type BoardSummarySettingsIntent =
  | { type: "add"; metric: BoardSummaryMetricConfig }
  | { type: "remove"; metricId: string }
  | { type: "move"; metricId: string; direction: -1 | 1 };

export interface BoardSummarySettingsRequest {
  requestId: string;
  intent: BoardSummarySettingsIntent;
}

export interface BoardSummarySettingsReceipt {
  config: BoardSummaryMetricConfig[];
  replayed: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function metric(value: unknown): BoardSummaryMetricConfig {
  if (!record(value) || !exactKeys(value, ["id", "kind", "columnKey"])) {
    throw new Error("요약 지표 형식을 다시 확인해 주세요.");
  }
  if (!nonEmpty(value.id) || !nonEmpty(value.columnKey) || (value.kind !== "distribution" && value.kind !== "sum")) {
    throw new Error("요약 지표 형식을 다시 확인해 주세요.");
  }
  return { id: value.id, kind: value.kind, columnKey: value.columnKey };
}

export function parseBoardSummaryConfig(value: unknown): BoardSummaryMetricConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) throw new Error("저장된 요약 설정을 확인할 수 없습니다.");
  const parsed = value.map(metric);
  const ids = new Set(parsed.map((entry) => entry.id));
  const targets = new Set(parsed.map((entry) => `${entry.kind}:${entry.columnKey}`));
  if (ids.size !== parsed.length || targets.size !== parsed.length) {
    throw new Error("저장된 요약 설정에 중복 지표가 있습니다.");
  }
  return parsed;
}

export function parseBoardSummarySettingsRequest(value: unknown): BoardSummarySettingsRequest {
  if (!record(value) || !exactKeys(value, ["requestId", "intent"]) || !nonEmpty(value.requestId) || !UUID.test(value.requestId)) {
    throw new Error("요약 설정 요청을 다시 확인해 주세요.");
  }
  const intent = value.intent;
  if (!record(intent) || typeof intent.type !== "string") throw new Error("요약 설정 요청을 다시 확인해 주세요.");
  if (intent.type === "add" && exactKeys(intent, ["type", "metric"])) {
    return { requestId: value.requestId, intent: { type: "add", metric: metric(intent.metric) } };
  }
  if (intent.type === "remove" && exactKeys(intent, ["type", "metricId"]) && nonEmpty(intent.metricId)) {
    return { requestId: value.requestId, intent: { type: "remove", metricId: intent.metricId } };
  }
  if (intent.type === "move" && exactKeys(intent, ["type", "metricId", "direction"])
    && nonEmpty(intent.metricId) && (intent.direction === -1 || intent.direction === 1)) {
    return { requestId: value.requestId, intent: { type: "move", metricId: intent.metricId, direction: intent.direction } };
  }
  throw new Error("요약 설정 요청을 다시 확인해 주세요.");
}

export function validateBoardSummaryTargets(
  config: readonly BoardSummaryMetricConfig[],
  columns: readonly BoardColumn[],
): void {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  for (const entry of config) {
    const column = byKey.get(entry.columnKey);
    const expected = entry.kind === "distribution" ? ["select", "status"] : ["number", "money"];
    if (!column || column.archived_at || column.summary_hidden || !expected.includes(column.type)) {
      throw new Error("요약에 사용할 수 없는 컬럼입니다.");
    }
  }
}

export function applyBoardSummarySettingsIntent(
  currentValue: unknown,
  requestValue: unknown,
  columns: readonly BoardColumn[],
): BoardSummaryMetricConfig[] {
  const current = parseBoardSummaryConfig(currentValue);
  const { intent } = parseBoardSummarySettingsRequest(requestValue);
  let next: BoardSummaryMetricConfig[];
  if (intent.type === "add") {
    if (current.length >= 3) throw new Error("요약 지표는 최대 3개까지 표시할 수 있습니다.");
    validateBoardSummaryTargets([intent.metric], columns);
    next = [...current, intent.metric];
  } else {
    const index = current.findIndex((entry) => entry.id === intent.metricId);
    if (index < 0) throw new Error("변경할 요약 지표를 찾을 수 없습니다.");
    if (intent.type === "remove") next = current.filter((_, at) => at !== index);
    else {
      // Moving an unavailable target is ambiguous. Keep it in place until the
      // user removes it; eligible metrics remain reorderable around stale ones.
      validateBoardSummaryTargets([current[index]], columns);
      const target = index + intent.direction;
      if (target < 0 || target >= current.length) throw new Error("요약 지표 순서를 바꿀 수 없습니다.");
      next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
    }
  }
  next = parseBoardSummaryConfig(next);
  return next;
}

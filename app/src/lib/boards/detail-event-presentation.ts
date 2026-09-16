import type { BoardColumn, CellValue } from "./types";
import { formatCell } from "./cells";

export type DetailHistoryEvent = {
  kind: string;
  body: string;
  created_at: string;
  metadata?: unknown;
};
export type DetailHistoryContext = {
  columns: readonly Pick<BoardColumn, "key" | "label" | "type" | "options_jsonb">[];
  members: readonly { id: string; name: string | null }[];
  itemCreatedAt: string;
};
export type DetailHistoryPresentation = { body: string; important: boolean };
const SYSTEM_KEYS = new Set(["updated_at", "created_at", "sort_order", "row_order_version", "request_id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty = (value: unknown) => value == null || value === "" || (Array.isArray(value) && value.length === 0);

// PostgreSQL now() is transaction-stable. Match the full microsecond timestamp,
// never a broad time window: later first fills must remain visible.
function transactionTime(value: string): string | null {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] ?? "";
  return `${Math.floor(time / 1000)}:${fraction.padEnd(6, "0")}`;
}
function sameValue(before: unknown, after: unknown): boolean {
  if (empty(before) && empty(after)) return true;
  if (Array.isArray(before) && Array.isArray(after)) {
    return before.length === after.length && before.every((value, index) => sameValue(value, after[index]));
  }
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  return before === after;
}
function valueLabel(value: unknown, column: DetailHistoryContext["columns"][number], members: DetailHistoryContext["members"]): string {
  if (empty(value)) return "미입력";
  if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object") return valueLabel(parsed, column, members);
    } catch { /* Ordinary user text is not JSON. */ }
  }
  if (column.type === "person" || column.type === "people") {
    return (Array.isArray(value) ? value : [value]).map((id) => members.find((member) => member.id === id)?.name?.trim() || "이름 확인 불가").join(", ");
  }
  if (column.type === "checkbox") return value === true ? "체크" : value === false ? "해제" : "값 확인 불가";
  if (["select", "multiselect", "status"].includes(column.type)) {
    return (Array.isArray(value) ? value : [value]).map((entry) => {
      const option = column.options_jsonb?.options.find((candidate) => candidate.id === entry);
      return option?.label ?? (typeof entry === "string" && !UUID.test(entry) ? entry : "삭제된 선택지");
    }).join(", ");
  }
  // Never dump arbitrary JSON, storage tokens or unresolved identifiers into the feed.
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === "string" || typeof entry === "number")) return value.map((entry) => typeof entry === "string" && UUID.test(entry) ? "연결 항목" : String(entry)).join(", ");
    return `정보 ${value.length}건`;
  }
  if (typeof value === "object") return "복합 정보";
  if (typeof value === "string" && UUID.test(value)) return "연결 항목";
  return formatCell(column.type, value as CellValue, column.options_jsonb?.options) || "미입력";
}

/** Presentation only: full history keeps every authorized row and mutation permissions. */
export function presentDetailHistoryEvent(event: DetailHistoryEvent, context: DetailHistoryContext): DetailHistoryPresentation {
  if (event.kind !== "field_change") return { body: event.body, important: true };
  const metadata = event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown> : null;
  const key = typeof metadata?.column_key === "string" ? metadata.column_key : null;
  const column = context.columns.find((candidate) => candidate.key === key);
  if (!metadata || !column || !Object.hasOwn(metadata, "before") || !Object.hasOwn(metadata, "after")) {
    return { body: "항목 변경 · 상세 내용 확인 불가", important: false };
  }
  const { before, after } = metadata;
  const created = transactionTime(context.itemCreatedAt);
  const initial = empty(before) && created !== null && transactionTime(event.created_at) === created;
  const unchanged = sameValue(before, after);
  const label = column.label.trim() || "항목";
  const beforeLabel = valueLabel(before, column, context.members);
  const afterLabel = valueLabel(after, column, context.members);
  return {
    body: `${label}: ${beforeLabel} → ${afterLabel}${initial ? " (최초 입력)" : ""}`,
    important: !initial && !unchanged && beforeLabel !== afterLabel && !SYSTEM_KEYS.has(key!) && column.type !== "calc",
  };
}

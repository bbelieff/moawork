import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

/** V17 display aliases only. Persisted IDs and transition rules remain unchanged. */
export const NEW_LEAD_STAGE_LABELS = ["통화대기", "부재", "재통화", "통화완료"] as const;
const ALIASES: Readonly<Record<string, string>> = {
  "상담 전": "통화대기",
  "1차 부재": "부재",
  "2차 상담예약": "재통화",
  "2차 상담완료": "통화완료",
};

export function newLeadStageLabel(value: string): string {
  return ALIASES[value] ?? value;
}

export function presentNewLeadStageColumn(column: BoardColumn): BoardColumn {
  if (column.key !== "consult_status" && column.key !== "workflow_progress") return column;
  if (!column.options_jsonb?.options) return column;
  return { ...column, options_jsonb: { ...column.options_jsonb, options: column.options_jsonb.options.map((option) => ({
    ...option,
    // A user-renamed option keeps its own label; aliases apply only to legacy labels.
    label: option.label === option.id ? newLeadStageLabel(option.id) : option.label,
  })) } };
}

export function newLeadStageOf(row: ItemWithValues): string | null {
  const value = row.values.consult_status;
  if (typeof value !== "string") return null;
  const label = newLeadStageLabel(value);
  return NEW_LEAD_STAGE_LABELS.some((stage) => stage === label) ? label : null;
}

/**
 * 서류 체크리스트 완료율 — 표의 셀용 (BBE-110 수용 기준 2).
 *
 * 순수 표시 컴포넌트다. `items` 를 직접 받아 **`completionOf` 한 번만** 불러 계산한다
 * (`ChecklistPanel` 이 상세에서 쓰는 것과 정확히 같은 함수) — 그래서 셀과 상세가 같은 항목을
 * 보고 있는 한 항상 같은 퍼센트를 그린다. 서버 컴포넌트에서도 그대로 써도 되도록
 * "use client" 를 붙이지 않았다(상태 없음·이벤트 없음).
 */

import { completionOf, type ChecklistItem } from "@/lib/policyfund/checklist";

export interface ChecklistCompletionCellProps {
  items: readonly ChecklistItem[];
  /** 표는 좁아서 텍스트를 줄이고 싶을 때. 기본은 "N/M · X%". */
  compact?: boolean;
}

export function ChecklistCompletionCell({ items, compact }: ChecklistCompletionCellProps) {
  const { checked, total, percent } = completionOf(items);

  if (total === 0) {
    return <span className="text-xs text-mw-sub">—</span>;
  }

  const color = percent === 100 ? "var(--mw-success)" : "var(--mw-record)";

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-mw-body" title={`${checked}/${total} 완료`}>
      <span
        aria-hidden="true"
        className="relative h-3.5 w-3.5 shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${color} ${percent * 3.6}deg, var(--mw-line) 0deg)`,
        }}
      />
      {compact ? `${percent}%` : `${checked}/${total} · ${percent}%`}
    </span>
  );
}

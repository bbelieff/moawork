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
  /**
   * 조회 자체를 못 했을 때. «항목이 없다»(—) 와 «확인 못 했다» 는 다른 사실이라 다르게 그린다.
   * 둘을 같은 — 로 그리면 사용자는 체크리스트가 비었다고 오해한다(BBE-203 · §3 거짓 빈 상태 금지).
   */
  unavailable?: boolean;
}

export function ChecklistCompletionCell({ items, compact, unavailable }: ChecklistCompletionCellProps) {
  const { checked, total, percent } = completionOf(items);

  if (unavailable) {
    return <span className="text-xs" style={{ color: "var(--mw-error)" }} title="서류 체크리스트를 불러오지 못했어요">확인 못 함</span>;
  }

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

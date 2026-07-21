/**
 * 상태(status) 컬럼 렌더링 — 먼데이 "상태" 컬럼 재현 (T05 · B3).
 *
 * 상태 = 001 field_type 의 `select`(단일) / `multiselect`(복수)를 **색 칩**으로 그리는 표현.
 * 별도 타입이 아니다 — 13종 enum 에 'status' 는 없고, 색은 `FieldOption.color` 에서 온다.
 *
 * 색·대비 계산은 `lib/boards/status-palette` 가 단독 담당(컴포넌트는 표시만).
 */

import type { FieldOption } from "@/lib/types";
import type { CellValue } from "@/lib/boards/types";
import { STATUS_EMPTY_COLOR, toStatusChip } from "@/lib/boards/status-palette";

/** 상태 칩 1개. */
export function StatusPill({
  label,
  background,
  color,
  title,
}: {
  label: string;
  background: string;
  color: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: background, color }}
      title={title ?? label}
    >
      {label}
    </span>
  );
}

/** 값이 없는 상태 셀. */
function EmptyPill() {
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 text-xs text-zinc-600"
      style={{ backgroundColor: STATUS_EMPTY_COLOR }}
    >
      —
    </span>
  );
}

/**
 * 읽기 전용 상태 셀 — select 는 칩 1개, multiselect 는 칩 여러 개.
 * 옵션 정의에 없는 값(고아)은 회색 칩 + id 그대로 노출해 문제를 숨기지 않는다.
 */
export function StatusCell({
  value,
  options,
}: {
  value: CellValue;
  options?: readonly FieldOption[] | null;
}) {
  const ids = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  if (ids.length === 0) return <EmptyPill />;

  return (
    <span className="flex flex-wrap items-center gap-1">
      {ids.map((id) => {
        const chip = toStatusChip(id, options);
        return (
          <StatusPill
            key={id}
            label={chip.label}
            background={chip.background}
            color={chip.color}
          />
        );
      })}
    </span>
  );
}

/**
 * 편집용 상태 셀렉트 — 현재 선택된 옵션 색을 컨트롤 자체에 입혀 먼데이처럼 보이게 한다.
 * 클라이언트 JS 없이 동작해야 하므로(서버 액션 폼) 색은 초기 선택값 기준으로만 칠한다.
 */
export function StatusSelect({
  name,
  value,
  options,
  className,
}: {
  name: string;
  value: CellValue;
  options: readonly FieldOption[];
  className?: string;
}) {
  const current = typeof value === "string" && value ? value : "";
  const chip = current ? toStatusChip(current, options) : null;

  return (
    <select
      name={name}
      defaultValue={current}
      className={className}
      style={
        chip ? { backgroundColor: chip.background, color: chip.color, fontWeight: 500 } : undefined
      }
      aria-label="상태"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

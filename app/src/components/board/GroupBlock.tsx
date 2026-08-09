"use client";

/**
 * 그룹 = **색 헤더 밴드를 가진 독립 카드 블록** (ui-guidelines 원칙 10).
 *
 * 원칙 10 이 금지하는 것은 "그룹의 연속 나열"이다. 그래서 그룹마다 카드로 끊고, 카드 사이에
 * 여백을 두고, 헤더 밴드에 그룹색을 칠한다. 밴드 좌측은 [접기][그룹명][건수], 우측은
 * [합계][프리셋 칩] — 좌우가 붙지 않게 `justify-between` 으로 갈라 둔다.
 *
 * 색은 `board_groups.color`(데이터)에서 온다. 컴포넌트가 hex 를 고르지 않으므로 토큰 규약
 * (globals.css: arbitrary hex 금지)에 걸리지 않고, 색이 없는 그룹은 --mw-record 로 수렴한다.
 * 밴드 배경은 `color-mix` 로 같은 색의 옅은 틴트를 만들어 다크 테마에서도 글자가 살아남는다.
 */

import type { ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

/** 합계 대상 = 이 그룹에 보이는 첫 number 컬럼. 없으면 합계를 그리지 않는다. */
function sumOfFirstNumberColumn(
  columns: readonly BoardColumn[],
  rows: readonly ItemWithValues[],
): { label: string; total: number } | null {
  const col = columns.find((c) => c.type === "number");
  if (!col) return null;
  let total = 0;
  for (const r of rows) {
    const v = r.values[col.key];
    if (typeof v === "number") total += v;
    else if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      total += Number(v);
    }
  }
  return { label: col.label, total };
}

export function GroupBlock({
  name,
  color,
  columns,
  rows,
  presetName,
  children,
}: {
  name: string;
  /** board_groups.color (hex) 또는 null. */
  color: string | null;
  columns: readonly BoardColumn[];
  rows: readonly ItemWithValues[];
  /** 아이템 프리셋 이름 — `탭-그룹` 형식(PLAN-002 §5 WO-6 명명 규칙). */
  presetName: string;
  children: ReactNode;
}) {
  const accent = color ?? "var(--mw-record)";
  const sum = sumOfFirstNumberColumn(columns, rows);

  return (
    <section className="overflow-hidden rounded-xl border border-mw-line bg-mw-card">
      <details open>
        <summary
          className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 list-none [&::-webkit-details-marker]:hidden"
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
            borderLeft: `3px solid ${accent}`,
          }}
        >
          <span aria-hidden="true" className="text-[0.6rem] text-mw-sub">
            ▼
          </span>
          <span className="text-sm font-semibold" style={{ color: accent }}>
            {name}
          </span>
          <span className="rounded-full bg-mw-card px-2 py-0.5 text-[0.65rem] text-mw-sub">
            {rows.length}건
          </span>

          <span className="ml-auto flex items-center gap-2 text-[0.65rem] text-mw-sub">
            {sum && (
              <span>
                {sum.label} 합계 <b className="text-mw-body">{sum.total.toLocaleString()}</b>
              </span>
            )}
            {/*
              프리셋 칩 — 이 그룹의 컬럼 구성을 가리키는 아이템 프리셋 이름.
              라이브러리(저장·적용·CSV)는 PLAN-002 WO-6 범위라 여기서는 **표시만** 한다.
            */}
            <span
              title="아이템 프리셋 — 저장·적용은 WO-6에서 연결됩니다"
              className="rounded-full border border-mw-line px-2 py-0.5"
            >
              {presetName}
            </span>
          </span>
        </summary>

        {children}
      </details>
    </section>
  );
}

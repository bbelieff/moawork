"use client";

/**
 * 헤더 **1줄** (ui-guidelines 원칙 3).
 *
 *   [🔥 탭명] [담당자 탭: 전체·…·미배정] ---- [새 항목]
 *
 * 원칙 3 이 금지한 것은 화면 우상단에 떠 있는 분리형 패널이다. 그래서 "새 항목"은 헤더 줄
 * 안의 버튼이고, 눌렀을 때 뜨는 입력도 그 자리에 붙는 팝오버다(별도 패널·모달 아님).
 *
 * 담당자 탭은 별도 상태를 갖지 않고 **도구줄의 담당자 필터와 같은 값**을 읽고 쓴다.
 * 탭과 칩이 각자 상태를 들면 둘이 어긋나는 순간 화면이 거짓말을 한다 — 단일 소스로 묶었다.
 * (담당자별 기본 탭의 시드·저장 뷰는 WO-3 범위. 여기서는 데이터에 실재하는 담당자로 만든다.)
 */

import type { ReactNode } from "react";
import type { BoardGroup } from "@/lib/boards/types";
import { addItemAction } from "@/app/(app)/boards/actions";

export function BoardHeader({
  boardId,
  icon,
  name,
  description,
  people,
  selected,
  onSelect,
  groups,
  readOnly,
  backSlot,
  helpSlot,
  viewSlot,
  addItemSlot,
}: {
  boardId: string;
  icon: string | null;
  name: string;
  description: string | null;
  /** 상위 화면으로 돌아가는 링크(서버에서 렌더해 내려준다). */
  backSlot?: ReactNode;
  /** 제목 바로 옆의 짧은 도움말. */
  helpSlot?: ReactNode;
  /** 뷰 전환 등 화면 고유 컨트롤. 헤더 줄 오른쪽 무리에 들어간다. */
  viewSlot?: ReactNode;
  /** 보드별 기본 등록 폼. 신규리드는 회사 기본 정보를 함께 저장하는 전용 폼을 쓴다. */
  addItemSlot?: ReactNode;
  /** 담당자 탭 선택지(도구줄과 동일 소스). */
  people: { value: string; label: string }[];
  /** 현재 선택된 담당자. 빈 배열 = "전체". */
  selected: string[];
  onSelect: (value: string | null) => void;
  groups: readonly BoardGroup[];
  readOnly: boolean;
}) {
  const activeTab = selected.length === 1 ? selected[0] : null;

  const tabClass = (on: boolean) =>
    `h-9 shrink-0 rounded-full px-3 text-xs transition-colors ${
      on
        ? "bg-mw-tint-blue font-semibold text-mw-record"
        : "text-mw-sub hover:bg-mw-bg hover:text-mw-fg"
    }`;

  return (
    <div data-visual-block="board-header" className="flex flex-nowrap items-center gap-2 overflow-x-auto">
      {backSlot}

      <h1 className="flex shrink-0 items-center gap-1.5 text-lg font-semibold text-mw-fg">
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{name}</span>
      </h1>
      {helpSlot}

      {description && (
        <span className="shrink-0 truncate text-xs text-mw-sub" title={description}>
          {description}
        </span>
      )}

      {people.length > 0 && (
        <nav aria-label="담당자 탭" className="ml-3 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={tabClass(selected.length === 0)}
          >
            전체
          </button>
          {people.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onSelect(p.value)}
              className={tabClass(activeTab === p.value)}
            >
              {p.label}
            </button>
          ))}
        </nav>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {viewSlot}

      {!readOnly && groups.length > 0 && (addItemSlot ?? (
        <details name="mw-board-header" className="relative shrink-0">
          <summary className="flex h-9 cursor-pointer select-none items-center rounded-full bg-mw-primary px-3.5 text-xs font-semibold text-mw-on-accent list-none [&::-webkit-details-marker]:hidden">
            ＋ 새 항목
          </summary>

          <form
            action={addItemAction}
            className="mw-layer-page-popover absolute right-0 top-full mt-1 flex w-64 flex-col gap-2 rounded-xl border border-mw-line bg-mw-card p-2 shadow-lg"
          >
            <input type="hidden" name="boardId" value={boardId} />
            <input
              name="title"
              required
              placeholder="항목 이름"
              aria-label="항목 이름"
              className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
            />
            <select
              name="groupId"
              defaultValue={groups[0]?.id ?? ""}
              aria-label="그룹"
              className="h-9 rounded-lg border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 rounded-lg bg-mw-primary text-xs font-semibold text-mw-on-accent"
            >
              추가
            </button>
          </form>
        </details>
      ))}
      </div>
    </div>
  );
}

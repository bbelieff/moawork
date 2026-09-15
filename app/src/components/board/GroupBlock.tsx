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
 *
 * 접기 상태는 로컬 state 로 든다(UI목업_신규업체보드_v5.md 3-4). `<details open>` 을 리터럴
 * `true` 로만 넘기면 React 가 매 리렌더마다 그 값을 다시 반영해 — 검색어 입력 등 상위 상태가
 * 바뀔 때마다 사용자가 접어둔 그룹이 도로 펴진다. `open` prop 을 state 로 제어해 이를 막는다.
 * `key={block.key}` 로 그룹별 인스턴스가 유지되므로 필터가 바뀌어도 접힘 상태는 살아남는다.
 */

import { useState, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";

export function GroupBlock({
  name,
  color,
  columns,
  rows,
  presetMenu,
  nameEditor,
  orderControls,
  onOrderDragStart,
  onOrderDragEnd,
  onOrderDrop,
  canOrderDrop,
  summarySlot,
  children,
}: {
  name: string;
  /** board_groups.color (hex) 또는 null. */
  color: string | null;
  columns: readonly BoardColumn[];
  rows: readonly ItemWithValues[];
  /** 아이템 프리셋 이름 — `탭-그룹` 형식(PLAN-002 §5 WO-6 명명 규칙). */
  presetName: string;
  /** 이 그룹에 컬럼 배치 오버라이드가 저장돼 있으면 true(v5 3-5 "변경됨" 점). */
  presetChanged: boolean;
  /**
   * 프리셋 칩 자리에 들어갈 실행형 메뉴(BBE-174 `GroupPresetMenu`).
   * 없으면 이름만 보여 주는 칩으로 되돌아간다.
   */
  presetMenu?: ReactNode;
  nameEditor?: ReactNode;
  orderControls?: ReactNode;
  onOrderDragStart?: () => void;
  onOrderDragEnd?: () => void;
  onOrderDrop?: () => void;
  canOrderDrop?:()=>boolean;
  /** 보드 공통 설정을 이 그룹의 filtered rows로 계산한 한줄 요약. */
  summarySlot?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const [dropState,setDropState]=useState<"valid"|"invalid"|null>(null);
  const accent = color ?? "var(--mw-record)";
  void columns;

  return (
    /*
     * 모서리를 자르는 `overflow-hidden` 은 **카드 전체가 아니라 본문에만** 건다.
     *
     * 전에는 이 <section> 이 통째로 `overflow-hidden` 이었다. 그때는 머리말에 «표시» 만
     * 있었으니 문제가 없었지만, 프리셋 메뉴(BBE-174)가 들어오면서 머리말에서 아래로 펼쳐지는
     * 팝오버가 생겼다 — 자르는 조상이 있으면 팝오버가 카드 경계에서 **잘려 안 보인다.**
     * (Chrome 에서 실측했다: section 에 overflow-hidden 이 있으면 패널을 자르는 조상이 그
     * section 이고, 본문 래퍼로 옮기면 자르는 조상이 없다.)
     *
     * 그래서 머리말은 자기 위쪽 모서리를, 본문 래퍼는 자기 아래쪽 모서리를 각각 둥글린다.
     * 카드 모양은 그대로이고 팝오버만 밖으로 나올 수 있다.
     */
    <section data-visual-block="group-table" className="min-w-0 max-w-full rounded-md border border-mw-line bg-mw-card">
      <details className="min-w-0 max-w-full" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary
          draggable={Boolean(onOrderDragStart)}
          onDragStart={onOrderDragStart ? (event) => {
            if ((event.target as HTMLElement).closest("button,input,select,textarea,a,[role=menu],[contenteditable=true],[data-no-drag]")) {
              event.preventDefault();
              return;
            }
            onOrderDragStart();
          } : undefined}
          onDragEnd={()=>{setDropState(null);onOrderDragEnd?.();}}
          onDragOver={onOrderDrop ? (event) => {if(canOrderDrop?.()===false){setDropState("invalid");return;}event.preventDefault();event.dataTransfer.dropEffect="move";setDropState("valid");} : undefined}
          onDragLeave={()=>setDropState(null)}
          onDrop={onOrderDrop ? (event) => {
            if(canOrderDrop?.()===false){setDropState("invalid");return;}
            event.preventDefault();
            setDropState(null);
            onOrderDrop();
          } : undefined}
          className={`flex select-none items-center gap-2 rounded-t-xl px-3 py-2 list-none [&::-webkit-details-marker]:hidden ${onOrderDragStart?"cursor-grab active:cursor-grabbing":"cursor-pointer"} ${dropState==="valid"?"border-t-2 border-mw-record bg-mw-tint-blue":dropState==="invalid"?"cursor-not-allowed":""}`}
          style={{
            backgroundColor: `color-mix(in srgb, ${accent} 14%, var(--mw-card))`,
            borderLeft: `3px solid ${accent}`,
          }}
        >
          <span className="sr-only" aria-live="polite">{dropState==="invalid"?"같은 그룹 위치에는 놓을 수 없어요.":dropState==="valid"?"이 위치로 그룹을 이동합니다.":""}</span>
          <span aria-hidden="true" className="text-[0.6rem] text-mw-sub">
            {open ? "▼" : "▶"}
          </span>
          <span className="min-w-0 text-sm font-semibold" style={{ color: accent }}>
            {nameEditor ?? name}
          </span>
          <span className="rounded-full bg-mw-card px-2 py-0.5 text-[0.65rem] text-mw-sub">
            {rows.length}건{!open && " · 접힘"}
          </span>

          <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 text-[0.65rem] text-mw-sub">
            {summarySlot}
            {orderControls}
            {/*
              프리셋 칩 — 이 그룹의 컬럼 구성을 가리키는 아이템 프리셋.
              점(●)은 이 그룹이 프리셋 기본값에서 벗어난 배치 오버라이드를 갖고 있다는 표시.

              BBE-174 전까지 여기는 「저장·적용은 WO-6에서 연결됩니다」라는 안내 문구만 단
              `<span>` 이었다. 지금은 `presetMenu` 슬롯이 있으면 그것을 그린다 — 저장·미리보기·
              적용·되돌리기를 실제로 실행하는 메뉴다(`GroupPresetMenu`).

              슬롯으로 받는 이유: 메뉴는 서버 액션과 프리셋 목록을 알아야 하는데, 이 컴포넌트는
              «색 헤더 밴드를 가진 카드» 라는 표현만 책임진다. 주입해 두면 프리셋을 실을 수 없는
              화면(읽기 전용 시스템 보드 등)에서도 이 블록을 그대로 쓸 수 있다.
            */}
            {presetMenu}
          </span>
        </summary>

        <div className="min-w-0 max-w-full overflow-hidden rounded-b-xl">{children}</div>
      </details>
    </section>
  );
}

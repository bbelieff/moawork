"use client";

/**
 * 그룹 = **색 헤더 밴드를 가진 독립 카드 블록** (ui-guidelines 원칙 10).
 *
 * 원칙 10 이 금지하는 것은 "그룹의 연속 나열"이다. 그래서 그룹마다 카드로 끊고, 카드 사이에
 * 여백을 두고, 헤더 밴드에 그룹색을 칠한다. 밴드 좌측은 [접기][그룹명][건수], 우측은
 * [합계][프리셋 칩] — 좌우가 붙지 않게 `justify-between` 으로 갈라 둔다.
 *
 * 색은 «그룹 톤» 에서 온다(#845 · 대표 지시 2026-10-06, 승인 방향 Palette.dc). 탭마다 메인 2색
 * (그 탭 강조 그라디언트의 두 스톱)이 있고, 그룹은 깊이로 구별한다 — 본 진행(색 1)은 단계가
 * 나아갈수록 깊어지고, 곁가지는 색 2, 멈춘 상태(불가·거절·취소)는 회색이다. 어느 축의 몇 단계인지는
 * 보드가 `resolveGroupTones`(lib/boards/group-tone.ts)로 정해 `tone` 으로 넘긴다. 실제 색은
 * `--mw-tab-*` 토큰이라 컴포넌트가 hex 를 고르지 않는다(globals.css: arbitrary hex 금지).
 * 톤이 없는 «그룹 없음» 묶음만 중립색이다.
 *
 * ★ 저장된 `board_groups.color`(먼데이에서 옮겨 온 색)는 지금 쓰지 않는다 — 같은 탭에서 그룹마다
 *   제각각인 색이 «어디가 본 진행인가» 를 가렸다. 사용자가 그룹 색을 직접 고르는 기능(#839)이
 *   들어오면 그 명시 선택이 이 자동 톤을 덮는 override 가 된다. `color` prop 은 그 자리다.
 *
 * 띠 = 톤 16% 틴트 + 3px 레일 + 톤을 글자색에 섞은 진한 제목(라이트는 진한 잉크, 다크는 밝은
 * 잉크 — 어느 쪽이든 AA). 섹션에 `--mw-group-accent` 를 달아 행 첫 칸의 줄(globals.css)과
 * 진행현황 칩이 같은 색을 쓴다. 제목은 표시에서만 앞머리 이모지를 걷는다(presentLabel).
 *
 * 접기 상태는 로컬 state 로 든다(UI목업_신규업체보드_v5.md 3-4). `<details open>` 을 리터럴
 * `true` 로만 넘기면 React 가 매 리렌더마다 그 값을 다시 반영해 — 검색어 입력 등 상위 상태가
 * 바뀔 때마다 사용자가 접어둔 그룹이 도로 펴진다. `open` prop 을 state 로 제어해 이를 막는다.
 * `key={block.key}` 로 그룹별 인스턴스가 유지되므로 필터가 바뀌어도 접힘 상태는 살아남는다.
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { groupToneAccent, groupToneLabel, type GroupTone } from "@/lib/boards/group-tone";
import { presentLabel } from "@/lib/boards/label-presentation";

export function GroupBlock({
  name,
  displayName,
  tone = null,
  accentColor = null,
  addLabel,
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
  onAddRow,
  selectControl,
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  name: string;
  /** 화면에 보일 이름(표시 전용). 없으면 name 의 앞머리 이모지만 걷는다. */
  displayName?: string;
  /**
   * board_groups.color — 지금은 쓰지 않는다(위 머리말 주석). #839 의 사용자 색 선택이
   * 들어오면 «명시 override» 로 이 자리를 쓴다.
   */
  color?: string | null;
  /** 이 그룹의 톤(탭 2색 × 깊이). 없으면(«그룹 없음») 중립색. */
  tone?: GroupTone | null;
  /**
   * #845 7단계 — 나눠 보기 묶음의 띠 색(목록·상태 칸의 선택지 색). 있으면 톤 대신 쓴다.
   * 사람 칸·「(없음)」 묶음은 null(중립색).
   */
  accentColor?: string | null;
  /** 띠 ＋ 의 읽는 이름. 기본은 「{이름}에 업체 추가」. */
  addLabel?: string;
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
  /**
   * 2026-10-08 대표 결정 — 「업체 추가」 를 보드마다 늘어놓지 않는다. 있으면 띠에 올렸을 때만
   * 보이는 ＋ 를 그리고, 누르면 이 보드에 바로 넣는 추가 패널을 연다.
   */
  onAddRow?: (opener: HTMLElement) => void;
  /** 제목행이 보드 맨 위 하나일 때 — 그룹 머리 제목칸에 있던 «이 그룹 전체 선택» 이 띠로 온다. */
  selectControl?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [localOpen, setOpen] = useState(true);
  const open = controlledOpen ?? localOpen;
  const [dropState,setDropState]=useState<"valid"|"invalid"|null>(null);
  const accent = accentColor ?? groupToneAccent(tone);
  const shownName = displayName ?? presentLabel(name);
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
    <section
      data-visual-block="group-table"
      data-group-accent={accent}
      data-group-tone={groupToneLabel(tone) ?? undefined}
      className="min-w-0 max-w-full rounded-md border border-mw-line bg-mw-card"
      style={{ "--mw-group-accent": accent } as CSSProperties}
    >
      <details className="min-w-0 max-w-full" open={open} onToggle={(e) => {
        setOpen(e.currentTarget.open);
        onOpenChange?.(e.currentTarget.open);
      }}>
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
            backgroundColor: dropState === "valid"
              ? "var(--mw-tint-blue)"
              : `color-mix(in srgb, ${accent} 16%, var(--mw-card))`,
            borderLeft: `3px solid ${accent}`,
          }}
        >
          <span className="sr-only" aria-live="polite">{dropState==="invalid"?"같은 그룹 위치에는 놓을 수 없어요.":dropState==="valid"?"이 위치로 그룹을 이동합니다.":""}</span>
          <span data-mw-group-color aria-hidden="true" style={{ backgroundColor: accent }} />
          <span
            data-group-title=""
            className="min-w-0 text-sm font-semibold"
            style={{ color: `color-mix(in srgb, ${accent} 40%, var(--mw-fg))` }}
          >
            {nameEditor ?? shownName}
          </span>
          <span className="rounded-full bg-mw-card px-2 py-0.5 text-[length:var(--fs-11)] text-mw-sub">
            {rows.length}건{!open && " · 접힘"}
          </span>

          <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 text-[0.65rem] text-mw-sub">
            {summarySlot}
            {/* 2026-10-07 대표 피드백 — 띠를 단정하게: 순서·프리셋 도구는 띠에 올리거나 초점이 갈 때만 보인다(globals.css). */}
            <span data-group-banner-tools="" className="flex items-center gap-2">
            {selectControl}
            {onAddRow ? (
              <button
                type="button"
                data-group-add=""
                aria-label={addLabel ?? `${shownName}에 업체 추가`}
                title={addLabel ?? "이 보드에 업체 추가"}
                onClick={(event) => { event.preventDefault(); onAddRow(event.currentTarget); }}
                className="flex h-6 w-6 items-center justify-center rounded text-sm text-mw-sub hover:bg-mw-card hover:text-mw-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary"
              >
                ＋
              </button>
            ) : null}
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
          </span>
        </summary>

        <div className="min-w-0 max-w-full overflow-hidden rounded-b-xl">{children}</div>
      </details>
    </section>
  );
}

/**
 * 2026-10-08 — 제목행이 보드 맨 위 하나가 되면서 그룹 머리 제목칸에 있던 «이 그룹 전체 선택»
 * 체크박스가 띠로 왔다. 표준 체크박스(키보드로 켜고 끔)에 일부 선택은 indeterminate 로 보인다.
 */
export function GroupSelectAll({
  name,
  state,
  onChange,
}: {
  name: string;
  state: "empty" | "partial" | "full";
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      ref={(element) => { if (element) element.indeterminate = state === "partial"; }}
      type="checkbox"
      checked={state === "full"}
      aria-checked={state === "partial" ? "mixed" : undefined}
      aria-label={`${name} 전체 선택`}
      onChange={(event) => onChange(event.currentTarget.checked)}
      onClick={(event) => event.stopPropagation()}
      className="h-3.5 w-3.5 shrink-0"
      data-no-drag
    />
  );
}

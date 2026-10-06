"use client";

/**
 * 2026-10-06 — 진행현황 단계 고르기 (#839 · 대표 지시 2026-10-06, 승인 방향 목업 Main.dc).
 *
 * 전에는 «단계 검색» 입력칸 + native select 두 개가 칸 안에 쌓여 행 높이가 두 배가 됐다.
 * 이제 칸에는 «색 칩 하나»(점 + 단계명 + 펼침 표시)만 있고, 검색은 펼친 팝오버 «안» 에 있다.
 *
 *   · 팝오버는 BoardDialogPortal 로 body 에 그린다 — sticky/잘림 조상 밖이라 잘리지 않는다.
 *   · 한 번에 하나: claimBoardTransientSurface 로 같은 보드의 다른 떠 있는 면을 닫는다.
 *   · 키보드: ↑↓ 이동 · Enter 선택 · Esc 닫고 칩으로 · Tab 닫고 다음 칸으로.
 *   · 만들기 행은 없다 — 단계값은 이동 규칙·전이와 묶여 있어 새 값은 «골랐는데 안 움직이는»
 *     상태를 만든다(LabelCombobox 의 만들기 경로를 쓰지 않는 이유).
 *   · 이동 규칙이 있는 단계는 «보드 이동», 없는 단계는 «상태만 바꾸기 (보드 그대로)» 로
 *     나눠 보여 준다 — 어느 선택이 행을 옮기는지 고르기 전에 안다.
 *   · 표시만 이모지를 걷는다(presentLabel). 제출값은 언제나 원래 선택지 id 다.
 *   · 점·칩 색은 «옮겨 갈 그룹의 톤» 이다(#845) — 그룹 띠와 같은 색이라 단계 = 그룹이 눈에 보인다.
 *     옮겨 갈 그룹이 없는 단계만 상태 팔레트 색을 쓴다.
 *   · 행을 옮길 권한이 없으면(canMoveRows=false) 다른 그룹으로 옮기는 선택지는 «권한 없음» 으로
 *     비활성이다 — 서버도 그 값을 저장하지 않고 사유를 돌려준다(같은 답).
 *   · 접근성(#845 검토 후속): 검색칸은 role=combobox + aria-expanded/aria-autocomplete, 결과 없음
 *     안내는 listbox 밖의 status, 활성 행이 없으면 Enter 는 아무것도 하지 않는다(검색 결과가 0건일 때
 *     «다음 업무로 이동» 이 Enter 한 번에 열리지 않게), Home/End 는 처음/끝 선택지로 간다.
 *
 * 저장·전이·일괄 가로채기는 이 컴포넌트가 하지 않는다 — `onSelect`/`onTransfer` 로 부모
 * (WorkflowProgressCell)에 넘긴다. 부모가 기존 폼 계약(hidden value + requestSubmit)을 지킨다.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { FieldOption } from "@/lib/types";
import { resolveStatusColor } from "@/lib/boards/status-palette";
import { normalizeLabelKey } from "@/lib/boards/label-options";
import { labelSearchText, presentLabel, presentLabels } from "@/lib/boards/label-presentation";
import { BoardDialogPortal } from "./BoardDialogPortal";
import {
  BOARD_TRANSIENT_SURFACE_EVENT,
  claimBoardTransientSurface,
  useAnchoredPosition,
  type BoardTransientSurfaceDetail,
} from "./BoardAnchoredMenu";

/**
 * 선택지 id → 이 보드에서 옮겨 갈 그룹. 없으면 그 선택은 값만 바꾼다.
 * accent 는 그 그룹의 톤 색(CSS) — 없으면 상태 팔레트 색.
 */
export type StageMoveTarget = Readonly<{ groupId: string; groupName: string | null; accent?: string | null }>;

type PickerRow =
  | Readonly<{ kind: "option"; option: FieldOption; label: string; color: string; hint: string | null; disabled: boolean }>
  | Readonly<{ kind: "clear"; disabled: false }>
  | Readonly<{ kind: "transfer"; disabled: false }>;

/** 다른 그룹으로 옮기는 선택지를 고를 수 없을 때의 안내(서버 거절과 같은 뜻). */
export const STAGE_MOVE_LOCKED_HINT = "행을 다른 그룹으로 옮기는 단계예요. 전체 행 권한이 있는 사람만 바꿀 수 있어요.";

/** 선택지의 점·칩 색 — 옮겨 갈 그룹의 톤이 있으면 그것, 없으면 상태 팔레트. */
function optionColor(option: FieldOption, target: StageMoveTarget | null | undefined): string {
  return target?.accent ?? resolveStatusColor(option);
}

type PickerSection = Readonly<{ key: string; title: string; rows: readonly PickerRow[] }>;

/** 칩 배경·글자 — 그룹색과 같은 규칙: 옅은 틴트 위에 색을 섞은 진한 글자(AA). */
export function stageChipStyle(color: string | null): { backgroundColor: string; color: string } {
  if (!color) {
    return {
      backgroundColor: "color-mix(in srgb, var(--mw-fg) 6%, var(--mw-card))",
      color: "var(--mw-sub)",
    };
  }
  return {
    backgroundColor: `color-mix(in srgb, ${color} 16%, var(--mw-card))`,
    color: `color-mix(in srgb, ${color} 40%, var(--mw-fg))`,
  };
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function StagePicker({
  boardId,
  itemId,
  options,
  value,
  fallbackLabel,
  moveTargets,
  currentGroupId = null,
  transitionLabel,
  disabled = false,
  canMoveRows = true,
  describedBy,
  searchClassName,
  onSelect,
  onTransfer,
}: Readonly<{
  boardId: string;
  itemId: string;
  options: readonly FieldOption[];
  /** 저장된(또는 낙관적으로 보이는) 선택지 id. 빈 문자열은 미선택. */
  value: string;
  /** 현재 값이 선택지에 없을 때 보여 줄 글자(고아 값을 숨기지 않는다). */
  fallbackLabel: string;
  /** 없으면 한 묶음(보드 안 단계)으로 보여 준다 — 이동 여부를 모르는 화면. */
  moveTargets?: ReadonlyMap<string, StageMoveTarget> | null;
  currentGroupId?: string | null;
  transitionLabel: string;
  disabled?: boolean;
  /** false 면 다른 그룹으로 옮기는 선택지를 비활성으로 보여 준다(보드의 행 이동 권한). */
  canMoveRows?: boolean;
  describedBy?: string;
  /** 팝오버 안 검색칸 서식 — 보드 표 공통 컨트롤 서식을 부모가 넘긴다. */
  searchClassName: string;
  /** 고른 선택지 id(미선택은 ""). 저장 여부는 부모가 정한다. */
  onSelect(value: string): void;
  onTransfer(): void;
}>) {
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** 키보드 활성 행(평평한 순번). null 이면 활성 행이 없다 — Enter 가 아무것도 하지 않는다. */
  const [active, setActive] = useState<number | null>(null);
  const scope = `board:${boardId}`;
  const owner = `stage-picker:${itemId}`;

  const displayById = useMemo(() => {
    const labels = presentLabels(options.map((option) => option.label));
    return new Map(options.map((option, index) => [option.id, labels[index]]));
  }, [options]);

  const current = options.find((option) => option.id === value) ?? null;
  const currentColor = current ? optionColor(current, moveTargets?.get(current.id)) : null;
  const currentLabel = value === ""
    ? "미선택"
    : current
      ? displayById.get(current.id) ?? current.label
      : presentLabel(fallbackLabel);

  const sectionsFor = useCallback((search: string): PickerSection[] => {
    const needle = normalizeLabelKey(search);
    const toRow = (option: FieldOption): PickerRow => {
      const target = moveTargets?.get(option.id) ?? null;
      const movesAway = Boolean(target && target.groupId !== currentGroupId);
      const label = displayById.get(option.id) ?? option.label;
      const targetLabel = target?.groupName ? presentLabel(target.groupName) : null;
      // 단계 = 그룹으로 연결된 보드에서는 단계 이름이 곧 그룹 이름이다 — «X → X» 를 반복하지 않는다.
      const hint = target
        ? !movesAway
          ? "지금 그룹"
          : targetLabel && normalizeLabelKey(targetLabel) !== normalizeLabelKey(label) ? targetLabel : targetLabel ? null : "다른 그룹"
        : null;
      return {
        kind: "option",
        option,
        label,
        color: optionColor(option, target),
        hint,
        disabled: movesAway && !canMoveRows,
      };
    };
    const visible = options.filter((option) => needle === ""
      || normalizeLabelKey(`${labelSearchText(option.label)} ${displayById.get(option.id) ?? ""} ${option.id}`).includes(needle));
    const clear: PickerRow[] = value !== "" && needle === "" ? [{ kind: "clear", disabled: false }] : [];
    const stageSections: PickerSection[] = moveTargets
      ? [
          { key: "move", title: "보드 이동", rows: visible.filter((option) => moveTargets.has(option.id)).map(toRow) },
          { key: "stay", title: "상태만 바꾸기 (보드 그대로)", rows: [...visible.filter((option) => !moveTargets.has(option.id)).map(toRow), ...clear] },
        ]
      : [{ key: "stage", title: "보드 안 단계", rows: [...visible.map(toRow), ...clear] }];
    return [
      ...stageSections.filter((section) => section.rows.length > 0),
      { key: "transfer", title: "다음 업무로 이동", rows: [{ kind: "transfer", disabled: false }] },
    ];
  }, [canMoveRows, currentGroupId, displayById, moveTargets, options, value]);
  const sections = useMemo(() => sectionsFor(query), [query, sectionsFor]);

  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  /** 섹션별 행에 «평평한» 순번을 붙인다 — 키보드 이동·aria-activedescendant 가 같은 번호를 쓴다. */
  const indexedSections = useMemo(() => {
    let next = 0;
    return sections.map((section) => ({
      ...section,
      rows: section.rows.map((row) => ({ row, index: next++ })),
    }));
  }, [sections]);
  const stageMatches = rows.some((row) => row.kind === "option");
  /** 고를 수 있는 행의 순번들(비활성 선택지 제외) — 키보드 이동은 이 안에서만 돈다. */
  const enabledIndexes = useMemo(
    () => rows.flatMap((row, index) => (row.disabled ? [] : [index])),
    [rows],
  );
  const rowId = (index: number) => `${baseId}-row-${index}`;
  const activeIndex = active !== null && active < rows.length && !rows[active].disabled ? active : null;
  const statusId = `${baseId}-status`;
  const noStageMessage = query.trim() !== "" && !stageMatches ? `「${query.trim()}」 단계가 없어요` : "";

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const closeQuietly = useCallback(() => close(false), [close]);

  const position = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    surfaceRef,
    onAnchorMissing: closeQuietly,
    desiredWidth: 272,
    desiredMaxHeight: 360,
  });

  useEffect(() => {
    if (!open || !position.ready) return;
    searchRef.current?.focus({ preventScroll: true });
  }, [open, position.ready]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || surfaceRef.current?.contains(target)) return;
      close(false);
    };
    const onClaim = (event: Event) => {
      const detail = (event as CustomEvent<BoardTransientSurfaceDetail>).detail;
      if (detail.scope === scope && detail.owner !== owner) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener(BOARD_TRANSIENT_SURFACE_EVENT, onClaim);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener(BOARD_TRANSIENT_SURFACE_EVENT, onClaim);
    };
  }, [close, open, owner, scope]);

  /** 검색어를 바꾼 뒤의 활성 행 — 첫 «단계» 행. 단계가 하나도 안 맞으면 활성 행 없음. */
  function firstStageIndex(candidates: readonly PickerRow[]): number | null {
    const index = candidates.findIndex((row) => (row.kind === "option" || row.kind === "clear") && !row.disabled);
    return index < 0 ? null : index;
  }

  function openPicker() {
    if (disabled) return;
    claimBoardTransientSurface(scope, owner);
    setQuery("");
    const all = sectionsFor("").flatMap((section) => section.rows);
    const currentIndex = all.findIndex((row) => row.kind === "option" && row.option.id === value && !row.disabled);
    setActive(currentIndex >= 0 ? currentIndex : firstStageIndex(all));
    setOpen(true);
  }

  function choose(row: PickerRow) {
    if (row.disabled) return;
    close(true);
    if (row.kind === "transfer") onTransfer();
    else if (row.kind === "clear") onSelect("");
    else onSelect(row.option.id);
  }

  function moveActive(step: 1 | -1) {
    if (enabledIndexes.length === 0) return;
    const at = activeIndex === null ? -1 : enabledIndexes.indexOf(activeIndex);
    const next = at < 0
      ? (step === 1 ? 0 : enabledIndexes.length - 1)
      : (at + step + enabledIndexes.length) % enabledIndexes.length;
    setActive(enabledIndexes[next]);
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (enabledIndexes.length === 0) return;
      setActive(event.key === "Home" ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // 활성 행이 없으면(예: 검색 결과 0건) 아무것도 하지 않는다 — 전이 확인이 우연히 열리지 않게.
      const row = activeIndex === null ? null : rows[activeIndex];
      if (row) choose(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      // 기본 Tab 이동은 칩에서 출발한다 — 팝오버를 닫고 다음(또는 이전) 칸으로 간다.
      close(true);
    }
  }


  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label="진행현황"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        data-stage-picker-trigger=""
        data-stage-value={value}
        title={currentLabel}
        onClick={() => (open ? close(true) : openPicker())}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-[var(--mw-r-2)] px-2 text-xs font-semibold outline-none hover:shadow-[inset_0_0_0_1px_var(--mw-line)] focus-visible:ring-2 focus-visible:ring-mw-primary disabled:cursor-not-allowed disabled:opacity-70"
        style={stageChipStyle(currentColor)}
      >
        <span
          aria-hidden="true"
          data-mw-stage-dot=""
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: currentColor ?? "var(--mw-sub)" }}
        />
        <span className="min-w-0 flex-1 truncate text-left">{currentLabel}</span>
        <ChevronIcon />
      </button>
      {open ? (
        <BoardDialogPortal>
          <div
            ref={surfaceRef}
            data-stage-picker=""
            data-placement={position.placement}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
              visibility: position.ready ? "visible" : "hidden",
            }}
            className="mw-layer-page-popover fixed flex flex-col rounded-[var(--mw-r-3)] border border-mw-line bg-mw-card p-1.5 text-left text-mw-fg shadow-xl"
          >
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="단계 검색"
              role="combobox"
              aria-label="진행 단계 검색"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-describedby={statusId}
              aria-activedescendant={activeIndex !== null ? rowId(activeIndex) : undefined}
              autoComplete="off"
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                setActive(firstStageIndex(sectionsFor(next).flatMap((section) => section.rows)));
              }}
              onKeyDown={onSearchKeyDown}
              className={`${searchClassName} mb-1 shrink-0 font-normal`}
            />
            <div
              id={listboxId}
              role="listbox"
              aria-label="진행현황 선택지"
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {indexedSections.map((section) => (
                <div key={section.key} role="group" aria-labelledby={`${baseId}-${section.key}`} className="py-0.5">
                  <div
                    id={`${baseId}-${section.key}`}
                    role="presentation"
                    className="px-2 pb-0.5 pt-1.5 text-[length:var(--fs-11)] font-semibold text-mw-sub"
                  >
                    {section.title}
                  </div>
                  {section.rows.map(({ row, index }) => {
                    const selected = row.kind === "option" ? row.option.id === value : false;
                    return (
                      <div
                        key={row.kind === "option" ? `option:${row.option.id}` : row.kind}
                        id={rowId(index)}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={row.disabled || undefined}
                        title={row.disabled ? STAGE_MOVE_LOCKED_HINT : undefined}
                        data-active={index === activeIndex || undefined}
                        data-stage-option={row.kind === "option" ? row.option.id : row.kind}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => { if (!row.disabled) setActive(index); }}
                        onClick={() => choose(row)}
                        className={`flex min-h-8 items-center gap-2 rounded-[var(--mw-r-2)] px-2 text-[length:var(--fs-13)] text-mw-fg data-[active=true]:bg-mw-tint-blue ${row.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                      >
                        {row.kind === "option" ? (
                          <>
                            <span aria-hidden="true" data-mw-stage-dot="" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                            <span className={`min-w-0 flex-1 truncate ${selected ? "font-semibold" : ""}`}>{row.label}</span>
                            {row.hint ? (
                              <span className="max-w-[45%] shrink-0 truncate text-[length:var(--fs-11)] text-mw-sub">→ {row.hint}</span>
                            ) : null}
                            {row.disabled ? (
                              <span data-stage-locked="" className="shrink-0 text-[length:var(--fs-11)] text-mw-sub">권한 없음</span>
                            ) : null}
                            {selected ? <span className="text-mw-primary"><CheckIcon /></span> : null}
                          </>
                        ) : row.kind === "clear" ? (
                          <span className="min-w-0 flex-1 truncate text-mw-sub">미선택</span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate font-semibold text-mw-record">→ {transitionLabel}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {/* listbox 의 자식은 option/group 만 허용된다 — 안내는 밖에 둔다. 영역은 늘 두고 글만 바꾼다. */}
            <p
              id={statusId}
              role="status"
              className={noStageMessage ? "px-2 py-1.5 text-[length:var(--fs-12)] text-mw-sub" : "sr-only"}
            >
              {noStageMessage}
            </p>
          </div>
        </BoardDialogPortal>
      ) : null}
    </>
  );
}

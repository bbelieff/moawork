"use client";

/**
 * 보기 줄 — #845 6단계(2026-10-08 대표 결정, 목업 ViewModel · ViewBar · ViewMobile).
 *
 *   [메인 테이블 · 저장된 뷰(나만/팀) · ＋] | [표 ▾][담당 · 전체][골라 보기][줄 세우기][나눠 보기][보이는 칸 24/29]
 *   [되돌리기][저장 ▾](바뀌었을 때만) ……………………………… [찾기] 「내 담당 · 40건 중 6건」
 *
 * 예전의 도구줄(찾기·보기·저장 세 묶음) · 머리말 둘째 줄(테이블/칸반 탭 · 담당자) · 저장된 뷰 줄을 이 한 줄로 합쳤다.
 *
 * · 찾기는 잠깐 쓰는 검색이다 — 저장하지 않고, 뷰를 «바뀜» 으로 만들지 않는다. 맨 오른쪽에 있다.
 * · 보기 조건 칩을 누르면 줄 «아래로» 「보기 조건」 칸이 펼쳐진다(팝오버가 아니다).
 * · 바뀜은 지금 조건과 지금 뷰에 저장된 조건(메인 테이블은 «조건 없음»)을 견준다. 검색어와 칸 순서는 빼고 센다.
 *   바뀌면 탭에 점, 그리고 「되돌리기」·「저장 ▾」 가 선다. 조건은 주소에 남아 새로고침해도 그대로다.
 * · 「이 뷰에 저장」 은 만든 사람·관리자만(서버도 같은 규칙으로 막는다). 다른 사람은 「새 뷰로 저장」(나만).
 * · 640px 아래: [뷰 이름 •▾] [보기 조건 N] [찾기] — 뷰 목록과 조건·저장은 바닥 시트로 연다.
 * · 「담당 · 나」 는 보는 사람 기준으로 저장한다(D26) — 뷰에 사람 id 를 박지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  boardViewSwitchUrl,
  durableNewLeadSavedViewConfig,
  presentNewLeadSavedViewConfig,
  savedViewUrl,
  systemViewUrl,
  type BoardViewMode,
  type SavedBoardView,
  type SavedBoardViewConfig,
} from "@/lib/view/board-saved";
import {
  assigneeChipValue,
  changedConditions,
  changedConditionsLabel,
  conditionsFromFilters,
  conditionsFromSavedView,
  draftPersonScope,
  draftViewConfig,
  effectiveSorts,
  filtersForConditions,
  MAIN_TABLE_CONDITIONS,
  pickedFilterCount,
  VIEW_MODE_LABEL,
  viewCountText,
  withSearchText,
  type ViewConditions,
} from "@/lib/view/view-conditions";
import { navigateTo, useSavedViews, type SavedViewsState } from "@/components/view/use-saved-views";
import { ViewTabs, visibilityTag } from "@/components/view/ViewTabs";
import { BoardAnchoredMenu, useAnchoredPosition } from "./BoardAnchoredMenu";
import { BoardDialogPortal, BoardModalLayer } from "./BoardDialogPortal";
import { Chevron, MenuItem, useBoardSurface, useMenuState } from "./BoardHeaderMenus";
import type { BoardFilterState } from "./filters";
import {
  ViewConditionsPanel,
  type ConditionTab,
  type ToolbarFilterFocus,
} from "./ViewConditionsPanel";

type Person = { value: string; label: string };

const CHIP_BASE = "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary";
const chipClass = (active: boolean, expanded = false) => `${CHIP_BASE} ${active
  ? "border-mw-record bg-mw-tint-blue font-semibold text-mw-record"
  : expanded
    ? "border-mw-sub bg-mw-card text-mw-fg"
    : "border-mw-line bg-mw-card text-mw-body hover:border-mw-sub"}`;
const BUTTON = "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary";

/** 640px 아래(sm 미만) — 펼침 칸 대신 바닥 시트를 쓰는 화면. */
function narrowViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(max-width: 639px)").matches;
}

function CountBadge({ count }: { count: number }) {
  return count > 0 ? (
    <span className="rounded-full bg-mw-record px-1.5 text-[10px] font-semibold leading-4 text-mw-on-accent tabular-nums">{count}</span>
  ) : null;
}

/** 지금 조건을 짧은 칩 글자로 — 새 뷰 저장 칸이 «무엇을 담는지» 보여 준다. */
export function conditionSummaryChips({
  mode,
  filters,
  groupBy,
  groupLabel,
  people,
  currentUserId,
  columnCount,
}: {
  mode: BoardViewMode;
  filters: BoardFilterState;
  groupBy: string;
  groupLabel: string | null;
  people: readonly Person[];
  currentUserId?: string;
  columnCount: number;
}): string[] {
  const chips = [VIEW_MODE_LABEL[mode]];
  if (filters.assignees.length > 0) chips.push(`담당 · ${assigneeChipValue(filters.assignees, people, currentUserId)}`);
  const picked = pickedFilterCount(filters);
  if (picked > 0) chips.push(`골라 보기 ${picked}`);
  const sorts = effectiveSorts(filters).length;
  if (sorts > 0) chips.push(`줄 세우기 ${sorts}`);
  if (groupBy) chips.push(`${groupLabel ?? groupBy}별`);
  if (filters.visibleColumnKeys != null) chips.push(`보이는 칸 ${filters.visibleColumnKeys.length}/${columnCount}`);
  return chips;
}

/** 줄에 붙는 작은 칸(새 뷰 저장·이름 바꾸기) — 누른 단추 바로 아래. Esc·바깥 누르기로 닫힌다. */
function AnchoredPanel({
  open,
  anchorRef,
  label,
  onClose,
  width = 300,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  onClose: (restoreFocus: boolean) => void;
  width?: number;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorMissing = useCallback(() => onClose(false), [onClose]);
  const position = useAnchoredPosition({
    open,
    anchorRef,
    surfaceRef: panelRef,
    onAnchorMissing: anchorMissing,
    desiredWidth: width,
    desiredMaxHeight: 440,
  });
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [anchorRef, onClose, open]);
  if (!open) return null;
  return (
    <BoardDialogPortal>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        data-view-bar-panel
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose(true);
          }
        }}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          visibility: position.ready ? "visible" : "hidden",
        }}
        className="mw-layer-page-popover fixed overflow-y-auto rounded-md border border-mw-line bg-mw-card p-3 text-mw-fg shadow-xl"
      >
        {children}
      </div>
    </BoardDialogPortal>
  );
}

/** 새 뷰로 저장 — 이름 · 담을 조건(칩) · 나만/팀 · 저장. 풀이 글은 두지 않는다. */
export function NewViewForm({
  chips,
  onSubmit,
}: {
  chips: readonly string[];
  onSubmit: (name: string, visibility: "private" | "shared") => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "shared">("private");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(name.trim(), visibility);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/duplicate|unique|23505/iu.test(message) ? "같은 이름의 뷰가 있어요" : message || "저장하지 못했어요");
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2.5" data-new-view-form>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="뷰 이름"
        placeholder="뷰 이름"
        maxLength={60}
        className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-[length:var(--fs-13)] text-mw-fg outline-none focus:border-mw-record"
      />
      <ul aria-label="담을 조건" className="flex flex-wrap gap-1">
        {chips.map((chip) => (
          <li key={chip} className="rounded-full bg-mw-bg px-2 py-0.5 text-[11px] text-mw-body">{chip}</li>
        ))}
      </ul>
      <div role="radiogroup" aria-label="보는 사람" className="flex gap-1.5">
        {(["private", "shared"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={visibility === value}
            onClick={() => setVisibility(value)}
            className={chipClass(visibility === value)}
          >
            {value === "private" ? "나만" : "팀"}
          </button>
        ))}
      </div>
      {error ? <p role="alert" className="text-xs text-mw-error">{error}</p> : null}
      <button
        type="submit"
        disabled={!name.trim() || pending}
        className="h-9 rounded-lg bg-mw-primary text-xs font-semibold text-mw-on-accent disabled:opacity-50"
      >
        저장
      </button>
    </form>
  );
}

function RenameForm({ initial, onSubmit }: { initial: string; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim() || pending) return;
        setPending(true);
        void onSubmit(name.trim()).finally(() => setPending(false));
      }}
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label="뷰 이름"
        maxLength={60}
        className="h-9 rounded-lg border border-mw-line bg-mw-card px-2.5 text-[length:var(--fs-13)] text-mw-fg outline-none focus:border-mw-record"
      />
      <button type="submit" disabled={!name.trim() || pending} className="h-9 rounded-lg bg-mw-primary text-xs font-semibold text-mw-on-accent disabled:opacity-50">
        저장
      </button>
    </form>
  );
}

/** 휴대폰 바닥 시트. */
function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  return (
    <BoardModalLayer label={label} onClose={onClose} layerClassName="items-end justify-center">
      <div data-view-bar-sheet className="flex max-h-[85vh] w-full flex-col gap-3 overflow-hidden rounded-t-xl bg-mw-card p-3 text-mw-fg shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{label}</p>
          <button type="button" aria-label={`${label} 닫기`} onClick={onClose} className="grid size-10 place-items-center rounded-lg text-mw-sub hover:bg-mw-bg">✕</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </div>
    </BoardModalLayer>
  );
}

export function BoardViewBar({
  boardId,
  currentUserId,
  mode,
  filters,
  onChange,
  groupBy = "",
  groupByOptions = [],
  onGroupByChange,
  columns,
  rows,
  people,
  matched,
  total,
  legacyFacetLabels,
  focusFilter = null,
  canonicalNewLead = false,
  loadSavedViews = false,
  activeViewId = null,
  calendarAvailable = false,
  defaultCalendarFieldKey = null,
  ready = true,
  savedViews,
}: {
  boardId: string;
  currentUserId?: string;
  mode: BoardViewMode;
  /** 지금 조건(화면 key). 검색어(q)도 여기 들어 있다. */
  filters: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  /** 나눠 보기 — 빈 값 = 보드별. 칸반은 목록 칸으로 레인을, 메인 표는 사람·목록·상태 칸으로 묶음을 나눈다(#845 7단계). */
  groupBy?: string;
  /** 나눠 보기로 고를 수 있는 칸(보드별 말고). 화면이 정한다 — 칸반은 목록 칸, 메인 표는 사람·목록·상태 칸. */
  groupByOptions?: readonly { key: string; label: string }[];
  /**
   * 있으면 나눠 보기를 화면 안에서 바꾼다(메인 표 — 주소만 고치고 다시 읽지 않는다).
   * 없으면 주소를 바꿔 서버가 다시 그린다(칸반 레인).
   */
  onGroupByChange?: (key: string) => void;
  /** 화면 칸 — 골라 보기·줄 세우기·보이는 칸의 대상. */
  columns: readonly BoardColumn[];
  rows: readonly ItemWithValues[];
  people: readonly Person[];
  matched: number;
  total: number;
  legacyFacetLabels?: Readonly<Record<string, string>>;
  focusFilter?: ToolbarFilterFocus | null;
  canonicalNewLead?: boolean;
  /** 저장된 뷰를 /api/tab-views 에서 읽는다(화면 fixture·시험은 끈다). */
  loadSavedViews?: boolean;
  /** 주소의 savedView — 서버가 읽을 수 있다고 확인한 것만. 없으면 메인 테이블. */
  activeViewId?: string | null;
  calendarAvailable?: boolean;
  defaultCalendarFieldKey?: string | null;
  /** 주소의 조건을 다 읽었는가 — 읽기 전에는 «바뀜» 을 말하지 않는다. */
  ready?: boolean;
  /** 화면이 저장된 뷰 목록을 이미 들고 있으면(목록 보기) 그것을 같이 쓴다 — 두 번 읽지 않는다. */
  savedViews?: SavedViewsState;
}) {
  const router = useRouter();
  const ownSaved = useSavedViews(boardId, loadSavedViews && !savedViews);
  const saved = savedViews ?? ownSaved;
  const displayViews = useMemo(
    () => canonicalNewLead
      ? saved.views.map((view) => ({ ...view, config: presentNewLeadSavedViewConfig(view.config) }))
      : saved.views,
    [canonicalNewLead, saved.views],
  );
  const activeSaved = activeViewId ? displayViews.find((view) => view.id === activeViewId) ?? null : null;
  const rawActive = activeViewId ? saved.views.find((view) => view.id === activeViewId) ?? null : null;
  const allColumnKeys = useMemo(() => columns.map((column) => column.key), [columns]);
  const current = useMemo(
    () => conditionsFromFilters(filters, mode, groupBy, allColumnKeys),
    [allColumnKeys, filters, groupBy, mode],
  );
  // 나눠 보기는 이 화면이 걸 수 있는 칸만 견준다 — 지금 걸린 것(groupBy)도 그 하나다.
  const groupByKeys = useMemo(
    () => [...groupByOptions.map((option) => option.key), ...(groupBy ? [groupBy] : [])],
    [groupBy, groupByOptions],
  );
  const baseline: ViewConditions | null = activeViewId
    ? activeSaved
      ? conditionsFromSavedView(activeSaved, {
        allColumnKeys,
        groupByKeys,
        groupByAliases: rawActive ? [rawActive.config.groupBy] : [],
        currentUserId,
      })
      : null
    : MAIN_TABLE_CONDITIONS;
  const changes = ready && baseline ? changedConditions(current, baseline) : [];
  const dirty = changes.length > 0;
  const canOverwrite = Boolean(activeSaved?.canEdit);

  /* ── 보기 조건 칸 ── */
  const [sheet, setSheet] = useState<null | "views" | "conditions" | "new" | "rename">(null);
  const [panelTab, setPanelTab] = useState<ConditionTab | null>(null);
  const [handledFocusSeq, setHandledFocusSeq] = useState(0);
  const [chipFocus, setChipFocus] = useState<ToolbarFilterFocus | null>(null);
  // 휴대폰 시트에서 펼칠 칸 — 펼침 칸(chipFocus)과 따로 둔다. 숨은 펼침 칸이 팝오버를 띄우지 않게.
  const [sheetFocus, setSheetFocus] = useState<ToolbarFilterFocus | null>(null);
  if (focusFilter && focusFilter.seq !== handledFocusSeq) {
    setHandledFocusSeq(focusFilter.seq);
    setPanelTab("filter");
    if (narrowViewport()) {
      // 640px 아래에는 펼침 칸이 없다 — 보기 조건 시트를 골라 보기 탭으로 열고 그 칸을 펼친다.
      setSheetFocus(focusFilter);
      setSheet("conditions");
    } else {
      setChipFocus(focusFilter);
    }
  }
  const chipFocusSeq = chipFocus?.seq ?? 0;
  useEffect(() => {
    if (chipFocusSeq === 0) return;
    // 보기 줄이 화면 밖(아래로 내려 본 표)이면 칩 팝오버가 화면 밖에 뜨므로 칸을 먼저 보이게 한다.
    document.getElementById("board-filter-panel")?.scrollIntoView?.({ block: "nearest" });
  }, [chipFocusSeq]);
  const openTab = (tab: ConditionTab) => {
    setChipFocus(null);
    setPanelTab((currentTab) => currentTab === tab ? null : tab);
  };
  const closePanel = () => {
    setChipFocus(null);
    setPanelTab(null);
  };

  /* ── 메뉴·작은 칸 ── */
  const { open: modeOpen, triggerRef: modeTriggerRef, menuRef: modeMenuRef, menuId: modeMenuId, close: modeClose, show: modeShow } = useMenuState(boardId);
  const { open: saveOpen, triggerRef: saveTriggerRef, menuRef: saveMenuRef, menuId: saveMenuId, close: saveClose, show: saveShow } = useMenuState(boardId);
  const { open: manageOpen, menuRef: manageMenuRef, menuId: manageMenuId, close: manageClose, show: manageShow } = useMenuState(boardId);
  const panelAnchorRef = useRef<HTMLElement | null>(null);
  const manageAnchorRef = useRef<HTMLElement | null>(null);
  const [floating, setFloating] = useState<null | "new" | "rename">(null);
  const closeFloatingQuietly = useCallback(() => setFloating(null), [setFloating]);
  const claimSurface = useBoardSurface(boardId, closeFloatingQuietly);
  const closeFloating = useCallback((restoreFocus: boolean) => {
    setFloating(null);
    if (restoreFocus) window.requestAnimationFrame(() => panelAnchorRef.current?.focus());
  }, [setFloating]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* ── 지금 조건 → 저장할 설정 ── */
  const groupLabel = groupBy ? groupByOptions.find((option) => option.key === groupBy)?.label ?? null : null;
  const summaryChips = conditionSummaryChips({
    mode,
    filters,
    groupBy,
    groupLabel,
    people,
    currentUserId,
    columnCount: columns.length,
  });
  const durableDraft = (): SavedBoardViewConfig => {
    const draft = draftViewConfig({
      mode,
      filters,
      groupBy,
      params: new URL(window.location.href).searchParams,
      active: activeSaved?.config ?? null,
      defaultCalendarFieldKey,
    });
    // 나눠 보기는 화면 key 그대로 — 칸반은 physical 목록 칸(예: export_status)이라 합성 key 를 지나면 다른 칸이 된다.
    return canonicalNewLead
      ? { ...durableNewLeadSavedViewConfig(presentNewLeadSavedViewConfig(draft)), groupBy: draft.groupBy }
      : draft;
  };
  const durableView = (view: SavedBoardView): SavedBoardView =>
    canonicalNewLead ? { ...view, config: durableNewLeadSavedViewConfig(view.config) } : view;

  const saveHere = async () => {
    if (!rawActive || !canOverwrite) return;
    setNotice(null);
    try {
      const draft = draftPersonScope(durableDraft(), rawActive, currentUserId);
      const scopeChanged = draft.personScope !== (rawActive.personScope ?? "none")
        || draft.personScopeUserId !== (rawActive.personScopeUserId ?? null);
      await saved.overwrite(rawActive, draft.config, scopeChanged
        ? { personScope: draft.personScope, personScopeUserId: draft.personScopeUserId }
        : undefined);
      setNotice("이 뷰에 저장했어요");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "저장하지 못했어요");
    }
  };
  const saveNew = async (name: string, visibility: "private" | "shared") => {
    // 「담당 · 나」 는 보는 사람 기준으로, 그 밖에는 지금 뷰의 사람 범위를 잇는다(보이던 행이 달라지지 않게).
    const draft = draftPersonScope(durableDraft(), rawActive, currentUserId);
    const created = await saved.create({
      name,
      visibility,
      personScope: draft.personScope,
      personScopeUserId: draft.personScopeUserId,
      config: draft.config,
    });
    navigateTo(withSearchText(savedViewUrl(durableView(created), window.location.href, currentUserId), filters.q));
  };
  const revert = () => {
    if (!baseline) return;
    setNotice(null);
    if (baseline.mode === mode && (baseline.groupBy === groupBy || onGroupByChange)) {
      onChange(filtersForConditions(baseline, filters));
      if (baseline.groupBy !== groupBy) onGroupByChange?.(baseline.groupBy);
      return;
    }
    const target = rawActive
      ? savedViewUrl(durableView(rawActive), window.location.href, currentUserId)
      : systemViewUrl("table", window.location.href);
    navigateTo(withSearchText(target, filters.q));
  };
  const selectMain = () => navigateTo(systemViewUrl("table", window.location.href));
  const selectView = async (view: SavedBoardView) => {
    const raw = saved.views.find((candidate) => candidate.id === view.id) ?? view;
    await saved.select(raw);
    navigateTo(savedViewUrl(durableView(raw), window.location.href, currentUserId));
  };
  // 보기 방식·칸반 나눠 보기는 조건을 주소에 그대로 둔 채 그리는 화면만 바뀐다 — 다시 읽지 않고 부드럽게 옮긴다.
  // 주소는 지금 주소(워크스페이스 뿌리 /w/<slug> 포함)에서 만든다.
  const changeMode = (next: BoardViewMode) => {
    if (next === mode) return;
    router.push(boardViewSwitchUrl(next, window.location.href));
  };
  const changeGroupBy = (key: string) => {
    if (key === groupBy) return;
    if (onGroupByChange) {
      onGroupByChange(key);
      return;
    }
    router.push(boardViewSwitchUrl(mode, window.location.href, key));
  };
  const renameActive = async (name: string) => {
    if (!rawActive) return;
    try {
      await saved.rename(rawActive, name);
      setFloating(null);
      setSheet(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "이름을 바꾸지 못했어요");
    }
  };
  const deleteActive = async () => {
    if (!rawActive) return;
    try {
      const result = await saved.remove(rawActive);
      navigateTo(result.fallback
        ? savedViewUrl(durableView(result.fallback), window.location.href, currentUserId)
        : systemViewUrl("table", window.location.href));
    } catch (cause) {
      setConfirmDelete(false);
      setNotice(cause instanceof Error ? cause.message : "지우지 못했어요");
    }
  };
  const openNewView = (anchor: HTMLElement | null) => {
    panelAnchorRef.current = anchor;
    claimSurface();
    setFloating("new");
  };

  /* ── 칩 값 ── */
  const assigneeValue = assigneeChipValue(filters.assignees, people, currentUserId);
  const filterCount = pickedFilterCount(filters);
  const sortCount = effectiveSorts(filters).length;
  const visibleCount = filters.visibleColumnKeys == null ? columns.length : filters.visibleColumnKeys.length;
  const activeConditionCount = (filters.assignees.length > 0 ? 1 : 0) + filterCount + (sortCount > 0 ? 1 : 0)
    + (groupBy ? 1 : 0) + (filters.visibleColumnKeys != null ? 1 : 0);
  const countText = viewCountText({ filters, people, currentUserId, matched, total });
  const viewName = activeSaved?.name ?? (activeViewId ? "뷰" : "메인 테이블");

  const conditionsPanel = (variant: "panel" | "sheet", footer?: ReactNode) => (
    <ViewConditionsPanel
      variant={variant}
      tab={panelTab ?? "filter"}
      onTab={(tab) => {
        setChipFocus(null);
        setSheetFocus(null);
        setPanelTab(tab);
      }}
      columns={columns}
      rows={rows}
      filters={filters}
      onChange={onChange}
      people={people}
      currentUserId={currentUserId}
      legacyFacetLabels={legacyFacetLabels}
      focusFilter={variant === "panel" ? chipFocus : sheetFocus}
      groupBy={groupBy}
      groupByOptions={groupByOptions}
      onGroupBy={changeGroupBy}
      onClose={variant === "panel" ? closePanel : undefined}
      footer={footer}
    />
  );

  const chip = (tab: ConditionTab, label: ReactNode, active: boolean, extra: Record<string, string> = {}) => (
    <button
      key={tab}
      type="button"
      data-view-chip={tab}
      aria-expanded={panelTab === tab}
      aria-controls={panelTab === tab ? "board-filter-panel" : undefined}
      onClick={() => openTab(tab)}
      className={chipClass(active, panelTab === tab)}
      {...extra}
    >
      {label}
    </button>
  );

  const searchInput = (className: string, autoFocus = false) => (
    <input
      type="search"
      value={filters.q}
      onChange={(event) => onChange({ ...filters, q: event.target.value })}
      placeholder="찾기"
      aria-label="찾기"
      autoFocus={autoFocus}
      className={className}
    />
  );

  const modeOptions: BoardViewMode[] = ["table", "kanban", ...(calendarAvailable || mode === "calendar" ? ["calendar" as const] : [])];
  // 휴대폰 보기 조건 시트 아래쪽 — 바뀌었을 때만.
  const sheetSaveActions = (
    <div className="flex flex-wrap gap-2 border-t border-mw-line pt-2">
      <button type="button" onClick={() => { setSheet(null); revert(); }} className={`${BUTTON} h-10 border border-mw-line text-mw-body`}>되돌리기</button>
      {canOverwrite ? (
        <button type="button" onClick={() => { setSheet(null); void saveHere(); }} className={`${BUTTON} h-10 border border-mw-line text-mw-body`}>이 뷰에 저장</button>
      ) : null}
      <button type="button" onClick={() => setSheet("new")} className={`${BUTTON} h-10 bg-mw-primary font-semibold text-mw-on-accent`}>새 뷰로 저장…</button>
    </div>
  );

  return (
    <div data-board-view-bar className="flex min-w-0 flex-col gap-1.5">
      {/* ── 넓은 화면: 한 줄 ── */}
      <div
        data-board-toolbar
        className="hidden min-w-0 flex-wrap items-center gap-x-2 gap-y-1 overflow-y-hidden border-b border-mw-line sm:flex lg:flex-nowrap"
      >
        {/* 넓은 화면(1024px~)은 한 줄 — 넘치면 뷰 탭 줄만 줄어들어 가로로 흐르고, 칩·저장·찾기는 제자리를 지킨다. */}
        <div className="min-w-0 max-w-full lg:min-w-[8rem] lg:shrink">
          <ViewTabs
            boardId={boardId}
            views={displayViews}
            activeId={activeSaved?.id ?? (activeViewId ? activeViewId : null)}
            dirtyCount={changes.length}
            onSelectMain={selectMain}
            onSelect={(view) => void selectView(view)}
            onRequestCreate={openNewView}
            onRequestManage={(view, anchor) => {
              manageAnchorRef.current = anchor;
              panelAnchorRef.current = anchor;
              manageShow();
            }}
          />
        </div>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-mw-line" />
        <div className="flex shrink-0 items-center gap-1.5 pb-0.5" data-view-chips>
          <button
            ref={modeTriggerRef}
            type="button"
            data-view-chip="mode"
            aria-haspopup="menu"
            aria-expanded={modeOpen}
            aria-controls={modeOpen ? modeMenuId : undefined}
            aria-label={`보기 방식 · ${VIEW_MODE_LABEL[mode]}`}
            onClick={() => (modeOpen ? modeClose(false) : modeShow())}
            className={chipClass(false, modeOpen)}
          >
            {VIEW_MODE_LABEL[mode]}
            <Chevron size={12} />
          </button>
          {chip("assignee", <>담당 · {assigneeValue}</>, filters.assignees.length > 0)}
          {chip("filter", <>골라 보기<CountBadge count={filterCount} /></>, filterCount > 0, { "data-board-filter-toggle": "" })}
          {chip("sort", <>줄 세우기<CountBadge count={sortCount} /></>, sortCount > 0)}
          {chip("group", <>나눠 보기 · {groupLabel ? `${groupLabel}별` : "보드별"}</>, Boolean(groupBy))}
          {chip("columns", <>보이는 칸 {visibleCount}/{columns.length}</>, filters.visibleColumnKeys != null)}
        </div>
        {dirty ? (
          <div className="flex shrink-0 items-center gap-1 pb-0.5" data-view-dirty-actions>
            <button type="button" onClick={revert} className={`${BUTTON} text-mw-sub hover:text-mw-fg`}>되돌리기</button>
            <button
              ref={saveTriggerRef}
              type="button"
              data-view-save
              aria-haspopup="menu"
              aria-expanded={saveOpen}
              aria-controls={saveOpen ? saveMenuId : undefined}
              onClick={() => (saveOpen ? saveClose(false) : saveShow())}
              className={`${BUTTON} border border-mw-record bg-mw-card font-semibold text-mw-record`}
            >
              저장
              <Chevron size={12} />
            </button>
          </div>
        ) : null}
        <div className="ms-auto flex min-w-0 shrink items-center gap-2 pb-0.5">
          <div className="relative shrink-0">
            <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-mw-sub">⌕</span>
            {searchInput("h-7 w-40 rounded-full border border-mw-line bg-mw-card pl-7 pr-3 text-xs text-mw-fg outline-none placeholder:text-mw-sub focus:border-mw-record lg:w-48")}
          </div>
          <span data-view-count className="min-w-0 truncate text-xs text-mw-sub" title={countText}>{countText}</span>
        </div>
      </div>

      {/* ── 640px 아래: [뷰 이름 •▾] [보기 조건 N] [찾기] ── */}
      <div data-board-view-bar-mobile className="flex min-w-0 items-center gap-2 sm:hidden">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`뷰 목록 · ${viewName}${dirty ? ` · ${changedConditionsLabel(changes.length)}` : ""}`}
          onClick={() => setSheet("views")}
          className="inline-flex h-10 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[length:var(--fs-13)] font-semibold text-mw-fg hover:bg-mw-card"
        >
          <span className="truncate">{viewName}</span>
          {dirty ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-mw-record" /> : null}
          <Chevron size={13} />
        </button>
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => {
            setSheetFocus(null);
            setPanelTab((tab) => tab ?? "filter");
            setSheet("conditions");
          }}
          className={`${chipClass(activeConditionCount > 0)} h-10`}
        >
          보기 조건<CountBadge count={activeConditionCount} />
        </button>
        <button
          type="button"
          aria-label="찾기"
          aria-pressed={mobileSearch}
          onClick={() => setMobileSearch((open) => !open)}
          className="grid size-10 shrink-0 place-items-center rounded-lg text-mw-sub hover:bg-mw-card hover:text-mw-fg"
        >
          ⌕
        </button>
        <span className="ms-auto shrink-0 text-xs text-mw-sub">{matched === total ? `${total}건` : `${total}건 중 ${matched}건`}</span>
      </div>
      {mobileSearch ? (
        <div className="sm:hidden">
          {searchInput("h-10 w-full rounded-lg border border-mw-line bg-mw-card px-3 text-sm text-mw-fg outline-none focus:border-mw-record", true)}
        </div>
      ) : null}

      {saved.error || notice ? (
        <p role="status" aria-live="polite" className="text-xs text-mw-sub">{notice ?? saved.error}</p>
      ) : null}

      {panelTab && sheet === null ? <div className="hidden sm:block">{conditionsPanel("panel")}</div> : null}

      {/* ── 메뉴 ── */}
      <BoardAnchoredMenu id={modeMenuId} open={modeOpen} anchorRef={modeTriggerRef} menuRef={modeMenuRef} label="보기 방식" onClose={modeClose} width={180}>
        {modeOptions.map((option) => (
          <MenuItem key={option} role="menuitemradio" checked={option === mode} onClick={() => { modeClose(false); changeMode(option); }}>
            {VIEW_MODE_LABEL[option]}
          </MenuItem>
        ))}
      </BoardAnchoredMenu>
      <BoardAnchoredMenu id={saveMenuId} open={saveOpen} anchorRef={saveTriggerRef} menuRef={saveMenuRef} label="저장" onClose={saveClose} width={200}>
        {canOverwrite ? (
          <MenuItem onClick={() => { saveClose(false); void saveHere(); }}>이 뷰에 저장</MenuItem>
        ) : null}
        <MenuItem onClick={() => { saveClose(false); openNewView(saveTriggerRef.current); }}>새 뷰로 저장…</MenuItem>
        <MenuItem onClick={() => { saveClose(false); revert(); }}>되돌리기</MenuItem>
      </BoardAnchoredMenu>
      <BoardAnchoredMenu id={manageMenuId} open={manageOpen} anchorRef={manageAnchorRef} menuRef={manageMenuRef} label="뷰 메뉴" onClose={(restore) => { manageClose(false); if (restore) manageAnchorRef.current?.focus(); }} width={180}>
        <MenuItem onClick={() => { manageClose(false); claimSurface(); setFloating("rename"); }}>이름 바꾸기</MenuItem>
        <MenuItem danger onClick={() => { manageClose(false); setConfirmDelete(true); }}>지우기</MenuItem>
      </BoardAnchoredMenu>

      <AnchoredPanel open={floating === "new"} anchorRef={panelAnchorRef} label="새 뷰로 저장" onClose={closeFloating}>
        <NewViewForm chips={summaryChips} onSubmit={saveNew} />
      </AnchoredPanel>
      <AnchoredPanel open={floating === "rename" && Boolean(activeSaved)} anchorRef={panelAnchorRef} label="이름 바꾸기" onClose={closeFloating} width={260}>
        <RenameForm initial={activeSaved?.name ?? ""} onSubmit={renameActive} />
      </AnchoredPanel>

      {confirmDelete && activeSaved ? (
        <BoardModalLayer label="뷰 지우기" onClose={() => setConfirmDelete(false)}>
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-mw-card p-4 text-mw-fg shadow-xl">
            <p className="text-sm font-semibold">「{activeSaved.name}」 뷰를 지울까요?</p>
            {activeSaved.visibility === "shared" ? <p className="text-xs text-mw-sub">팀 모두에게서 사라져요</p> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-9 rounded-lg border border-mw-line px-3 text-xs">취소</button>
              <button type="button" onClick={() => void deleteActive()} className="h-9 rounded-lg px-3 text-xs font-semibold text-mw-on-accent" style={{ background: "var(--mw-error)" }}>지우기</button>
            </div>
          </div>
        </BoardModalLayer>
      ) : null}

      {/* ── 휴대폰 시트 ── */}
      {sheet === "views" ? (
        <BottomSheet label="뷰" onClose={() => setSheet(null)}>
          <ul aria-label="뷰 목록" className="flex flex-col gap-0.5">
            {[{ id: null as string | null, name: "메인 테이블", tag: null as string | null, view: null as SavedBoardView | null },
              ...displayViews.map((view) => ({ id: view.id as string | null, name: view.name, tag: visibilityTag(view), view }))].map((entry) => {
              const active = (entry.id ?? null) === (activeSaved?.id ?? null);
              return (
                <li key={entry.id ?? "main"}>
                  <button
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setSheet(null);
                      if (entry.view) void selectView(entry.view);
                      else selectMain();
                    }}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-[length:var(--fs-13)] ${active ? "bg-mw-tint-blue font-semibold text-mw-record" : "text-mw-body hover:bg-mw-bg"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    {entry.tag ? <small className="text-[11px] text-mw-sub">{entry.tag}</small> : null}
                    {active && dirty ? <span aria-hidden="true" className="size-1.5 rounded-full bg-mw-record" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex flex-wrap gap-2 border-t border-mw-line pt-2">
            <button type="button" onClick={() => setSheet("new")} className={`${BUTTON} h-10 border border-mw-line text-mw-body`}>새 뷰로 저장…</button>
            {canOverwrite && activeSaved ? (
              <>
                <button type="button" onClick={() => setSheet("rename")} className={`${BUTTON} h-10 border border-mw-line text-mw-body`}>이름 바꾸기</button>
                <button type="button" onClick={() => { setSheet(null); setConfirmDelete(true); }} className={`${BUTTON} h-10 border border-mw-line`} style={{ color: "var(--mw-error)" }}>지우기</button>
              </>
            ) : null}
          </div>
        </BottomSheet>
      ) : null}
      {sheet === "conditions" ? (
        <BottomSheet label="보기 조건" onClose={() => setSheet(null)}>
          <div role="radiogroup" aria-label="보기 방식" className="mb-2 flex gap-1.5">
            {modeOptions.map((option) => (
              <button key={option} type="button" role="radio" aria-checked={option === mode} onClick={() => { setSheet(null); changeMode(option); }} className={`${chipClass(option === mode)} h-9`}>
                {VIEW_MODE_LABEL[option]}
              </button>
            ))}
          </div>
          {conditionsPanel("sheet", dirty ? sheetSaveActions : null)}
        </BottomSheet>
      ) : null}
      {sheet === "new" ? (
        <BottomSheet label="새 뷰로 저장" onClose={() => setSheet(null)}>
          <NewViewForm chips={summaryChips} onSubmit={saveNew} />
        </BottomSheet>
      ) : null}
      {sheet === "rename" && activeSaved ? (
        <BottomSheet label="이름 바꾸기" onClose={() => setSheet(null)}>
          <RenameForm initial={activeSaved.name} onSubmit={renameActive} />
        </BottomSheet>
      ) : null}
    </div>
  );
}

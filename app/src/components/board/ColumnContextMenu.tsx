"use client";

/**
 * 칸(컬럼) 머리글과 칸 메뉴 — #845 5단계(2026-10-08 대표 결정).
 *
 * 머리글에는 칸 «이름» 만 둔다. 이름이 곧 메뉴 단추다(누르기 · Enter/Space · 오른쪽 단추 · Shift+F10).
 * 이름을 끌면 지금처럼 칸 순서가 바뀐다 — 이름은 <button> 이 아니라 role="button" 이라 머리글
 * 끌기를 막지 않고, 끌고 놓으면 브라우저가 «누르기» 를 보내지 않으므로 누르기와 끌기가 갈린다.
 *
 * 메뉴는 간결하게(대표: "설명이 너무 많아 메뉴는 간결하게") — 항목마다 한 줄, 둘째 줄·예시 없음.
 *   · 맨 위: 칸 이름(15px) + 회색 한 줄 「날짜 · 18/24 채움」
 *   · 보기 [나만]: 줄 세우기 두 가지 · 골라 보기… · 숨기기 (BoardWorkspace 가 처리)
 *   · 칸 [모두]: 이름 바꾸기 · 선택지 고치기/입력 방식 바꾸기 · 왼쪽으로 · 오른쪽으로 · 오른쪽에 칸 추가 ·
 *     복사하기 · 지우기(칸 관리 권한이 있을 때만 · 서버가 다시 검사한다)
 * 결과(값이 함께 휴지통으로 · 계산이 멈춤)는 지우기 확인 창에서만 말한다.
 * 메뉴 안에서 또 다른 팝오버를 띄우지 않는다 — 고르면 메뉴를 닫고 대화상자나 이름 편집칸을 연다.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { FIELD_TYPES } from "@/lib/types";
import { fieldTypeLabel } from "@/lib/field/type-labels";
import { groupByChoiceLabel } from "@/lib/view/group-by";
import { runColumnCommandAction } from "@/app/(app)/boards/column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "@/app/(app)/boards/column-command-state";
import { renameColumnTitleAction } from "@/app/(app)/boards/title-actions";
import {
  ColumnSettingsPanel,
  type ColumnScheduleItemOption,
  type ColumnScheduleRecipientOption,
} from "./ColumnSettingsPanel";
import {
  BOARD_TRANSIENT_SURFACE_EVENT,
  BoardAnchoredMenu,
  claimBoardTransientSurface,
  type BoardTransientSurfaceDetail,
} from "./BoardAnchoredMenu";
import { BoardModalLayer } from "./BoardDialogPortal";
import { BoardInlineTitleEditor, type BoardInlineTitleEditorHandle } from "./BoardInlineTitleEditor";
import {
  COLUMN_MENU_TEXT as T,
  calcConsumersOf,
  columnDeleteLines,
  columnEditLabel,
  columnFillCount,
  columnMetaParts,
  columnSendsMessage,
  columnPlainName,
  columnSortOptions,
  type ColumnSortDirection,
  type ColumnViewRequest,
} from "./column-menu-model";

type ColumnSurface = "menu" | "duplicate" | "add" | "settings" | "archive" | null;

/** 보기(나만) — 없으면 그 칸은 «보기» 묶음 없이 그린다. */
export type ColumnMenuView = Readonly<{
  /** 지금 이 칸으로 줄 세운 방향. 없으면 null. */
  sortDirection: ColumnSortDirection | null;
  /** 이 칸의 「골라 보기…」 를 열 수 있는가. */
  canFilter: boolean;
  /** 「{칸}별로 나눠 보기」 를 보이는가(#845 7단계 — 사람·목록·상태 칸, 메인 표). 없으면 false. */
  canGroup?: boolean;
  /** 지금 이 칸으로 나눠 보고 있는가 — 체크 표시, 다시 누르면 보드별로 돌아간다. */
  grouped?: boolean;
  onRequest(request: ColumnViewRequest): void;
}>;

/** 칸 옮기기(모두) — 칸 관리 권한과 «순서 바꾸기» 가 켜진 화면에서만 준다. */
export type ColumnMenuMove = Readonly<{
  canLeft: boolean;
  canRight: boolean;
  onMove(delta: -1 | 1): void;
}>;

export function ColumnContextMenu({
  boardId,
  column,
  rows,
  deleteRows = rows,
  catalog = [],
  canManage = false,
  move = null,
  view = null,
  scheduleItems = [],
  scheduleRecipients = [],
  onArchived,
  surfaceScope,
}: {
  boardId: string;
  column: BoardColumn;
  /** 「18/24 채움」 의 기준 행(표에 넘어온 행). 없으면(가상 칸 등) 채움 수를 말하지 않는다. */
  rows?: readonly ItemWithValues[];
  /** 지우기 확인 창의 «값 N건» 기준 — 걸러지기 전 탭의 행. 기본은 rows. */
  deleteRows?: readonly ItemWithValues[];
  /** 같은 탭의 칸 정의 — 지우면 멈추는 계산 칸을 찾는다. */
  catalog?: readonly BoardColumn[];
  /** 「칸 · 모두」 묶음을 보이는가(칸 관리 권한 · 구조를 바꿀 수 있는 칸). */
  canManage?: boolean;
  move?: ColumnMenuMove | null;
  view?: ColumnMenuView | null;
  scheduleItems?: readonly ColumnScheduleItemOption[];
  scheduleRecipients?: readonly ColumnScheduleRecipientOption[];
  onArchived?: (columnId: string) => void;
  /** Board title/add-item consumers can claim this scope through claimBoardTransientSurface. */
  surfaceScope?: string;
}) {
  const owner = useId();
  const scope = surfaceScope ?? `board:${boardId}`;
  const menuId = `${owner.replace(/:/gu, "")}-menu`;
  const [surface, setSurface] = useState<ColumnSurface>(null);
  const [state, setCommandState] = useState(INITIAL_COLUMN_COMMAND_STATE);
  const [commandPending, startCommandTransition] = useTransition();
  const [showCommandMessage, setShowCommandMessage] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<BoardInlineTitleEditorHandle>(null);
  const requestIdRef = useRef(crypto.randomUUID());

  const restoreTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    });
  }, []);

  const closeSurface = useCallback((restoreFocus = true, force = false) => {
    if (!force && (commandPending || settingsPending)) return;
    setSurface(null);
    if (restoreFocus) restoreTriggerFocus();
  }, [commandPending, restoreTriggerFocus, settingsPending]);

  const showSurface = useCallback((next: Exclude<ColumnSurface, null>) => {
    claimBoardTransientSurface(scope, owner);
    requestIdRef.current = crypto.randomUUID();
    setShowCommandMessage(false);
    setSurface(next);
  }, [owner, scope]);

  useEffect(() => {
    const onClaim = (event: Event) => {
      const detail = (event as CustomEvent<BoardTransientSurfaceDetail>).detail;
      if (detail.scope === scope && detail.owner !== owner) closeSurface(false, true);
    };
    window.addEventListener(BOARD_TRANSIENT_SURFACE_EVENT, onClaim);
    return () => window.removeEventListener(BOARD_TRANSIENT_SURFACE_EVENT, onClaim);
  }, [closeSurface, owner, scope]);

  const submit = (operation: string, extra?: Record<string, string>) => {
    const data = new FormData();
    data.set("boardId", boardId);
    data.set("columnId", column.id);
    data.set("operation", operation);
    data.set("requestId", requestIdRef.current);
    for (const [key, value] of Object.entries(extra ?? {})) data.set(key, value);
    setShowCommandMessage(false);
    startCommandTransition(async () => {
      const result = await runColumnCommandAction(state, data);
      setCommandState(result);
      setShowCommandMessage(true);
      if (result.archivedColumnId) onArchived?.(result.archivedColumnId);
      if (result.ok) {
        setSurface(null);
        restoreTriggerFocus();
      }
    });
  };

  /** 메뉴를 닫고 고른 일을 한다. 초점은 restoreFocus 일 때만 이름으로 돌아간다. */
  const run = (action: () => void, restoreFocus: boolean) => {
    closeSurface(restoreFocus, true);
    action();
  };

  const toggleMenu = () => {
    if (surface === "menu") closeSurface(false, true);
    else showSurface("menu");
  };

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const opens = event.key === "Enter" || event.key === " " || event.key === "ArrowDown"
      || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
    if (!opens) return;
    event.preventDefault();
    event.stopPropagation();
    showSurface("menu");
  };

  const title = (shown: string) => (
    <span
      ref={triggerRef}
      role="button"
      tabIndex={0}
      data-column-title=""
      aria-haspopup="menu"
      aria-expanded={surface === "menu"}
      aria-controls={surface === "menu" ? menuId : undefined}
      onClick={(event) => {
        event.stopPropagation();
        toggleMenu();
      }}
      onKeyDown={onTitleKeyDown}
      className="block min-w-0 flex-1 cursor-pointer truncate rounded px-0.5 text-left outline-none hover:text-mw-fg focus-visible:ring-2 focus-visible:ring-mw-primary"
    >
      {shown}
    </span>
  );

  const fill = rows ? columnFillCount(column, rows) : null;
  const deleteFill = deleteRows ? columnFillCount(column, deleteRows) : fill;
  const consumers = calcConsumersOf(column, catalog);
  const sortOptions = view ? columnSortOptions(column) : [];
  const editLabel = columnEditLabel(column);
  const aboutId = `${menuId}-about`;
  const viewLabelId = `${menuId}-view`;
  const manageLabelId = `${menuId}-manage`;
  const deleteLines = columnDeleteLines(deleteFill?.filled ?? 0, consumers);

  const modalSurface = surface === "duplicate" || surface === "add" || surface === "settings" || surface === "archive";
  const modalPending = commandPending || settingsPending;
  const panelError = showCommandMessage && !state.ok && state.message;
  const modalTitle = surface === "duplicate" ? T.duplicate
    : surface === "add" ? T.addRight
      : surface === "settings" ? editLabel
        : T.remove;

  return (
    <div
      className="relative flex min-w-0 flex-1 items-center"
      onContextMenu={(event) => {
        // 이름 편집칸에서는 브라우저 기본 메뉴(붙여넣기 등)를 그대로 둔다.
        if ((event.target as HTMLElement).closest("input,textarea")) return;
        event.preventDefault();
        showSurface("menu");
      }}
    >
      {canManage ? (
        <BoardInlineTitleEditor
          ref={editorRef}
          name={column.label}
          label="칸 이름"
          onSave={(value) => renameColumnTitleAction(boardId, column.id, value)}
          idle={title}
          onEditEnd={() => window.requestAnimationFrame(() => {
            // 저장·취소로 편집칸이 사라져 초점을 잃었을 때만 이름으로 돌려준다(다른 곳을 눌렀으면 그대로).
            const active = document.activeElement;
            if (!active || active === document.body) triggerRef.current?.focus();
          })}
          className="flex-1"
        />
      ) : title(column.label)}

      <BoardAnchoredMenu
        id={menuId}
        open={surface === "menu"}
        anchorRef={triggerRef}
        menuRef={menuRef}
        label={`${column.label} 칸 메뉴`}
        describedBy={aboutId}
        width={240}
        maxHeight={520}
        initialFocus="first"
        onClose={(restore) => closeSurface(restore, true)}
      >
        <div id={aboutId} data-column-menu-about="" className="mb-1 border-b border-mw-line px-3 pb-2 pt-1">
          <p className="truncate text-[15px] font-semibold leading-6 text-mw-fg">{column.label}</p>
          <p className="truncate text-xs leading-5 text-mw-sub" data-column-menu-meta="">
            {columnMetaParts(column, fill).join(" · ")}
            {columnSendsMessage(column) ? <span style={{ color: "var(--mw-error)" }}>{` · ${T.sendsMessage}`}</span> : null}
          </p>
        </div>

        {view ? (
          <div role="group" aria-labelledby={viewLabelId} data-column-menu-section="view">
            <SectionLabel id={viewLabelId} name={T.view} tag={T.viewTag} />
            {sortOptions.map((option) => (
              <ColumnMenuItem
                key={option.direction}
                role="menuitemradio"
                checked={view.sortDirection === option.direction}
                icon={option.direction === "asc" ? "sortAsc" : "sortDesc"}
                label={option.label}
                onClick={() => run(() => view.onRequest({ kind: "sort", columnKey: column.key, direction: option.direction }), true)}
              />
            ))}
            {view.sortDirection ? (
              <ColumnMenuItem
                icon="reset"
                label={T.sortReset}
                onClick={() => run(() => view.onRequest({ kind: "sort", columnKey: column.key, direction: null }), true)}
              />
            ) : null}
            {view.canFilter ? (
              <ColumnMenuItem
                icon="filter"
                label={T.filter}
                onClick={() => run(() => view.onRequest({ kind: "filter", columnKey: column.key }), false)}
              />
            ) : null}
            {view.canGroup ? (
              <ColumnMenuItem
                role="menuitemcheckbox"
                checked={Boolean(view.grouped)}
                icon="group"
                label={groupByChoiceLabel(columnPlainName(column.label))}
                onClick={() => run(() => view.onRequest({ kind: "group", columnKey: column.key, on: !view.grouped }), true)}
              />
            ) : null}
            <ColumnMenuItem
              icon="hide"
              label={T.hide}
              onClick={() => run(() => view.onRequest({ kind: "hide", columnKey: column.key }), false)}
            />
          </div>
        ) : null}

        {canManage ? (
          <>
            {view ? <div role="separator" className="my-1 border-t border-mw-line" /> : null}
            <div role="group" aria-labelledby={manageLabelId} data-column-menu-section="manage">
              <SectionLabel id={manageLabelId} name={T.manage} tag={T.manageTag} />
              <ColumnMenuItem icon="rename" label={T.rename} onClick={() => run(() => editorRef.current?.beginEdit(), false)} />
              <ColumnMenuItem icon="settings" label={editLabel} onClick={() => showSurface("settings")} />
              {move ? (
                <>
                  <ColumnMenuItem icon="left" label={T.moveLeft} disabled={!move.canLeft} onClick={() => run(() => move.onMove(-1), true)} />
                  <ColumnMenuItem icon="right" label={T.moveRight} disabled={!move.canRight} onClick={() => run(() => move.onMove(1), true)} />
                </>
              ) : null}
              <ColumnMenuItem icon="add" label={T.addRight} onClick={() => showSurface("add")} />
              <ColumnMenuItem icon="copy" label={T.duplicate} onClick={() => showSurface("duplicate")} />
              <div role="separator" className="my-1 border-t border-mw-line" />
              <ColumnMenuItem icon="trash" danger label={T.remove} onClick={() => showSurface("archive")} />
            </div>
          </>
        ) : null}
      </BoardAnchoredMenu>

      {modalSurface ? (
        <BoardModalLayer
          label={`${column.label} · ${modalTitle}`}
          onClose={() => closeSurface(true)}
          dismissible={!modalPending}
        >
          <div className={`max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-md border border-mw-line bg-mw-card p-4 text-mw-fg shadow-xl ${surface === "settings" ? "max-w-3xl" : "max-w-sm"}`}>
            <header className="mb-4 flex items-start justify-between gap-3 border-b border-mw-line pb-3">
              <div>
                <p className="text-xs font-medium text-mw-sub">{modalTitle}</p>
                <h2 className="text-base font-semibold">{column.label}</h2>
              </div>
              <button type="button" disabled={modalPending} onClick={() => closeSurface(true)} className="rounded-lg border border-mw-line px-2 py-1 text-sm text-mw-sub hover:bg-mw-bg disabled:cursor-not-allowed disabled:opacity-50">닫기</button>
            </header>

            {surface === "duplicate" ? (
              <SimpleForm pending={commandPending} submitLabel={T.duplicate} submit={(data) => submit("duplicate", { copyValues: data.copyValues ?? "false" })}>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="copyValues" value="true" /><span>값도 복사</span></label>
              </SimpleForm>
            ) : null}
            {surface === "add" ? (
              <SimpleForm pending={commandPending} submitLabel="추가" submit={(data) => submit("create_at", data)}>
                <label className="grid gap-1 text-sm"><span>칸 이름</span><input name="label" required className="rounded-lg border border-mw-line bg-mw-card p-2" /></label>
                <label className="grid gap-1 text-sm"><span>입력 방식</span><select name="type" defaultValue="text" className="rounded-lg border border-mw-line bg-mw-card p-2">{FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}</select></label>
              </SimpleForm>
            ) : null}
            {surface === "settings" ? (
              <div className="grid gap-4">
                <section aria-label="입력 방식" className="grid gap-2 rounded border border-mw-line p-3">
                  <h3 className="text-sm font-semibold">입력 방식</h3>
                  <SimpleForm pending={commandPending} submitLabel="바꾸기" submit={(data) => submit("type_commit", { targetType: data.targetType })}>
                    <select name="targetType" aria-label="새 입력 방식" defaultValue={column.type} className="rounded-lg border border-mw-line bg-mw-card p-2">{FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}</select>
                  </SimpleForm>
                </section>
                <ColumnSettingsPanel
                  boardId={boardId}
                  column={column}
                  items={scheduleItems}
                  recipients={scheduleRecipients}
                  onPendingChange={setSettingsPending}
                  onSaved={() => closeSurface(true, true)}
                />
              </div>
            ) : null}
            {surface === "archive" ? (
              <div className="grid gap-4" data-column-delete-confirm="">
                <div className="grid gap-1 text-sm">
                  <p className="font-medium">‘{column.label}’ 칸을 지울까요?</p>
                  <p className="text-mw-sub">{deleteLines.main}</p>
                  {deleteLines.calc ? <p style={{ color: "var(--mw-error)" }}>{deleteLines.calc}</p> : null}
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={commandPending} onClick={() => closeSurface(true)} className="rounded-lg border border-mw-line px-3 py-2 text-sm disabled:opacity-50">취소</button>
                  <button type="button" disabled={commandPending} onClick={() => submit("archive")} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--mw-error)", color: "var(--mw-error)" }}>{commandPending ? "처리 중…" : T.remove}</button>
                </div>
              </div>
            ) : null}
            {panelError ? <p role="alert" aria-live="assertive" className="mt-3 rounded-lg border bg-mw-card p-3 text-sm" style={{ borderColor: "var(--mw-error)", color: "var(--mw-error)" }}>{panelError}</p> : null}
          </div>
        </BoardModalLayer>
      ) : null}

      {showCommandMessage && state.ok && state.message && surface === null ? (
        <div role="status" aria-live="polite" className="mw-layer-toast fixed bottom-5 right-5 rounded-md border border-mw-line bg-mw-card px-4 py-3 text-sm text-mw-fg shadow-xl">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}

/** 묶음 이름 — 「보기」+작은 「나만」, 「칸」+작은 「모두」. */
function SectionLabel({ id, name, tag }: { id: string; name: string; tag: string }) {
  return (
    <p id={id} data-column-menu-section-label="" className="flex items-center gap-1.5 px-3 pb-0.5 pt-1 text-[11px] font-medium text-mw-sub">
      {name}
      <span className="rounded border border-mw-line px-1 text-[10px] font-normal leading-4">{tag}</span>
    </p>
  );
}

type ColumnMenuIconName =
  | "sortAsc" | "sortDesc" | "reset" | "filter" | "group" | "hide"
  | "rename" | "settings" | "left" | "right" | "add" | "copy" | "trash";

/** 메뉴 아이콘 — 탭 아이콘(board-icons)과 같은 24 격자 · 선 굵기 1.8 · currentColor. */
const ICON_PATHS: Record<ColumnMenuIconName, string> = {
  sortAsc: "M4 6h7M4 12h10M4 18h14",
  sortDesc: "M4 6h14M4 12h10M4 18h7",
  reset: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5",
  filter: "M4 5h16l-6 7.2V19l-4 1.5v-8.3L4 5z",
  group: "M4 5h16M4 9h11M4 15h16M4 19h11",
  hide: "M3 3l18 18M10.6 6.1c.5-.1.9-.1 1.4-.1 4.8 0 8.3 3.7 9.5 6-.5 1-1.3 2.2-2.4 3.2M6.6 7.6C4.7 8.8 3.3 10.5 2.5 12c1.2 2.3 4.7 6 9.5 6 1.5 0 2.9-.4 4.1-1M9.9 9.9a3 3 0 0 0 4.2 4.2",
  rename: "M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  add: "M12 5v14M5 12h14",
  copy: "M9 9h10v10H9zM15 9V5H5v10h4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
};

function ColumnMenuIcon({ name }: { name: ColumnMenuIconName }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function ColumnMenuItem({
  icon,
  label,
  onClick,
  danger = false,
  disabled = false,
  role = "menuitem",
  checked,
}: {
  icon: ColumnMenuIconName;
  label: string;
  onClick(): void;
  danger?: boolean;
  disabled?: boolean;
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  checked?: boolean;
}) {
  const checkable = role === "menuitemradio" || role === "menuitemcheckbox";
  return (
    <button
      role={role}
      aria-checked={checkable ? Boolean(checked) : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={-1}
      draggable={false}
      type="button"
      data-column-menu-item=""
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={() => { if (!disabled) onClick(); }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-[length:var(--fs-13)] leading-5 hover:bg-mw-bg focus:bg-mw-bg focus:outline-none ${
        disabled ? "cursor-not-allowed opacity-45 hover:bg-transparent" : ""
      } ${checked ? "font-semibold" : ""}`}
      style={danger ? { color: "var(--mw-error)" } : undefined}
    >
      <ColumnMenuIcon name={icon} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {checkable ? (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0" style={{ visibility: checked ? "visible" : "hidden" }}>
          <path d="M4 12l5 5L20 6" />
        </svg>
      ) : null}
    </button>
  );
}

function SimpleForm({ children, pending, submit, submitLabel = "적용" }: { children: ReactNode; pending: boolean; submit(values: Record<string, string>): void; submitLabel?: string }) {
  return (
    <form className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      submit(Object.fromEntries([...data].map(([key, value]) => [key, String(value)])));
    }}>
      <fieldset disabled={pending} className="grid gap-3 disabled:opacity-60">{children}</fieldset>
      <button disabled={pending} className="rounded-lg bg-mw-primary px-3 py-2 font-semibold text-mw-on-accent disabled:cursor-not-allowed disabled:opacity-50">{pending ? "저장 중…" : submitLabel}</button>
    </form>
  );
}

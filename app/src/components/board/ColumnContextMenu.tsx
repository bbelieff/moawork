"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import type { BoardColumn } from "@/lib/boards/types";
import { FIELD_TYPES } from "@/lib/types";
import { fieldTypeLabel } from "@/lib/field/type-labels";
import { runColumnCommandAction } from "@/app/(app)/boards/column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "@/app/(app)/boards/column-command-state";
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
import { ColumnExpandedPanel } from "./ColumnExpandedPanel";
import { BoardModalLayer } from "./BoardDialogPortal";

export type ColumnMenuSlots = {
  settings?: ReactNode;
  templates?: ReactNode;
};

type ColumnSurface = "menu" | "duplicate" | "add" | "type" | "expand" | "settings" | "archive" | null;

export function ColumnContextMenu({
  boardId,
  column,
  slots = {},
  scheduleItems = [],
  scheduleRecipients = [],
  children,
  onArchived,
  surfaceScope,
}: {
  boardId: string;
  column: BoardColumn;
  slots?: ColumnMenuSlots;
  scheduleItems?: readonly ColumnScheduleItemOption[];
  scheduleRecipients?: readonly ColumnScheduleRecipientOption[];
  children?: ReactNode;
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(crypto.randomUUID());

  const restoreTriggerFocus = useCallback(() => {
    if (triggerRef.current?.isConnected) window.requestAnimationFrame(() => triggerRef.current?.focus());
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

  const modalSurface = surface === "duplicate" || surface === "add" || surface === "type" || surface === "settings" || surface === "archive";
  const modalPending = commandPending || settingsPending;
  const panelError = showCommandMessage && !state.ok && state.message;

  return (
    <div
      className="relative flex min-w-0 flex-1 items-center gap-1"
      onContextMenu={(event) => {
        event.preventDefault();
        showSurface("menu");
      }}
    >
      {children}
      <button
        ref={triggerRef}
        type="button"
        draggable={false}
        aria-label={`${column.label} 컬럼 메뉴`}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={surface === "menu"}
        onPointerDown={(event) => event.stopPropagation()}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onClick={(event) => {
          event.stopPropagation();
          if (surface === "menu") closeSurface(false, true);
          else showSurface("menu");
        }}
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu" || event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            showSurface("menu");
          }
        }}
        className="ml-auto rounded-lg px-1.5 text-mw-sub hover:bg-mw-bg focus:outline-none focus:ring-2 focus:ring-mw-primary"
      >
        ⋯
      </button>

      <BoardAnchoredMenu
        id={menuId}
        open={surface === "menu"}
        anchorRef={triggerRef}
        menuRef={menuRef}
        label={`${column.label} 구조 변경`}
        initialFocus="first"
        onClose={(restore) => closeSurface(restore, true)}
      >
        <MenuItem onClick={() => showSurface("duplicate")}>컬럼 복제</MenuItem>
        <MenuItem onClick={() => showSurface("add")}>오른쪽에 컬럼 추가</MenuItem>
        <MenuItem onClick={() => showSurface("type")}>컬럼 유형 변경</MenuItem>
        <MenuItem onClick={() => showSurface("expand")}>컬럼 확장</MenuItem>
        <MenuItem onClick={() => showSurface("settings")}>컬럼 설정</MenuItem>
        <div role="separator" className="my-1 border-t border-mw-line" />
        <MenuItem danger onClick={() => showSurface("archive")}>삭제</MenuItem>
      </BoardAnchoredMenu>

      <ColumnExpandedPanel
        open={surface === "expand"}
        anchorRef={triggerRef}
        label={column.label}
        onClose={(restore) => closeSurface(restore, true)}
      >
        <div className="grid gap-3 text-sm">
          <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 rounded-lg bg-mw-bg p-3">
            <dt className="text-mw-sub">유형</dt><dd>{fieldTypeLabel(column.type)}</dd>
            <dt className="text-mw-sub">키</dt><dd className="break-all">{column.key}</dd>
            <dt className="text-mw-sub">출처</dt><dd>{column.source}</dd>
          </dl>
          <div data-column-settings-slot>{slots.settings}</div>
          <div data-column-template-slot>{slots.templates}</div>
        </div>
      </ColumnExpandedPanel>

      {modalSurface ? (
        <BoardModalLayer
          label={`${column.label} 컬럼 변경`}
          onClose={() => closeSurface(true)}
          dismissible={!modalPending}
        >
          <div className={`max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-md border border-mw-line bg-mw-card p-4 text-mw-fg shadow-xl ${surface === "settings" ? "max-w-3xl" : "max-w-md"}`}>
            <header className="mb-4 flex items-start justify-between gap-3 border-b border-mw-line pb-3">
              <div>
                <p className="text-xs font-medium text-mw-sub">컬럼 변경</p>
                <h2 className="text-base font-semibold">{column.label}</h2>
              </div>
              <button type="button" disabled={modalPending} onClick={() => closeSurface(true)} className="rounded-lg border border-mw-line px-2 py-1 text-sm text-mw-sub hover:bg-mw-bg disabled:cursor-not-allowed disabled:opacity-50">닫기</button>
            </header>

            {surface === "duplicate" ? (
              <SimpleForm pending={commandPending} submit={(data) => submit("duplicate", { copyValues: data.copyValues ?? "false" })}>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="copyValues" value="true" /><span>행 값도 복제<br /><span className="text-mw-sub">기본은 구조·설정만 복제하며 기존 행 값은 비어 있습니다.</span></span></label>
              </SimpleForm>
            ) : null}
            {surface === "add" ? (
              <SimpleForm pending={commandPending} submit={(data) => submit("create_at", data)}>
                <input name="label" required placeholder="새 컬럼 이름" className="rounded-lg border border-mw-line bg-mw-card p-2" />
                <select name="type" defaultValue="text" className="rounded-lg border border-mw-line bg-mw-card p-2">{FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}</select>
              </SimpleForm>
            ) : null}
            {surface === "type" ? (
              <SimpleForm pending={commandPending} submit={(data) => submit("type_commit", { targetType: data.targetType })}>
                <p className="text-sm text-mw-sub">현재 값을 먼저 검사하며 변환 불가 값이 있으면 아무것도 바꾸지 않습니다.</p>
                <select name="targetType" defaultValue={column.type} className="rounded-lg border border-mw-line bg-mw-card p-2">{FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}</select>
              </SimpleForm>
            ) : null}
            {surface === "settings" ? (
              <ColumnSettingsPanel
                boardId={boardId}
                column={column}
                items={scheduleItems}
                recipients={scheduleRecipients}
                onPendingChange={setSettingsPending}
                onSaved={() => closeSurface(true, true)}
                onRequestClose={() => closeSurface(true, true)}
              />
            ) : null}
            {surface === "archive" ? (
              <div className="grid gap-4">
                <p className="text-sm">이 컬럼을 휴지통으로 옮길까요? 값과 설정은 보존되며 보드에서 되돌릴 수 있습니다.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" disabled={commandPending} onClick={() => closeSurface(true)} className="rounded-lg border border-mw-line px-3 py-2 text-sm disabled:opacity-50">취소</button>
                  <button type="button" disabled={commandPending} onClick={() => submit("archive")} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50" style={{ borderColor: "var(--mw-error)", color: "var(--mw-error)" }}>{commandPending ? "처리 중…" : "휴지통으로 이동"}</button>
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

function MenuItem({ children, onClick, danger = false }: { children: ReactNode; onClick(): void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      draggable={false}
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-mw-bg focus:bg-mw-bg focus:outline-none"
      style={danger ? { color: "var(--mw-error)" } : undefined}
    >
      {children}
    </button>
  );
}

function SimpleForm({ children, pending, submit }: { children: ReactNode; pending: boolean; submit(values: Record<string, string>): void }) {
  return (
    <form className="grid gap-3" onSubmit={(event) => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      submit(Object.fromEntries([...data].map(([key, value]) => [key, String(value)])));
    }}>
      <fieldset disabled={pending} className="grid gap-3 disabled:opacity-60">{children}</fieldset>
      <button disabled={pending} className="rounded-lg bg-mw-primary px-3 py-2 font-semibold text-mw-on-accent disabled:cursor-not-allowed disabled:opacity-50">{pending ? "저장 중…" : "적용"}</button>
    </form>
  );
}

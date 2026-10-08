"use client";

/**
 * 탭 머리말의 작은 부품들 (#845 개선안 · 2026-10-08 대표 결정).
 *   · TabTitleMenu   — 제목 옆 ▾ : 이름 바꾸기 · 아이콘 바꾸기 · 설명 고치기 · 탭 설정… | 휴지통으로 이동
 *   · AssigneeMenu   — 둘째 줄 「담당자 · 전체 ▾」 : 한 사람만 고른다(도구줄 담당자 필터와 같은 값)
 *   · DescriptionHint — 설명은 줄글 대신 ⓘ 에 올리거나 초점을 주면 보인다
 *   · TabSettingsButton — 오른쪽 위 「탭 설정」 (640px 아래는 아이콘만 40px)
 *
 * 메뉴는 표의 컬럼 메뉴와 같은 BoardAnchoredMenu(본문 포털·화살표 이동·Esc·바깥 누르기 닫힘)를 쓰고,
 * 같은 보드 안에서는 한 번에 하나만 열리도록 claimBoardTransientSurface 로 서로를 닫는다.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  BOARD_TRANSIENT_SURFACE_EVENT,
  BoardAnchoredMenu,
  claimBoardTransientSurface,
  useAnchoredPosition,
  type BoardTransientSurfaceDetail,
} from "./BoardAnchoredMenu";
import { BoardDialogPortal } from "./BoardDialogPortal";
import type { TabSettingsSection } from "./tab-chrome";

/** 같은 보드의 다른 표면(컬럼 메뉴 등)이 열리면 닫히고, 열 때는 다른 표면을 닫게 한다. */
function useBoardSurface(boardId: string, closeQuietly: () => void) {
  const owner = useId();
  const scope = `board:${boardId}`;
  useEffect(() => {
    const onClaim = (event: Event) => {
      const detail = (event as CustomEvent<BoardTransientSurfaceDetail>).detail;
      if (detail.scope === scope && detail.owner !== owner) closeQuietly();
    };
    window.addEventListener(BOARD_TRANSIENT_SURFACE_EVENT, onClaim);
    return () => window.removeEventListener(BOARD_TRANSIENT_SURFACE_EVENT, onClaim);
  }, [closeQuietly, owner, scope]);
  return useCallback(() => claimBoardTransientSurface(scope, owner), [owner, scope]);
}

/** 메뉴 하나의 열림·닫힘과 초점 되돌리기. */
function useMenuState(boardId: string) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `${useId().replace(/:/gu, "")}-menu`;
  const closeQuietly = useCallback(() => setOpen(false), []);
  const claim = useBoardSurface(boardId, closeQuietly);
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const show = useCallback(() => {
    claim();
    setOpen(true);
  }, [claim]);
  return { open, triggerRef, menuRef, menuId, close, show };
}

function Chevron({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function MenuItem({
  children,
  onClick,
  danger = false,
  role = "menuitem",
  checked,
}: {
  children: ReactNode;
  onClick(): void;
  danger?: boolean;
  role?: "menuitem" | "menuitemradio";
  checked?: boolean;
}) {
  return (
    <button
      role={role}
      aria-checked={role === "menuitemradio" ? Boolean(checked) : undefined}
      tabIndex={-1}
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[length:var(--fs-13)] hover:bg-mw-bg focus:bg-mw-bg focus:outline-none ${checked ? "font-semibold text-mw-fg" : ""}`}
      style={danger ? { color: "var(--mw-error)" } : undefined}
    >
      {role === "menuitemradio" ? (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none", visibility: checked ? "visible" : "hidden" }}>
          <path d="M4 12l5 5L20 6" />
        </svg>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function TabTitleMenu({
  boardId,
  tabName,
  onRename,
  onOpenSettings,
  onRequestTrash,
}: {
  boardId: string;
  tabName: string;
  /** 제목 편집칸을 연다. 없으면 「이름 바꾸기」 를 감춘다(이름을 바꿀 권한이 없다). */
  onRename?: () => void;
  onOpenSettings?: (section: TabSettingsSection) => void;
  onRequestTrash?: () => void;
}) {
  const { open, triggerRef, menuRef, menuId, close, show } = useMenuState(boardId);
  if (!onRename && !onOpenSettings && !onRequestTrash) return null;

  // 메뉴를 닫고 고른 일을 한다. 초점은 고른 일이 연 곳(편집칸·설정)으로 가야 하므로 단추로 되돌리지 않는다.
  const run = (action: () => void) => {
    close(false);
    action();
  };
  const label = `${tabName} 탭 메뉴`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-board-tab-menu-trigger
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        className={`grid size-8 shrink-0 place-items-center rounded-[var(--mw-r-2)] text-mw-sub hover:bg-[color:var(--mw-board-canvas)] hover:text-mw-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary ${open ? "bg-[color:var(--mw-board-canvas)] text-mw-fg" : ""}`}
      >
        <Chevron />
      </button>
      <BoardAnchoredMenu id={menuId} open={open} anchorRef={triggerRef} menuRef={menuRef} label={label} onClose={close}>
        {onRename ? <MenuItem onClick={() => run(onRename)}>이름 바꾸기</MenuItem> : null}
        {onOpenSettings ? (
          <>
            <MenuItem onClick={() => run(() => onOpenSettings("general"))}>아이콘 바꾸기</MenuItem>
            <MenuItem onClick={() => run(() => onOpenSettings("general"))}>설명 고치기</MenuItem>
            <MenuItem onClick={() => run(() => onOpenSettings("general"))}>탭 설정…</MenuItem>
          </>
        ) : null}
        {onRequestTrash ? (
          <>
            {onRename || onOpenSettings ? <div role="separator" className="my-1 border-t border-mw-line" /> : null}
            <MenuItem danger onClick={() => run(onRequestTrash)}>휴지통으로 이동</MenuItem>
          </>
        ) : null}
      </BoardAnchoredMenu>
    </>
  );
}

export function AssigneeMenu({
  boardId,
  people,
  selected,
  onSelect,
}: {
  boardId: string;
  people: readonly { value: string; label: string }[];
  /** 지금 고른 담당자. 빈 배열 = 전체. 도구줄 필터에서 여럿을 고르면 「N명」 으로 보인다. */
  selected: readonly string[];
  onSelect: (value: string | null) => void;
}) {
  const { open, triggerRef, menuRef, menuId, close, show } = useMenuState(boardId);
  const current = selected.length === 0
    ? "전체"
    : selected.length === 1
      ? people.find((person) => person.value === selected[0])?.label ?? "1명"
      : `${selected.length}명`;
  const single = selected.length === 1 ? selected[0] : null;
  const pick = (value: string | null) => {
    onSelect(value);
    close(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-board-assignee-menu
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show();
          }
        }}
        className={`flex h-9 shrink-0 items-center gap-1 border-b-2 border-transparent text-[length:var(--fs-13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary ${selected.length > 0 ? "font-semibold text-mw-fg" : "text-mw-sub hover:text-mw-fg"}`}
      >
        <span>담당자 · {current}</span>
        <Chevron size={13} />
      </button>
      <BoardAnchoredMenu id={menuId} open={open} anchorRef={triggerRef} menuRef={menuRef} label="담당자 고르기" onClose={close}>
        <MenuItem role="menuitemradio" checked={selected.length === 0} onClick={() => pick(null)}>전체</MenuItem>
        {people.map((person) => (
          <MenuItem key={person.value} role="menuitemradio" checked={single === person.value} onClick={() => pick(person.value)}>
            {person.label}
          </MenuItem>
        ))}
      </BoardAnchoredMenu>
    </>
  );
}

/** 탭 설명 — ⓘ 에 마우스를 올리거나 초점을 주면 본문 위에 뜬다(Esc 로 닫힘). 줄글은 보조기기에 늘 읽힌다. */
export function DescriptionHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const descriptionId = `${useId().replace(/:/gu, "")}-description`;
  const hide = useCallback(() => setOpen(false), []);
  const position = useAnchoredPosition({
    open,
    anchorRef,
    surfaceRef,
    onAnchorMissing: hide,
    desiredWidth: 280,
    desiredMaxHeight: 240,
  });

  const cancelHide = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const showNow = () => {
    cancelHide();
    setOpen(true);
  };
  // 단추에서 말풍선으로 마우스를 옮기는 사이에 닫히지 않게 조금 기다린다.
  const hideSoon = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-board-description
        aria-label="탭 설명"
        aria-describedby={descriptionId}
        onPointerEnter={showNow}
        onPointerLeave={hideSoon}
        onFocus={showNow}
        onBlur={() => setOpen(false)}
        onClick={showNow}
        className="grid size-7 shrink-0 place-items-center rounded-full text-mw-sub hover:text-mw-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary"
      >
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
      </button>
      <span id={descriptionId} className="sr-only">{text}</span>
      {open ? (
        <BoardDialogPortal>
          <div
            ref={surfaceRef}
            aria-hidden="true"
            data-board-description-tip
            onPointerEnter={showNow}
            onPointerLeave={hideSoon}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
              visibility: position.ready ? "visible" : "hidden",
            }}
            className="mw-layer-tooltip fixed overflow-y-auto rounded-md border border-mw-line bg-mw-card px-3 py-2 text-[length:var(--fs-12)] leading-5 text-mw-body shadow-lg"
          >
            {text}
          </div>
        </BoardDialogPortal>
      ) : null}
    </>
  );
}

/** 오른쪽 위 「탭 설정」 — 테두리만 있는 단추. 640px 아래에서는 글자를 숨기고 40px 아이콘 단추가 된다. */
export function TabSettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      data-board-tab-settings
      onClick={onOpen}
      className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-[var(--mw-r-2)] border border-mw-line bg-mw-card px-3 text-[length:var(--fs-13)] text-mw-body hover:bg-[color:var(--mw-board-canvas)] hover:text-mw-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary max-sm:size-10 max-sm:justify-center max-sm:px-0"
    >
      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
        <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
        <circle cx="16" cy="6" r="2" />
        <circle cx="10" cy="12" r="2" />
        <circle cx="18" cy="18" r="2" />
      </svg>
      <span className="max-sm:sr-only">탭 설정</span>
    </button>
  );
}

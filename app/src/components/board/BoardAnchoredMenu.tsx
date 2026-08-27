"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { BoardDialogPortal } from "./BoardDialogPortal";

export const BOARD_TRANSIENT_SURFACE_EVENT = "mw:board-transient-surface";

export type BoardTransientSurfaceDetail = Readonly<{
  scope: string;
  owner: string;
}>;

/** BoardHeader/title/add-item consumers can share this without importing column-menu state. */
export function claimBoardTransientSurface(scope: string, owner: string) {
  window.dispatchEvent(new CustomEvent<BoardTransientSurfaceDetail>(BOARD_TRANSIENT_SURFACE_EVENT, {
    detail: { scope, owner },
  }));
}

export type AnchoredPosition = Readonly<{
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
  ready: boolean;
}>;

const INITIAL_POSITION: AnchoredPosition = {
  left: 8,
  top: 8,
  width: 224,
  maxHeight: 320,
  placement: "bottom",
  ready: false,
};

export function useAnchoredPosition({
  open,
  anchorRef,
  surfaceRef,
  onAnchorMissing,
  desiredWidth,
  desiredMaxHeight,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  surfaceRef: RefObject<HTMLElement | null>;
  onAnchorMissing(): void;
  desiredWidth: number;
  desiredMaxHeight: number;
}): AnchoredPosition {
  const [position, setPosition] = useState<AnchoredPosition>({
    ...INITIAL_POSITION,
    width: desiredWidth,
    maxHeight: desiredMaxHeight,
  });

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor?.isConnected) {
      onAnchorMissing();
      return;
    }
    const inset = 8;
    const gap = 6;
    const width = Math.max(160, Math.min(desiredWidth, window.innerWidth - inset * 2));
    const anchorRect = anchor.getBoundingClientRect();
    const renderedHeight = surfaceRef.current?.getBoundingClientRect().height ?? desiredMaxHeight;
    const wantedHeight = Math.min(desiredMaxHeight, Math.max(96, renderedHeight));
    const below = Math.max(0, window.innerHeight - anchorRect.bottom - gap - inset);
    const above = Math.max(0, anchorRect.top - gap - inset);
    const placement = below >= Math.min(wantedHeight, 160) || below >= above ? "bottom" : "top";
    const available = placement === "bottom" ? below : above;
    const maxHeight = Math.max(96, Math.min(desiredMaxHeight, available));
    const actualHeight = Math.min(wantedHeight, maxHeight);
    const left = Math.max(inset, Math.min(anchorRect.right - width, window.innerWidth - width - inset));
    const top = placement === "bottom"
      ? Math.min(window.innerHeight - inset - actualHeight, anchorRect.bottom + gap)
      : Math.max(inset, anchorRect.top - gap - actualHeight);
    setPosition({ left, top, width, maxHeight, placement, ready: true });
  }, [anchorRef, desiredMaxHeight, desiredWidth, onAnchorMissing, surfaceRef]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const frame = window.requestAnimationFrame(place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    if (surfaceRef.current) observer?.observe(surfaceRef.current);
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      if (!anchorRef.current?.isConnected) onAnchorMissing();
    });
    mutation?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, onAnchorMissing, open, place, surfaceRef]);

  return position;
}

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])]
    .filter((item) => !(item instanceof HTMLButtonElement) || !item.disabled);
}

function focusMenuItem(menu: HTMLElement | null, index: number) {
  const items = menuItems(menu);
  if (items.length === 0) return;
  const target = ((index % items.length) + items.length) % items.length;
  items.forEach((item, itemIndex) => { item.tabIndex = itemIndex === target ? 0 : -1; });
  items[target]?.focus();
}

export function BoardAnchoredMenu({
  id,
  open,
  anchorRef,
  menuRef,
  label,
  initialFocus = "first",
  onClose,
  children,
}: {
  id: string;
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  label: string;
  initialFocus?: "first" | "last";
  onClose(restoreFocus: boolean): void;
  children: ReactNode;
}) {
  const anchorMissing = useCallback(() => onClose(false), [onClose]);
  const position = useAnchoredPosition({
    open,
    anchorRef,
    surfaceRef: menuRef,
    onAnchorMissing: anchorMissing,
    desiredWidth: 232,
    desiredMaxHeight: 360,
  });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const items = menuItems(menuRef.current);
      focusMenuItem(menuRef.current, initialFocus === "last" ? items.length - 1 : 0);
    });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [anchorRef, initialFocus, menuRef, onClose, open]);

  if (!open) return null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusMenuItem(menuRef.current, current + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusMenuItem(menuRef.current, event.key === "Home" ? 0 : items.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.click();
    } else if (event.key === "Tab") {
      window.setTimeout(() => onClose(false), 0);
    }
  };

  return (
    <BoardDialogPortal>
      <div
        ref={menuRef}
        id={id}
        role="menu"
        aria-label={label}
        data-board-anchored-menu
        data-placement={position.placement}
        draggable={false}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          visibility: position.ready ? "visible" : "hidden",
        }}
        className="mw-layer-page-popover fixed overflow-y-auto rounded-xl border border-mw-line bg-mw-card p-1.5 text-left text-mw-fg shadow-xl"
      >
        {children}
      </div>
    </BoardDialogPortal>
  );
}

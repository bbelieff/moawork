"use client";

import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { BoardDialogPortal } from "./BoardDialogPortal";
import { useAnchoredPosition } from "./BoardAnchoredMenu";

export function ColumnExpandedPanel({
  open,
  anchorRef,
  label,
  onClose,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  label: string;
  onClose(restoreFocus: boolean): void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const anchorMissing = useCallback(() => onClose(false), [onClose]);
  const position = useAnchoredPosition({
    open,
    anchorRef,
    surfaceRef: panelRef,
    onAnchorMissing: anchorMissing,
    desiredWidth: 480,
    desiredMaxHeight: 560,
  });

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
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
        aria-modal="false"
        aria-label={label}
        data-column-expanded-panel
        data-placement={position.placement}
        tabIndex={-1}
        draggable={false}
        onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
          visibility: position.ready ? "visible" : "hidden",
        }}
        className="mw-layer-page-popover fixed overflow-y-auto rounded-xl border border-mw-line bg-mw-card p-4 text-mw-fg shadow-xl"
      >
        <header className="mb-3 flex items-start justify-between gap-3 border-b border-mw-line pb-3">
          <div>
            <p className="text-xs font-medium text-mw-sub">컬럼 확장</p>
            <h2 className="text-base font-semibold">{label}</h2>
          </div>
          <button type="button" onClick={() => onClose(true)} className="rounded-lg border border-mw-line px-2 py-1 text-sm text-mw-sub hover:bg-mw-bg">닫기</button>
        </header>
        {children}
      </div>
    </BoardDialogPortal>
  );
}

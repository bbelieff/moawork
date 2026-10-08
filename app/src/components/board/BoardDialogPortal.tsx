"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * 표의 sticky/overflow stacking context 밖에서 보드 대화상자를 그린다.
 * 서버 렌더에서는 내용을 그대로 반환해 마크업·접근성 검사를 유지한다.
 */
export function BoardDialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return children;
  return createPortal(children, document.body);
}

/** 보드 전역 모달의 공통 backdrop/키보드/레이어 계약. */
export function BoardModalLayer({
  label,
  labelledBy,
  onClose,
  dismissible = true,
  returnFocusRef,
  ownsEscape,
  layerClassName = "items-center justify-center p-3",
  children,
}: {
  label?: string;
  labelledBy?: string;
  onClose(): void;
  dismissible?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Esc 를 대화상자 안의 입력이 먼저 쓰는가(예: 고치던 이름 되돌리기). true 면 닫지 않고 그 입력에 넘긴다.
   * 없으면 Esc 는 언제나 대화상자를 닫는다(기존 동작).
   */
  ownsEscape?: (event: KeyboardEvent) => boolean;
  /** 패널을 놓는 자리(정렬·여백). 기본은 가운데. 바닥 시트처럼 다른 자리가 필요할 때만 바꾼다. */
  layerClassName?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const ownsEscapeRef = useRef(ownsEscape);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { dismissibleRef.current = dismissible; }, [dismissible]);
  useEffect(() => { ownsEscapeRef.current = ownsEscape; }, [ownsEscape]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const explicitReturnFocus = returnFocusRef?.current;
    const focusable = () => [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])',
    ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
    const frame = window.requestAnimationFrame(() => {
      // A form may already focus its title or invalid field during mount.
      if (!dialogRef.current?.contains(document.activeElement)) {
        (focusable()[0] ?? dialogRef.current)?.focus();
      }
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissibleRef.current) {
        if (ownsEscapeRef.current?.(event)) return;
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      const restore = explicitReturnFocus?.isConnected ? explicitReturnFocus : previouslyFocused;
      if (restore?.isConnected) window.requestAnimationFrame(() => restore.focus());
    };
  }, [returnFocusRef]);

  return (
    <BoardDialogPortal>
      <div
        data-board-modal-scrim
        className="mw-layer-scrim fixed inset-0 bg-black/45"
        onPointerDown={() => {
          if (dismissible) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        data-board-modal-layer
        tabIndex={-1}
        className={`mw-layer-dialog fixed inset-0 flex ${layerClassName}`}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget && dismissible) onClose();
        }}
      >
        {children}
      </div>
    </BoardDialogPortal>
  );
}

"use client";

import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";

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
  children,
}: {
  label?: string;
  labelledBy?: string;
  onClose(): void;
  children: ReactNode;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);

  return (
    <BoardDialogPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        data-board-modal-layer
        className="mw-layer-dialog fixed inset-0 flex items-center justify-center bg-black/45 p-3"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {children}
      </div>
    </BoardDialogPortal>
  );
}

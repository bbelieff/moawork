"use client";

/**
 * 「휴지통으로 이동」 확인 — #845 개선안(2026-10-08). 제목 ▾ 메뉴가 연다(탭을 지울 권한이 있을 때만).
 *
 * 옛 보드 설정 › 「탭 삭제」 를 대신한다. 지울 내용 개수·복구 안내(서버가 세어 스트리밍하는 부분)는
 * 화면이 children 으로 넘기고, 실제 삭제는 같은 deleteBoardAction 폼이다(권한·위험 기록은 서버가 한다).
 * 지우는 확인이므로 처음 초점은 「취소」 에 둔다. Esc·바깥 누르기로 닫히고 연 단추로 초점이 돌아간다.
 */

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { BoardModalLayer } from "./BoardDialogPortal";
import { useBoardActionError } from "./BoardActionErrorContext";
import { useTabChrome } from "./tab-chrome";

export function TabTrashDialog({
  boardId,
  title,
  deleteAction,
  children,
}: {
  boardId: string;
  /** 「‘탭 이름’을 휴지통으로 옮길까요?」 — 조사(을/를)는 화면이 고른다. */
  title: string;
  deleteAction: (formData: FormData) => Promise<void>;
  /** 지울 내용 개수와 복구 안내. */
  children?: ReactNode;
}) {
  const chrome = useTabChrome();
  if (!chrome?.trashOpen) return null;
  return (
    <TrashSurface boardId={boardId} title={title} deleteAction={deleteAction} onClose={chrome.closeTrash} returnFocusRef={chrome.trashReturnFocusRef}>
      {children}
    </TrashSurface>
  );
}

function TrashSurface({
  boardId,
  title,
  deleteAction,
  onClose,
  returnFocusRef,
  children,
}: {
  boardId: string;
  title: string;
  deleteAction: (formData: FormData) => Promise<void>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const titleId = `${useId().replace(/:/gu, "")}-trash-title`;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const actionError = useBoardActionError();
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <BoardModalLayer labelledBy={titleId} onClose={onClose} returnFocusRef={returnFocusRef}>
      <div
        data-tab-trash-dialog
        className="w-[min(460px,calc(100vw-24px))] rounded-[14px] border border-mw-line bg-mw-card p-5 text-mw-fg shadow-2xl"
      >
        <h2 id={titleId} className="text-[length:var(--fs-16)] font-semibold text-mw-fg">{title}</h2>
        <div className="mt-2">{children}</div>
        {actionError ? (
          <p role="alert" className="mt-3 rounded-lg border px-3 py-2 text-[length:var(--fs-13)] text-mw-fg" style={{ borderColor: "var(--mw-error)" }}>
            {actionError}
          </p>
        ) : null}
        <form action={deleteAction} className="mt-4 flex justify-end gap-2">
          <input type="hidden" name="boardId" value={boardId} />
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-mw-line px-3.5 text-[length:var(--fs-13)] text-mw-body hover:bg-[color:var(--mw-board-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary"
          >
            취소
          </button>
          <TrashSubmit />
        </form>
      </div>
    </BoardModalLayer>
  );
}

function TrashSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-disabled={pending || undefined}
      onClick={(event) => { if (pending) event.preventDefault(); }}
      className="h-9 rounded-lg bg-mw-error px-3.5 text-[length:var(--fs-13)] font-semibold text-mw-on-accent hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-primary aria-disabled:opacity-60"
    >
      {pending ? "옮기는 중…" : "휴지통으로 이동"}
    </button>
  );
}

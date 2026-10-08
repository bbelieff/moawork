"use client";

/**
 * 행 하나를 휴지통으로 옮기고 「되돌리기」 알림을 띄운다 — #845 개선안(2026-10-08, 승인 목업 Rows).
 *
 * 업체명 칸의 「삭제」 단추를 걷어 내고, 지우기는 상세 ⋯ 메뉴·행 우클릭 메뉴(·여러 개 고른 뒤 일괄 막대)에서 한다.
 * 그 두 곳이 같은 길을 쓰게 여기 모았다.
 *   · moveItemToTrash — 기존 trashItemAction(work.item_delete 검사·service.deleteItem)을 그대로 부르고 결과를 알린다.
 *   · ItemTrashUndoToast — 보드에 하나. 「「이름」을 휴지통으로 옮겼어요 · 되돌리기」 를 약 8초 보이고,
 *     되돌리기는 기존 restoreItemAction 을 부른다. 마우스를 올리거나 초점이 들어오면 시간이 멈춘다.
 *
 * ★ 알림이 행 «밖» 에 있어야 한다 — 옮기고 나면 그 행(과 그 행의 상세)은 화면에서 사라진다.
 *   그래서 행이 아니라 보드(BoardWorkspace)가 알림을 하나 들고, 행·상세는 창 이벤트로 알린다
 *   (상세 열기 요청과 같은 방식, lib/boards/item-detail-open).
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { restoreItemAction, trashItemAction } from "@/app/(app)/boards/trash-actions";
import { INITIAL_TRASH_ACTION_STATE, type TrashActionState } from "@/app/(app)/boards/trash-action-state";
import { eulReul } from "@/lib/text/josa";
import { noticeLive, noticeRole } from "@/lib/ui/result-notice";
import { BoardDialogPortal } from "./BoardDialogPortal";

export const ITEM_TRASH_NOTICE_EVENT = "moawork:item-trash-notice";

/** 되돌리기를 보여 주는 시간(ms). */
export const ITEM_TRASH_UNDO_MS = 8000;

export type ItemTrashTarget = Readonly<{ boardId: string; itemId: string; title: string }>;

export type ItemTrashNotice =
  | Readonly<{ kind: "trashed"; target: ItemTrashTarget }>
  | Readonly<{ kind: "error"; boardId: string; message: string }>;

const TRASH_FAILED = "휴지통으로 옮기지 못했어요. 잠시 후 다시 시도해 주세요.";
const RESTORE_FAILED = "되돌리지 못했어요. 휴지통에서 복구해 주세요.";

function announce(notice: ItemTrashNotice) {
  window.dispatchEvent(new CustomEvent<ItemTrashNotice>(ITEM_TRASH_NOTICE_EVENT, { detail: notice }));
}

function targetForm(target: ItemTrashTarget): FormData {
  const data = new FormData();
  data.set("boardId", target.boardId);
  data.set("itemId", target.itemId);
  return data;
}

/** 행 하나를 휴지통으로 옮긴다. 성공하면 되돌리기 알림을, 실패하면 사유를 보드 알림으로 띄운다. */
export async function moveItemToTrash(target: ItemTrashTarget): Promise<TrashActionState> {
  let result: TrashActionState;
  try {
    result = await trashItemAction(INITIAL_TRASH_ACTION_STATE, targetForm(target));
  } catch {
    result = { ok: false, message: TRASH_FAILED };
  }
  announce(result.ok
    ? { kind: "trashed", target }
    : { kind: "error", boardId: target.boardId, message: result.message ?? TRASH_FAILED });
  return result;
}

type ToastState =
  | { kind: "trashed"; target: ItemTrashTarget; error: string | null }
  | { kind: "error"; message: string };

/** 보드마다 하나 — 행·상세가 보낸 알림을 받아 화면 아래 가운데에 띄운다. */
export function ItemTrashUndoToast({ boardId, durationMs = ITEM_TRASH_UNDO_MS }: { boardId: string; durationMs?: number }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [restoring, startRestore] = useTransition();
  const timerRef = useRef<number | null>(null);
  const heldRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const startTimer = useCallback(() => {
    stopTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setToast(null);
    }, durationMs);
  }, [durationMs, stopTimer]);

  useEffect(() => {
    const onNotice = (event: Event) => {
      const notice = (event as CustomEvent<ItemTrashNotice>).detail;
      const noticeBoard = notice.kind === "trashed" ? notice.target.boardId : notice.boardId;
      if (noticeBoard !== boardId) return;
      setToast(notice.kind === "trashed"
        ? { kind: "trashed", target: notice.target, error: null }
        : { kind: "error", message: notice.message });
      // 새 알림은 새 시간으로 — 앞 알림이 마우스를 올린 채 사라졌어도(되돌리기를 누른 경우) 멈춘 채로 두지 않는다.
      heldRef.current = false;
      startTimer();
    };
    window.addEventListener(ITEM_TRASH_NOTICE_EVENT, onNotice);
    return () => {
      window.removeEventListener(ITEM_TRASH_NOTICE_EVENT, onNotice);
      stopTimer();
    };
  }, [boardId, startTimer, stopTimer]);

  const failed = toast !== null && (toast.kind === "error" || toast.error !== null);
  const message = toast === null ? ""
    : toast.kind === "error" ? toast.message
      : toast.error ?? `「${toast.target.title}」${eulReul(toast.target.title)} 휴지통으로 옮겼어요`;
  const hold = () => { heldRef.current = true; stopTimer(); };
  const release = () => { heldRef.current = false; if (!restoring) startTimer(); };

  const undo = () => {
    if (toast?.kind !== "trashed") return;
    const target = toast.target;
    stopTimer();
    startRestore(async () => {
      let result: TrashActionState;
      try {
        result = await restoreItemAction(INITIAL_TRASH_ACTION_STATE, targetForm(target));
      } catch {
        result = { ok: false, message: RESTORE_FAILED };
      }
      if (result.ok) {
        setToast(null);
        return;
      }
      setToast({ kind: "trashed", target, error: result.message ?? RESTORE_FAILED });
      if (!heldRef.current) startTimer();
    });
  };

  /*
   * ★ 알림 영역은 늘 붙어 있고 글자만 바뀐다 — 영역과 글자가 함께 생기면 화면낭독기가 놓치기 쉽다.
   *   성공은 status(polite), 실패는 alert(assertive) 로 따로 둔다(판정에서 role·live 를 함께 얻는다).
   *   눈에 보이는 알림은 포털에 따로 그리고 live 속성을 두지 않는다(두 번 읽히지 않게).
   *   포털 밖(이 자리)에 두어 서버 렌더와 첫 화면이 같다.
   */
  return (
    <>
      <p className="sr-only" role={noticeRole(true)} aria-live={noticeLive(true)} data-item-trash-live="status">
        {toast && !failed ? message : ""}
      </p>
      <p className="sr-only" role={noticeRole(false)} aria-live={noticeLive(false)} data-item-trash-live="alert">
        {failed ? message : ""}
      </p>
      {toast ? (
        <BoardDialogPortal>
          <div
            data-item-trash-toast={toast.kind}
            onMouseEnter={hold}
            onMouseLeave={release}
            onFocus={hold}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release(); }}
            className="mw-layer-toast fixed bottom-5 left-1/2 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-[var(--mw-r-2)] bg-mw-fg py-2 pl-4 pr-2 text-[length:var(--fs-13)] text-mw-card shadow-xl"
          >
            <span className="min-w-0 truncate">{message}</span>
            {toast.kind === "trashed" ? (
              <button
                type="button"
                onClick={undo}
                disabled={restoring}
                className="shrink-0 rounded-md px-2 py-1 font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-card disabled:opacity-60"
                style={{ color: "color-mix(in srgb, var(--mw-record) 40%, var(--mw-card))" }}
              >
                {restoring ? "되돌리는 중…" : "되돌리기"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { stopTimer(); heldRef.current = false; setToast(null); }}
              aria-label="알림 닫기"
              className="grid size-7 shrink-0 place-items-center rounded-md opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mw-card"
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </BoardDialogPortal>
      ) : null}
    </>
  );
}

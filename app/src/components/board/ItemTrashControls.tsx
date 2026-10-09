"use client";

// 행 하나를 휴지통으로 옮기는 길은 ItemTrashUndo(상세 ⋯·행 우클릭 + 되돌리기 알림)로 옮겼다(#845, 2026-10-08).
// 여기에는 휴지통 화면의 「복구」 단추만 남는다.

import { useActionState } from "react";
import { restoreItemAction } from "@/app/(app)/boards/trash-actions";
import { INITIAL_TRASH_ACTION_STATE } from "@/app/(app)/boards/trash-action-state";

interface ItemActionProps {
  boardId: string;
  itemId: string;
  title: string;
}

export function RestoreItemButton({ boardId, itemId, title }: ItemActionProps) {
  const [state, action, pending] = useActionState(restoreItemAction, INITIAL_TRASH_ACTION_STATE);

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${title} 복구`}
        className="rounded-lg border border-mw-line px-2.5 py-1 text-xs text-mw-body hover:bg-mw-bg disabled:opacity-50"
      >
        {pending ? "복구 중…" : "복구"}
      </button>
      {!state.ok && state.message ? (
        <span role="alert" className="max-w-56 text-right text-xs text-mw-error">{state.message}</span>
      ) : null}
    </form>
  );
}

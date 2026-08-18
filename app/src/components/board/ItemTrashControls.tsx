"use client";

import { useActionState } from "react";
import { restoreItemAction, trashItemAction } from "@/app/(app)/boards/trash-actions";
import { INITIAL_TRASH_ACTION_STATE } from "@/app/(app)/boards/trash-action-state";

interface ItemActionProps {
  boardId: string;
  itemId: string;
  title: string;
}

export function TrashItemButton({ boardId, itemId, title }: ItemActionProps) {
  const [state, action, pending] = useActionState(trashItemAction, INITIAL_TRASH_ACTION_STATE);

  return (
    <form action={action} className="flex shrink-0 flex-col items-end gap-1">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="itemId" value={itemId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${title} 휴지통으로 이동`}
        className="px-1 text-xs text-mw-sub opacity-60 hover:text-mw-error focus-visible:opacity-100 disabled:opacity-40 group-hover:opacity-100"
      >
        {pending ? "…" : "삭제"}
      </button>
      {!state.ok && state.message ? (
        <span role="alert" className="max-w-48 text-right text-xs text-mw-error">{state.message}</span>
      ) : null}
    </form>
  );
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

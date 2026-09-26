"use client";

import { useState, useTransition } from "react";
import { bulkRestoreArchivedAction } from "@/app/(app)/boards/bulk-archive-actions";

export function RestoreArchivedButton({
  boardId,
  itemId,
  title,
}: {
  boardId: string;
  itemId: string;
  title: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending || done}
        aria-label={`${title} 보관 복구`}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const next = await bulkRestoreArchivedAction({ boardId, items: [itemId] });
            const entry = next.results[0];
            if (entry?.ok) {
              setDone(true);
            } else {
              setMessage(entry?.message ?? "복구하지 못했습니다.");
            }
          });
        }}
        className="rounded-lg border border-mw-line px-2.5 py-1 text-xs text-mw-body hover:bg-mw-bg disabled:opacity-50"
      >
        {done ? "복구됨" : pending ? "복구 중…" : "복구"}
      </button>
      {message ? (
        <span role="alert" className="max-w-56 text-right text-xs text-mw-error">{message}</span>
      ) : null}
    </span>
  );
}

export function RestoreAllArchivedButton({
  boardId,
  itemIds,
}: {
  boardId: string;
  itemIds: string[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (itemIds.length <= 1) return null;

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const next = await bulkRestoreArchivedAction({ boardId, items: itemIds });
            setMessage(
              next.failed === 0
                ? `${next.applied}개를 복구했습니다.`
                : `${next.applied}개 복구·${next.failed}개 실패 — 실패한 것만 다시 눌러주세요.`,
            );
          });
        }}
        className="rounded border border-mw-line px-2.5 py-1 text-xs font-medium text-mw-body hover:bg-mw-bg disabled:opacity-50"
      >
        {pending ? "복구 중…" : `전체 복구 (${itemIds.length})`}
      </button>
      {message ? <span role="status" className="text-xs text-mw-body">{message}</span> : null}
    </span>
  );
}

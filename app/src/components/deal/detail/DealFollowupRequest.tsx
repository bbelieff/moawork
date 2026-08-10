"use client";

/**
 * 되돌려보내기(보완요청) — BBE-16 핵심 쓰임.
 *
 * "무엇이 빠졌는지"를 필수로 적게 하고, 그 내용을 타임라인에 "되돌려보내기" 종류의
 * 댓글로 남긴다(항상 durable — 나중에 요청자·담당자 모두 다시 볼 수 있다) + 현재
 * 담당자에게 `requested` 알림을 보낸다.
 */

import { useState, useTransition } from "react";
import { requestFollowupAction } from "@/app/(app)/deals/[dealId]/actions";

export function DealFollowupRequest({ dealId }: { dealId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        await requestFollowupAction(dealId, reason);
        setReason("");
        setOpen(false);
        setSent(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "보완요청을 보내지 못했습니다.");
      }
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSent(false);
          }}
          className="rounded-md border border-amber-400 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
        >
          되돌려보내기(보완요청)
        </button>
        {sent && <span className="text-xs text-zinc-400">담당자에게 보냈습니다.</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 p-3 dark:border-amber-800">
      <label className="flex flex-col gap-1 text-xs text-zinc-500">
        무엇이 빠졌는지 적어주세요(필수) — 담당자에게 그대로 전달됩니다.
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          disabled={pending}
          placeholder="예: 사업자등록증 사본 미첨부, 대표자 서명 누락"
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || reason.trim() === ""}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
        >
          보내기
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          취소
        </button>
      </div>
    </div>
  );
}

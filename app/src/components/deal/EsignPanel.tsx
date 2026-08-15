"use client";
import { useActionState } from "react";
import { requestEsignAction, type EsignActionState } from "@/app/(app)/deals/[dealId]/esign-actions";

export function EsignPanel({ dealId, initialStatus, initialError, canEdit }: { dealId: string; initialStatus: string | null; initialError?: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EsignActionState, FormData>(requestEsignAction, { ok: !initialError, message: initialError ? "전자계약 상태를 불러오지 못했어요." : initialStatus ? `전자계약 상태: ${initialStatus}` : "아직 전자계약을 요청하지 않았어요." });
  return <div className="rounded-lg border border-[var(--mw-border)] p-4" data-testid="esign-panel">
    <p className="text-sm font-medium">전자계약</p><p className="mt-1 text-sm text-[var(--mw-text-muted)]" role="status">{state.message}</p>
    <form action={action} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="dealId" value={dealId}/>
      <input name="templateId" required placeholder="템플릿 ID" disabled={!canEdit || pending} className="rounded-md border px-3 py-2 text-sm"/>
      <input name="signerReference" required placeholder="서명자 참조값" disabled={!canEdit || pending} className="rounded-md border px-3 py-2 text-sm"/>
      <button disabled={!canEdit || pending} className="rounded-md bg-[var(--mw-primary)] px-3 py-2 text-sm text-white disabled:opacity-50">{pending ? "요청 중…" : "서명 요청 준비"}</button>
    </form>
    <p className="mt-2 text-xs text-[var(--mw-text-muted)]">실제 발송은 보안 자격증명과 외부 발행 승인이 설정된 뒤 outbox에서 처리됩니다.</p>
  </div>;
}

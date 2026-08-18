"use client";
import { useActionState } from "react";
import { requestEsignAction, type EsignActionState } from "@/app/(app)/deals/[dealId]/esign-actions";

export function EsignPanel({ dealId, initialStatus, initialError, canEdit }: { dealId: string; initialStatus: string | null; initialError?: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EsignActionState, FormData>(requestEsignAction, { ok: !initialError, message: initialError ? "전자계약 상태를 불러오지 못했어요." : initialStatus ? `전자계약 상태: ${initialStatus}` : "아직 전자계약을 요청하지 않았어요." });
  // 판정 근거(state.ok)는 처음부터 있었는데 렌더가 한 번도 읽지 않았다 — 전자계약 오류가
  // 정상 안내와 똑같은 회색이었다. role 과 색을 같은 근거로 함께 분기한다(BBE-193).
  // --mw-border·--mw-text-muted 는 정의된 적 없는 토큰이라 테두리·글자색이 먹지 않았다.
  // 정본은 --mw-line·--mw-sub 다.
  return <div className="rounded-lg border border-[var(--mw-line)] p-4" data-testid="esign-panel">
    <p className="text-sm font-medium">전자계약</p><p className={`mt-1 text-sm ${state.ok ? "text-[var(--mw-sub)]" : "text-[var(--mw-error)]"}`} role={state.ok ? "status" : "alert"}>{state.message}</p>
    <form action={action} className="mt-3 flex flex-wrap gap-2">
      <input type="hidden" name="dealId" value={dealId}/>
      <input name="templateId" required placeholder="템플릿 ID" disabled={!canEdit || pending} className="rounded-md border px-3 py-2 text-sm"/>
      <input name="signerReference" required placeholder="서명자 참조값" disabled={!canEdit || pending} className="rounded-md border px-3 py-2 text-sm"/>
      <button disabled={!canEdit || pending} className="rounded-md bg-[var(--mw-primary)] px-3 py-2 text-sm text-white disabled:opacity-50">{pending ? "요청 중…" : "서명 요청 준비"}</button>
    </form>
    <p className="mt-2 text-xs text-[var(--mw-sub)]">실제 발송은 보안 자격증명과 외부 발행 승인이 설정된 뒤 outbox에서 처리됩니다.</p>
  </div>;
}

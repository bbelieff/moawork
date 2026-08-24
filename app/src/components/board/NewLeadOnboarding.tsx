"use client";

import { useActionState, useState } from "react";
import { saveNewLeadOnboardingAction } from "@/app/(app)/boards/new-lead-onboarding-actions";

export function NewLeadOnboarding({ boardId, autoOpen }: { boardId: string; autoOpen: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const [manualReopened, setManualReopened] = useState(false);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(saveNewLeadOnboardingAction, { ok: false, message: "" });
  const visible = open && (!state.ok || manualReopened);
  return (
    <section aria-label="신규리드 도움말" className="rounded-xl border border-mw-line bg-mw-card p-3">
      <button type="button" onClick={() => { setRequestId(crypto.randomUUID()); setManualReopened(true); setOpen(true); }} className="min-h-11 rounded-lg border border-mw-line px-3 text-sm font-semibold">신규리드 도움말</button>
      {visible ? (
        <div role="dialog" aria-modal="false" aria-label="신규리드 시작 안내" className="mt-3 grid gap-3 rounded-xl bg-mw-bg p-4">
          <h2 className="text-base font-bold text-mw-fg">신규리드 시작하기</h2>
          <ol className="grid gap-2 text-sm text-mw-body">
            <li>1. ‘새 항목’에서 업체명과 사업자 구분만 먼저 등록해요.</li>
            <li>2. 행의 ‘열기’에서 연락처, 협업자, 기록과 첨부를 보완해요.</li>
            <li>3. 상담이 준비되면 상세의 ‘리드컨택으로 넘기기’를 사용해요.</li>
          </ol>
          {state.message && !state.ok ? <p role="alert" className="text-sm text-mw-error">{state.message}</p> : null}
          <div className="flex flex-wrap gap-2">
            {(["completed", "dismissed"] as const).map((value) => (
              <form action={action} key={value}>
                <input type="hidden" name="boardId" value={boardId} />
                <input type="hidden" name="state" value={value} />
                <input type="hidden" name="requestId" value={requestId} />
                <button type="submit" disabled={pending} className={value === "completed" ? "min-h-11 rounded-lg bg-mw-primary px-4 text-sm font-bold text-mw-on-accent" : "min-h-11 rounded-lg border border-mw-line px-4 text-sm"}>
                  {value === "completed" ? "확인했어요" : "나중에 볼게요"}
                </button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

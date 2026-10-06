"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/**
 * 회사 상세의 「업무 시작」 (#6).
 *
 * ★ 제출 중에는 버튼을 막는다 — 서버가 결과로 페이지를 다시 그리기 전의 연타를 받지 않는다.
 *   (같은 렌더 안의 연타는 같은 request 열쇠라 RPC 가 하나로 묶는다. 이건 그 위의 한 겹이다.)
 * ★ 이 회사에 «이미 살아 있는 업무 행» 이 있으면 한 번 묻는다.
 *   막지는 않는다 — 한 회사에 자금 건이 여러 번 생기는 것이 정상이다(1:N).
 *   성공 뒤 페이지가 새 열쇠로 다시 그려지므로, 묻지 않으면 다음 클릭이 줄을 하나 더 만든다.
 * ★ 확인은 «그 요청 열쇠» 에만 속한다. 결과 redirect 는 검색어만 바뀌어 Next 가 이 컴포넌트의
 *   상태를 그대로 둔다 — 열쇠에 묶지 않으면 성공 배너 옆에 지난 확인과 「하나 더 시작」 이 남아,
 *   한 번 더 누르면 새 열쇠로 줄이 하나 더 생긴다. 새 열쇠면 확인은 닫힌 상태에서 다시 묻는다.
 */
export function CompanyWorkStartForm({
  companyId,
  requestId,
  liveWorkRowCount,
  action,
}: {
  companyId: string;
  requestId: string;
  liveWorkRowCount: number;
  action: (formData: FormData) => Promise<void>;
}) {
  // 확인을 연 «요청 열쇠». 렌더의 열쇠와 같을 때만 열려 있다 — 새 열쇠가 오면 저절로 닫힌다.
  const [confirmingFor, setConfirmingFor] = useState<string | null>(null);
  const confirming = confirmingFor === requestId;
  // 「하나 더 시작」 을 «이번 제출에서» 눌렀는지. 제출마다 한 번 읽고 지운다.
  const confirmed = useRef(false);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const wasConfirmed = confirmed.current;
        confirmed.current = false;
        if (liveWorkRowCount > 0 && !wasConfirmed) {
          event.preventDefault();
          setConfirmingFor(requestId);
        }
      }}
      className="flex flex-col items-end gap-2"
    >
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="requestId" value={requestId} />
      <WorkStartControls
        confirming={confirming}
        liveWorkRowCount={liveWorkRowCount}
        onConfirm={() => { confirmed.current = true; }}
        onCancel={() => setConfirmingFor(null)}
      />
    </form>
  );
}

/** useFormStatus 는 «폼 안» 의 자식에서만 제출 상태를 본다 — 그래서 따로 둔다. */
function WorkStartControls({
  confirming,
  liveWorkRowCount,
  onConfirm,
  onCancel,
}: {
  confirming: boolean;
  liveWorkRowCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="min-h-11 rounded-lg bg-mw-primary px-4 py-2 text-sm font-semibold text-mw-on-accent hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mw-primary disabled:opacity-50"
      >
        {pending ? "시작하는 중…" : "업무 시작"}
      </button>
      {confirming ? (
        <div role="group" aria-label="업무 추가 시작 확인" className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <p role="status" className="text-mw-fg">
            이 업체는 이미 진행 중인 업무가 {liveWorkRowCount}건 있어요 · 하나 더 시작할까요?
          </p>
          <button
            type="submit"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-mw-primary px-3 py-1.5 text-sm font-semibold text-mw-on-accent disabled:opacity-50"
          >
            하나 더 시작
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-mw-line px-3 py-1.5 text-sm text-mw-sub hover:text-mw-fg disabled:opacity-50"
          >
            취소
          </button>
        </div>
      ) : null}
    </>
  );
}

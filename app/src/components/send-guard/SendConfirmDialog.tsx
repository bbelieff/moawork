/**
 * 발송 확인 화면 (BBE-148) — 값을 바꿔도 «즉시 안 나가고» 여기를 한 번 지난다.
 *
 * 탭 화면이 아니다. 발송 칸을 쓰는 모든 탭이 이 부품을 그대로 띄운다.
 *
 * ## 왜 클라이언트 JS 없이 만들었나
 *
 * 「확인 버튼은 건수를 직접 입력해야 눌린다」를 `disabled` 토글로 만들면 **JS 가 죽은 순간
 * 잠금도 죽는다.** 여기서는 브라우저 기본 폼 검증(`required` + `pattern`)으로 막는다 —
 * JS 가 없어도 제출 자체가 되지 않는다. 그리고 서버(`confirmSend`)가 같은 것을 한 번 더 센다.
 * 잠금이 세 겹인 이유는 이 칸이 되돌릴 수 없기 때문이다.
 *
 * 375px: 좌우 2열을 쓰지 않는다. 숫자 → 내역 → 문구 → 확인 순서로 한 줄씩 쌓인다.
 */

// ★ 배럴(`@/lib/send-guard`)로 가져오지 않는다. 배럴은 `plan.ts` 를 끌고 오고 그것은
// `node:crypto` 를 부른다 — 소비하는 쪽이 이 화면을 `"use client"` 안에서 그리면 빌드가 깨진다.
// 값은 순수한 두 모듈에서만 가져오고, 나머지는 타입으로만 받는다.
import type { SendPlan } from "@/lib/send-guard/types";
import { exclusionCounts } from "@/lib/send-guard/exclusions";
import { SMS_SHORT_LIMIT, templateLength } from "@/lib/send-guard/template";

type FormAction = string | ((formData: FormData) => void | Promise<void>);

const PANEL =
  "w-[min(30rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-4 text-mw-fg shadow-xl sm:p-5";

const ROW = "flex items-baseline justify-between gap-3 py-1 text-xs";

function won(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

/**
 * @param plan          `planSend()` 의 결과. 이 객체가 화면과 요청을 묶는다.
 * @param sendAction    확인 폼이 낼 곳. 서버에서 `confirmSend()` 를 다시 통과해야 한다.
 * @param cancelAction  닫기. 없으면 닫기 버튼을 그리지 않는다(모달 밖 클릭으로 닫는 화면용).
 * @param senderLabel   보내는 회사 이름 — 「누구에게」의 반대쪽을 보여준다.
 */
export function SendConfirmDialog({
  plan,
  ticketId,
  sendAction,
  cancelAction,
  senderLabel,
}: {
  plan: SendPlan;
  /**
   * 이 화면을 그리기 직전에 서버가 발급한 확인표 id(`issueConfirmationTicket`).
   * 폼이 이것을 그대로 되돌려주고, 서버가 태운다 — «사람이 이 화면을 지났다» 의 유일한 증거다.
   */
  ticketId: string;
  sendAction: FormAction;
  cancelAction?: FormAction;
  senderLabel?: string;
}) {
  const count = plan.sendable.length;
  const excluded = exclusionCounts(plan);
  const length = templateLength(plan.previewText);
  const longMessage = length > SMS_SHORT_LIMIT;
  const nothingToSend = count === 0;
  // 대상 이름은 처음 5건만 적는다. 더 있으면 「외 N곳」 — 375px 에서 목록이 화면을 삼키지 않게.
  const shownNames = plan.sendable.slice(0, 5);
  const restCount = count - shownNames.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mw-send-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
    >
      <div className={PANEL}>
        <p className="text-[0.65rem] font-semibold tracking-wide text-mw-error">
          ✉ 발송 — 되돌릴 수 없습니다
        </p>
        <h2 id="mw-send-confirm-title" className="mt-1 text-base font-semibold">
          «{plan.columnLabel}» 을(를) «{plan.value}» 로 바꿉니다
        </h2>
        <p className="mt-1 text-xs text-mw-sub">
          이 값으로 바꾸면 아래 고객에게 문자가 나가고 건당 비용이 듭니다.
        </p>

        {/* ── 몇 건 — 이 화면에서 가장 큰 글자 ── */}
        <p className="mt-4 flex items-baseline gap-1.5">
          <span className="text-4xl font-bold tabular-nums leading-none">
            {count.toLocaleString("ko-KR")}
          </span>
          <span className="text-sm text-mw-sub">건 발송</span>
        </p>

        {/* ── 누구에게 ── */}
        <div className="mt-3 rounded-lg bg-mw-bg p-3">
          <p className="text-[0.65rem] font-semibold text-mw-sub">누구에게</p>
          {nothingToSend ? (
            <p className="mt-1 text-xs text-mw-body">보낼 수 있는 건이 없습니다.</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {shownNames.map((target) => (
                <li key={target.itemId} className="flex justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate text-mw-body">{target.title}</span>
                  <span className="shrink-0 tabular-nums text-mw-sub">{target.phoneMasked}</span>
                </li>
              ))}
              {restCount > 0 && (
                <li className="text-xs text-mw-sub">외 {restCount.toLocaleString("ko-KR")}곳</li>
              )}
            </ul>
          )}
        </div>

        {/* ── 셈 — 걸린 건 · 못 보내는 건 · 비용 ── */}
        <div className="mt-3 divide-y divide-mw-line border-y border-mw-line">
          <div className={ROW}>
            <span className="text-mw-sub">조건에 걸린 건</span>
            <b className="tabular-nums">{plan.requestedCount.toLocaleString("ko-KR")}건</b>
          </div>
          {excluded.length === 0 ? (
            <div className={ROW}>
              <span className="text-mw-sub">빠진 건</span>
              <b className="tabular-nums">0건</b>
            </div>
          ) : (
            excluded.map((item) => (
              <div key={item.reason} className={ROW}>
                <span className="text-mw-warning">{item.reason}이라 빠짐</span>
                <b className="tabular-nums text-mw-warning">{item.count.toLocaleString("ko-KR")}건</b>
              </div>
            ))
          )}
          <div className={ROW}>
            <span className="text-mw-sub">건당 {won(plan.unitCostKrw)} · 예상 비용</span>
            <b className="tabular-nums">{won(plan.estimatedCostKrw)}</b>
          </div>
        </div>

        {/* ── 무슨 문구 — 변수까지 치환된 «실제로 나갈» 문장 ──
            보낼 건이 없으면 문장을 보여 주지 않는다. 나가지 않을 문장을 «실제로 나갈 문장»
            이라고 띄우면 그것이 곧 거짓말이다. */}
        <div className="mt-3 rounded-lg border border-mw-line bg-mw-bg p-3">
          {nothingToSend ? (
            <>
              <p className="text-[0.65rem] font-semibold text-mw-sub">무슨 문구</p>
              <p className="mt-1 text-xs text-mw-body">
                보낼 건이 없어 나갈 문장이 없습니다.
              </p>
            </>
          ) : (
            <>
              <p className="text-[0.65rem] font-semibold text-mw-sub">
                무슨 문구 — 실제로 나갈 문장
                {plan.previewFor ? ` (${plan.previewFor} 앞)` : ""}
              </p>
              <p className="mt-1 break-words text-xs leading-relaxed text-mw-body">
                {plan.previewText}
              </p>
              <p className="mt-1.5 text-[0.65rem] text-mw-sub">
                {senderLabel ? `보내는 곳 ${senderLabel} · ` : ""}
                {plan.channel === "sms" ? "문자" : "알림톡"} · {length}자
                {longMessage ? " · 90자를 넘어 장문 요금이 붙습니다" : ""}
              </p>
              {plan.previewBodyMissing && (
                <p role="alert" className="mt-1.5 text-[0.65rem] font-semibold text-mw-error">
                  등록된 문구가 없습니다. 문구를 먼저 등록하세요.
                </p>
              )}
              {plan.previewMissingVariables.length > 0 && (
                <p role="alert" className="mt-1.5 text-[0.65rem] font-semibold text-mw-warning">
                  값이 없어 «—» 로 나가는 칸: {plan.previewMissingVariables.join(" · ")}
                </p>
              )}
            </>
          )}
        </div>

        {/* ── 확인 ── */}
        <form action={sendAction} className="mt-4">
          {/* 확인 화면이 보여 준 계획 그대로를 되돌려준다. 서버가 지문을 다시 맞춰 본다.
              확인표는 서버가 태운다 — 이것 없이는 요청이 만들어지지 않는다. */}
          <input type="hidden" name="ticketId" value={ticketId} />
          <input type="hidden" name="planFingerprint" value={plan.fingerprint} />
          <input type="hidden" name="acknowledgedCount" value={count} />

          {plan.requiresTypedCount && !nothingToSend && (
            <label className="block rounded-lg bg-mw-tint-coral p-3 text-xs">
              <span className="text-mw-body">
                되돌릴 수 없습니다. 확인을 위해 <b className="tabular-nums">{count}</b> 를 입력하세요
              </span>
              <input
                name="typedCount"
                required
                pattern={String(count)}
                inputMode="numeric"
                autoComplete="off"
                placeholder={String(count)}
                title={`${count} 를 그대로 입력하세요`}
                className="mt-1.5 w-24 rounded border border-mw-line bg-mw-card px-2 py-1 text-sm tabular-nums text-mw-fg outline-none focus:border-mw-error"
              />
            </label>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={nothingToSend}
              className="rounded-lg bg-mw-error px-3 py-1.5 text-sm font-semibold text-mw-on-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {nothingToSend ? "보낼 건 없음" : `${count.toLocaleString("ko-KR")}건 보내기`}
            </button>
            {cancelAction && (
              <button
                type="submit"
                formAction={cancelAction}
                formNoValidate
                className="rounded-lg border border-mw-line px-3 py-1.5 text-sm text-mw-body"
              >
                닫기
              </button>
            )}
          </div>
        </form>

        <p className="mt-2 text-[0.65rem] text-mw-sub">
          누가 몇 건을 보냈는지 각 건의 이력에 남습니다. 파일로 내보내지 않습니다.
        </p>
      </div>
    </div>
  );
}

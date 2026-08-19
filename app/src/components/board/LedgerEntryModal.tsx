"use client";

/**
 * 원장 입력 모달 (BBE-240) — `docs/design/정산-원장-화면-제안_v1.html` 의 #overlay 를 그대로 옮긴다.
 *
 * 메모(선택) 필드는 이번 단계 범위 밖이다(openRisks) — 만들지 않는다.
 */

import { useState, useTransition } from "react";
import { addDealLedgerEntryAction, type AddLedgerEntryInput } from "@/lib/accounting/actions";
import type { LedgerKind } from "@/lib/accounting/ledger";

export interface LedgerEntryModalProps {
  dealId: string;
  feeTerms: string | null;
  depositAlreadyReceived: boolean;
  onClose(): void;
  onSaved(): void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseWon(raw: string): number {
  const n = Number(raw.replace(/[,\s원]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

const FIELD = "w-full rounded-md border border-mw-line bg-mw-card px-3 py-1.5 text-sm text-mw-fg";
const CHECKLINE = "mt-2 flex items-center gap-2 text-xs text-mw-body";

export function LedgerEntryModal({
  dealId,
  feeTerms,
  depositAlreadyReceived,
  onClose,
  onSaved,
}: LedgerEntryModalProps) {
  const [kind, setKind] = useState<LedgerKind>(depositAlreadyReceived ? "fee" : "contract_deposit");
  const [amount, setAmount] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(today());
  const [paidOn, setPaidOn] = useState(today());
  const [notYetPaid, setNotYetPaid] = useState(false);
  const [vatIncluded, setVatIncluded] = useState(false);
  const [taxInvoiceIssued, setTaxInvoiceIssued] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const vatFillAmount = (() => {
    const n = parseWon(amount);
    return Number.isFinite(n) ? Math.round(n * 1.1) : null;
  })();

  function submit(): void {
    setMessage(null);
    const parsedAmount = parseWon(amount);
    const parsedReceived = parseWon(receivedAmount);
    if (!Number.isFinite(parsedAmount) || !Number.isFinite(parsedReceived)) {
      setMessage("금액과 입금액을 숫자로 입력해 주세요.");
      return;
    }
    const input: AddLedgerEntryInput = {
      dealId,
      kind,
      amount: parsedAmount,
      receivedAmount: parsedReceived,
      occurredOn,
      paidOn: notYetPaid ? null : paidOn,
      vatIncluded,
      taxInvoiceIssued,
    };
    startTransition(() => {
      void addDealLedgerEntryAction(input).then((result) => {
        if (!result.ok) {
          setMessage(result.message);
          return;
        }
        onSaved();
        onClose();
      });
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ledger-entry-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-[min(30rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-4 text-mw-fg shadow-xl sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="ledger-entry-title" className="text-base font-semibold">원장에 기록하기</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="text-mw-sub">✕</button>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={depositAlreadyReceived}
            onClick={() => setKind("contract_deposit")}
            className={`min-h-9 flex-1 rounded-lg border px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
              kind === "contract_deposit" ? "border-mw-record bg-mw-tint-blue text-mw-record" : "border-mw-line text-mw-body"
            }`}
          >
            계약금
          </button>
          <button
            type="button"
            onClick={() => setKind("fee")}
            className={`min-h-9 flex-1 rounded-lg border px-3 py-1.5 text-sm font-semibold ${
              kind === "fee" ? "border-mw-record bg-mw-tint-blue text-mw-record" : "border-mw-line text-mw-body"
            }`}
          >
            수수료
          </button>
        </div>
        {depositAlreadyReceived && (
          <p className="mt-1.5 text-xs text-mw-sub">
            계약금은 이미 받았어요 — 그래서 자동으로 수수료가 선택됐어요. 다시 계약금을 고를 순 없어요(한 건당 한 번뿐이라).
          </p>
        )}

        {kind === "fee" && feeTerms && (
          <div className="mt-2 rounded-lg bg-mw-bg p-2 text-xs text-mw-body">
            📎 계약조건(자유기재) — {feeTerms}
          </div>
        )}

        <label className="mt-3 block text-xs font-semibold text-mw-sub" htmlFor="ledger-amount">금액(공급가)</label>
        <input
          id="ledger-amount"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={FIELD}
        />
        <p className="mt-1 text-[0.65rem] text-mw-sub">
          매출·수수료 계산은 이 금액(공급가)만 기준으로 해요. 계약조건은 참고용일 뿐 — 금액은 매번 직접 입력해요(자동계산 안 함).
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-mw-sub" htmlFor="ledger-received">입금액(실제 받은 전액)</label>
            <input
              id="ledger-received"
              inputMode="numeric"
              value={receivedAmount}
              onChange={(event) => setReceivedAmount(event.target.value)}
              className={FIELD}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-mw-sub" htmlFor="ledger-occurred">발생일</label>
            <input
              id="ledger-occurred"
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              className={FIELD}
            />
          </div>
        </div>
        <p className="mt-1 text-[0.65rem] text-mw-sub">
          부가세가 포함됐으면 받은 전체 금액을 그대로 적어요 — 매출은 금액(공급가)만으로 계산되니 여기 숫자는 매출에 영향 없어요.
        </p>

        <label className="mt-3 block text-xs font-semibold text-mw-sub" htmlFor="ledger-paid">입금일</label>
        <input
          id="ledger-paid"
          type="date"
          value={paidOn}
          disabled={notYetPaid}
          onChange={(event) => setPaidOn(event.target.value)}
          className={`${FIELD} disabled:opacity-40`}
        />
        <label className={CHECKLINE}>
          <input type="checkbox" checked={notYetPaid} onChange={(event) => setNotYetPaid(event.target.checked)} />
          아직 입금 전이에요
        </label>

        <label className={CHECKLINE}>
          <input type="checkbox" checked={vatIncluded} onChange={(event) => setVatIncluded(event.target.checked)} />
          부가세 포함해서 받았어요
        </label>
        {vatIncluded && (
          <div className="mt-1.5 rounded-lg bg-mw-tint-blue p-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mw-record">
              <span>{vatFillAmount !== null ? `부가세 포함 예상액 ${vatFillAmount.toLocaleString("ko-KR")}원 = 공급가 × 1.1` : "공급가를 먼저 입력해 주세요"}</span>
              <button
                type="button"
                disabled={vatFillAmount === null}
                onClick={() => setReceivedAmount(String(vatFillAmount ?? ""))}
                className="rounded-md bg-mw-record px-2 py-1 text-xs font-semibold text-mw-on-accent disabled:opacity-40"
              >
                입금액에 채우기
              </button>
            </div>
            <label className={CHECKLINE}>
              <input type="checkbox" checked={taxInvoiceIssued} onChange={(event) => setTaxInvoiceIssued(event.target.checked)} />
              세금계산서 발행함
            </label>
          </div>
        )}

        {message && (
          <p role="alert" className="mt-3 text-xs font-semibold text-mw-error">{message}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-mw-line px-3 py-1.5 text-sm text-mw-body">
            취소
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={submit}
            className="rounded-lg bg-mw-record px-3 py-1.5 text-sm font-semibold text-mw-on-accent disabled:opacity-40"
          >
            {pending ? "저장하는 중…" : "원장에 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

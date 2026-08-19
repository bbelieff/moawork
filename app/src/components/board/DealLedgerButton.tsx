"use client";

/**
 * 보드 행에서 여는 「📒 원장」 버튼 (BBE-240).
 *
 * 보드 행 팝업은 페이지 라우트 하나에 묶이지 않으므로, 저장 후 새로고침은
 * `loadDealLedgerAction` 재호출로 한다(`revalidatePath` 를 쓰지 않는다).
 */

import { useEffect, useState, useTransition } from "react";
import { DealLedgerPanel } from "@/components/accounting/DealLedgerPanel";
import { loadDealLedgerAction, type LedgerPopupState } from "@/lib/accounting/actions";
import { LedgerEntryModal } from "./LedgerEntryModal";

export interface DealLedgerButtonProps {
  dealId: string;
}

/**
 * 계약금·수수료 둘 다 미수금 0 이면 "수납종료" — 별도 저장 컬럼이 아니라
 * 로드된 entries 에서 매번 계산한다(BBE-240, 목업에서도 계산 표시로 남겨둠).
 * 계약금·수수료 둘 다 «최소 한 건은 있어야» 한다 — 아직 아무것도 안 들어온 딜을
 * "종료"로 잘못 표시하지 않기 위해서.
 */
export function isSettlementClosed(state: LedgerPopupState): boolean {
  if (state.kind !== "ready") return false;
  const hasDeposit = state.entries.some((entry) => entry.kind === "contract_deposit");
  const hasFee = state.entries.some((entry) => entry.kind === "fee");
  if (!hasDeposit || !hasFee) return false;
  return state.entries.every((entry) => entry.receivedAmount >= entry.amount);
}

export function DealLedgerButton({ dealId }: DealLedgerButtonProps) {
  const [open, setOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [state, setState] = useState<LedgerPopupState>({ kind: "loading" });
  const [, startTransition] = useTransition();

  function refresh(): void {
    setState({ kind: "loading" });
    startTransition(() => {
      void loadDealLedgerAction(dealId).then(setState);
    });
  }

  // 행을 열어보지 않아도 "수납종료" 뱃지가 바로 보이도록 마운트 시점에 미리 읽는다
  // (보드 한 화면 분량 — 수십 행 — 을 기준으로 한 딜당 한 번, N+1 이지만 가볍다).
  // ★ refresh() 를 그대로 부르지 않는다 — 그건 setState({kind:"loading"}) 를 이펙트
  //   본문에서 동기 호출하게 돼 react-hooks/set-state-in-effect 에 걸린다. 초기값이
  //   이미 loading 이라 재설정이 필요 없다 — 비동기 콜백에서만 setState 한다.
  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      void loadDealLedgerAction(dealId).then((next) => {
        if (!cancelled) setState(next);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [dealId]);

  function openPanel(): void {
    setOpen(true);
    refresh();
  }

  const depositAlreadyReceived =
    state.kind === "ready" && state.entries.some((entry) => entry.kind === "contract_deposit");
  const feeTerms = state.kind === "ready" ? state.feeTerms : null;
  const settlementClosed = isSettlementClosed(state);

  return (
    <>
      {settlementClosed && (
        <span className="mr-1.5 inline-flex items-center rounded-full bg-mw-tint-teal px-2 py-0.5 text-[0.7rem] font-semibold text-mw-flow-teal">
          ✅ 수납종료
        </span>
      )}
      <button
        type="button"
        onClick={openPanel}
        className="min-h-8 shrink-0 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record hover:bg-mw-tint-blue"
      >
        📒 원장
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deal-ledger-button-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-3"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-[min(40rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="deal-ledger-button-title" className="sr-only">업무 원장</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기" className="ml-auto text-mw-sub">✕</button>
            </div>

            <DealLedgerPanel dealId={dealId} state={state} />

            {state.kind === "ready" && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setEntryOpen(true)}
                  className="rounded-lg bg-mw-record px-3 py-1.5 text-sm font-semibold text-mw-on-accent"
                >
                  + 입력
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {entryOpen && (
        <LedgerEntryModal
          dealId={dealId}
          feeTerms={feeTerms}
          depositAlreadyReceived={depositAlreadyReceived}
          onClose={() => setEntryOpen(false)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

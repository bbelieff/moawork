"use client";

/**
 * 보드 행에서 여는 「📒 원장」 버튼 (BBE-240).
 *
 * 보드 행 팝업은 페이지 라우트 하나에 묶이지 않으므로, 저장 후 새로고침은
 * `loadDealLedgerAction` 재호출로 한다(`revalidatePath` 를 쓰지 않는다).
 */

import { useState, useTransition } from "react";
import { DealLedgerPanel } from "@/components/accounting/DealLedgerPanel";
import { loadDealLedgerAction, type LedgerPopupState } from "@/lib/accounting/actions";
import { LedgerEntryModal } from "./LedgerEntryModal";

export interface DealLedgerButtonProps {
  dealId: string;
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

  function openPanel(): void {
    setOpen(true);
    refresh();
  }

  const depositAlreadyReceived =
    state.kind === "ready" && state.entries.some((entry) => entry.kind === "contract_deposit");
  const feeTerms = state.kind === "ready" ? state.feeTerms : null;

  return (
    <>
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

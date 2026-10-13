"use client";

/**
 * 보드 행에서 여는 「📒 원장」 버튼 (BBE-240).
 *
 * 보드 행 팝업은 페이지 라우트 하나에 묶이지 않으므로, 저장 후 새로고침은
 * `loadDealLedgerAction` 재호출로 한다(`revalidatePath` 를 쓰지 않는다).
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { DealLedgerPanel } from "@/components/accounting/DealLedgerPanel";
import { deleteDealLedgerEntryAction, loadDealLedgerAction, type LedgerPopupState } from "@/lib/accounting/actions";
import type { DealLedgerEntry } from "@/lib/accounting/ledger";
import { LedgerEntryModal } from "./LedgerEntryModal";
import { BoardModalLayer } from "./BoardDialogPortal";

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
  const [editing, setEditing] = useState<DealLedgerEntry | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DealLedgerEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [, startTransition] = useTransition();
  const openerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const entryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && !entryOpen) closeRef.current?.focus();
  }, [entryOpen, open]);

  function closePanel(): void {
    setEntryOpen(false);
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  function closeEntry(): void {
    setEntryOpen(false);
    setEditing(null);
    requestAnimationFrame(() => entryRef.current?.focus());
  }

  function refresh(): void {
    setState({ kind: "loading" });
    startTransition(() => {
      void loadDealLedgerAction(dealId).then(setState);
    });
  }

  // 2026-10-07 — 이 버튼은 보드 행이 아니라 상세(열기) 머리말에 있다. 상세를 열 때마다 원장을 미리
  // 읽지 않고, 「📒 원장」 을 누를 때 읽는다(수납종료 뱃지도 그때부터 보인다). 상세를 여는 일이
  // 원장 조회를 부르지 않게 한다.
  function removeEntry(entry: DealLedgerEntry): void {
    setDeleteError(null);
    // 약속을 돌려줘야 «지우는 중» 동안 버튼이 잠긴다(두 번 눌러 두 번 보내지 않게).
    startDelete(async () => {
      const result = await deleteDealLedgerEntryAction({ entryId: entry.id, dealId });
      if (!result.ok) { setDeleteError(result.message); return; }
      setConfirmDelete(null);
      refresh();
    });
  }

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
        ref={openerRef}
        type="button"
        onClick={openPanel}
        className="min-h-8 shrink-0 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record hover:bg-mw-tint-blue"
      >
        📒 원장
      </button>

      {open && <BoardModalLayer labelledBy="deal-ledger-button-title" onClose={closePanel}>
          <div className="w-[min(40rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-[var(--mw-radius)] border border-mw-line bg-mw-card p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="deal-ledger-button-title" className="sr-only">업무 원장</h2>
              <button ref={closeRef} type="button" onClick={closePanel} aria-label="업무 원장 닫기" className="ml-auto rounded p-1 text-mw-sub hover:bg-mw-bg hover:text-mw-fg">✕</button>
            </div>

            <DealLedgerPanel
              dealId={dealId}
              state={state}
              onEdit={(entry) => { setConfirmDelete(null); setEditing(entry); setEntryOpen(true); }}
              onDelete={(entry) => { setDeleteError(null); setConfirmDelete(entry); }}
            />

            {confirmDelete && (
              <div role="alertdialog" aria-label="원장 항목 지우기 확인" className="mt-3 rounded-lg border border-mw-line bg-mw-bg p-3 text-xs text-mw-body">
                <p>
                  {confirmDelete.kind === "contract_deposit" ? "계약금" : "수수료"} {new Intl.NumberFormat("ko-KR").format(confirmDelete.amount)}원({confirmDelete.occurredOn}) 항목을 지울까요?
                  합계에서 빠지고, 딜 활동 기록에 지운 내용이 남아요.
                </p>
                {deleteError ? <p role="alert" className="mt-1 font-semibold text-mw-error">{deleteError}</p> : null}
                <div className="mt-2 flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg border border-mw-line px-3 py-1 font-semibold">그대로 두기</button>
                  <button type="button" disabled={deleting} onClick={() => removeEntry(confirmDelete)} className="rounded-lg bg-mw-error px-3 py-1 font-semibold text-mw-on-accent disabled:opacity-40">{deleting ? "지우는 중…" : "지우기"}</button>
                </div>
              </div>
            )}

            {state.kind === "ready" && (
              <div className="mt-4 flex justify-end">
                <button
                  ref={entryRef}
                  type="button"
                  onClick={() => setEntryOpen(true)}
                  className="rounded-lg bg-mw-record px-3 py-1.5 text-sm font-semibold text-mw-on-accent"
                >
                  + 입력
                </button>
              </div>
            )}
          </div>
      </BoardModalLayer>}

      {entryOpen && (
        <LedgerEntryModal
          dealId={dealId}
          feeTerms={feeTerms}
          depositAlreadyReceived={depositAlreadyReceived}
          editing={editing ?? undefined}
          onClose={closeEntry}
          onSaved={refresh}
        />
      )}
    </>
  );
}

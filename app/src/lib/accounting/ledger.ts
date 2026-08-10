export const LEDGER_KINDS = ["contract_deposit", "fee"] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface DealLedgerEntry {
  id: string;
  dealId: string;
  kind: LedgerKind;
  amount: number;
  receivedAmount: number;
  occurredOn: string;
  paidOn: string | null;
  attributionMonth: string;
}

export interface DealLedgerSummary {
  dealId: string;
  entryCount: number;
  ledgerTotal: number;
  feeTotal: number;
  receivedTotal: number;
  outstandingTotal: number;
}

function won(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

export function summarizeDealLedger(
  dealId: string,
  entries: readonly DealLedgerEntry[],
): DealLedgerSummary {
  const own = entries.filter((entry) => entry.dealId === dealId);
  let ledgerTotal = 0;
  let feeTotal = 0;
  let receivedTotal = 0;

  for (const entry of own) {
    const amount = won(entry.amount, "amount");
    const received = won(entry.receivedAmount, "receivedAmount");
    if (received > amount) throw new Error("receivedAmount cannot exceed amount");
    ledgerTotal += amount;
    receivedTotal += received;
    if (entry.kind === "fee") feeTotal += amount;
  }

  return {
    dealId,
    entryCount: own.length,
    ledgerTotal,
    feeTotal,
    receivedTotal,
    outstandingTotal: ledgerTotal - receivedTotal,
  };
}

export function assertFeeLedgerTotal(
  expectedFeeTotal: number,
  summary: DealLedgerSummary,
): void {
  if (won(expectedFeeTotal, "expectedFeeTotal") !== summary.feeTotal) {
    throw new Error("fee total must equal the fee ledger total");
  }
}

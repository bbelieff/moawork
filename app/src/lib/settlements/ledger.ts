export const LEDGER_ENTRY_KINDS = ["payment", "refund", "adjustment"] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export interface LedgerEntry {
  id: string;
  settlementId: string;
  kind: LedgerEntryKind;
  amount: number;
  occurredOn: string;
  source: "input" | "calculated";
  status: "posted" | "canceled";
  correctedFrom: string | null;
  createdAt: string;
  createdBy: string;
}

export interface LedgerTotals {
  expected: number;
  paid: number;
  outstanding: number;
  paymentCount: number;
  status: "unpaid" | "partial" | "paid" | "overpaid";
}

export function assertWon(value: unknown, label = "금액"): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`${label}은 1원 이상의 정수여야 해요.`);
  }
  return amount;
}

export function calculateTotals(
  expected: number,
  entries: readonly LedgerEntry[],
): LedgerTotals {
  const paid = entries.reduce((sum, entry) => {
    if (entry.status === "canceled") return sum;
    return sum + (entry.kind === "refund" ? -entry.amount : entry.amount);
  }, 0);
  const outstanding = expected - paid;
  const status = paid <= 0 ? "unpaid" : outstanding > 0 ? "partial" : outstanding === 0 ? "paid" : "overpaid";
  return {
    expected,
    paid,
    outstanding,
    paymentCount: entries.filter((entry) => entry.status === "posted" && entry.kind === "payment").length,
    status,
  };
}

export function correctionPair(
  original: LedgerEntry,
  replacement: Pick<LedgerEntry, "id" | "amount" | "occurredOn" | "createdAt" | "createdBy">,
): LedgerEntry[] {
  if (original.status !== "posted") throw new Error("취소된 내역은 정정할 수 없어요.");
  return [
    { ...original, status: "canceled" },
    {
      ...replacement,
      settlementId: original.settlementId,
      kind: original.kind,
      source: "input",
      status: "posted",
      correctedFrom: original.id,
    },
  ];
}

const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;

/** 고객명·연락처·메모·사용자 식별자는 의도적으로 내보내지 않는다. */
export function toMinimalCsv(rows: readonly { settlementId: string; expected: number; totals: LedgerTotals }[]): string {
  const header = ["정산ID", "예정금액", "입금합계", "미수금", "상태"];
  return [
    header.map(csvCell).join(","),
    ...rows.map((row) => [row.settlementId, row.expected, row.totals.paid, row.totals.outstanding, row.totals.status].map(csvCell).join(",")),
  ].join("\r\n");
}

import {
  assertFeeLedgerTotal,
  summarizeDealLedger,
  type DealLedgerEntry,
} from "@/lib/accounting";
import styles from "./accounting.module.css";

export type LedgerPanelState =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "error" }>
  | Readonly<{ kind: "ready"; entries: readonly DealLedgerEntry[]; expectedFeeTotal: number }>;

export interface DealLedgerPanelProps {
  dealId: string;
  state: LedgerPanelState;
}

const KIND_LABEL: Readonly<Record<DealLedgerEntry["kind"], string>> = {
  contract_deposit: "계약금",
  fee: "수수료",
};

function won(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function DateValue({ value }: { value: string | null }) {
  return <span>{value ?? "아직 입금되지 않았어요"}</span>;
}

export function DealLedgerPanel({ dealId, state }: DealLedgerPanelProps) {
  if (state.kind === "loading") {
    return <section aria-label="업무 원장" className={styles.notice}>원장을 불러오는 중이에요.</section>;
  }

  if (state.kind === "error") {
    return <section role="alert" aria-label="업무 원장" className={styles.notice}>원장을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</section>;
  }

  const entries = state.entries.filter((entry) => entry.dealId === dealId);
  const summary = summarizeDealLedger(dealId, entries);
  try {
    assertFeeLedgerTotal(state.expectedFeeTotal, summary);
  } catch {
    return <section role="alert" aria-label="업무 원장" className={styles.notice}>수수료 합계와 원장 합계가 맞지 않아 보여줄 수 없어요. 원장 데이터를 확인해 주세요.</section>;
  }

  if (entries.length === 0) {
    return <section aria-label="업무 원장" className={styles.notice}>아직 원장 항목이 없어요. 계약금이나 수수료가 기록되면 여기에 보여요.</section>;
  }

  return (
    <section className={styles.panel} aria-labelledby="deal-ledger-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>회계 원장</p>
          <h2 id="deal-ledger-title">업무 원장</h2>
          <p>계약금과 수수료는 이 원장에서만 합산해요.</p>
        </div>
        <span className={styles.count}>{summary.entryCount}건</span>
      </div>

      <dl className={styles.summary}>
        <div><dt>원장 합계</dt><dd>{won(summary.ledgerTotal)}</dd></div>
        <div><dt>수수료 원장 합계</dt><dd data-testid="fee-ledger-total">{won(summary.feeTotal)}</dd></div>
        <div><dt>수수료 합계</dt><dd data-testid="fee-total">{won(state.expectedFeeTotal)}</dd></div>
        <div><dt>미수금</dt><dd>{won(summary.outstandingTotal)}</dd></div>
      </dl>

      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>구분</th><th>발생일</th><th>금액</th><th>입금액</th><th>미수금</th><th>입금일</th></tr></thead>
          <tbody>{entries.map((entry) => (
            <tr key={entry.id}>
              <td>{KIND_LABEL[entry.kind]}</td>
              <td>{entry.occurredOn}</td>
              <td>{won(entry.amount)}</td>
              <td>{won(entry.receivedAmount)}</td>
              <td>{won(entry.amount - entry.receivedAmount)}</td>
              <td><DateValue value={entry.paidOn} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

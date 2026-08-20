"use client";

import { Fragment, useMemo, useState } from "react";
import { createLedgerReportCsvExport } from "@/lib/accounting/export";
import type { LedgerKind } from "@/lib/accounting/ledger";
import { entryOutstanding } from "@/lib/accounting/ledger";
import {
  buildLedgerReport,
  describeLedgerReportFilter,
  EMPTY_LEDGER_REPORT_FILTER,
  LEDGER_KIND_LABEL,
  LEDGER_REPORT_GROUPING_LABEL,
  LEDGER_REPORT_GROUPINGS,
  ledgerProductLabel,
  ledgerReportAssigneeOptions,
  ledgerReportCompanyOptions,
  UNASSIGNED_LABEL,
  type LedgerReportFilter,
  type LedgerReportGrouping,
  type LedgerReportRow,
} from "@/lib/accounting/report";
import { LedgerExportButton } from "./LedgerExportButton";
import styles from "./accounting.module.css";

export interface LedgerReportViewProps {
  rows: readonly LedgerReportRow[];
  /** 출력 도장 — 서버에서 정한다. 클라이언트에서 new Date() 하면 하이드레이션이 어긋난다. */
  printedOn: string;
  printedBy: string;
}

/** 표의 수는 단위 없이 — 시안 §② 의 `.num` 칸과 같다(합계 줄에서 자릿수가 맞아야 읽힌다). */
function num(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

const EM_DASH = "—";
const COLUMN_COUNT = 11;
/** 소계·합계 줄의 라벨이 차지하는 칸 수 — 금액 3칸 + 계산서 1칸을 남긴다. */
const LABEL_SPAN = COLUMN_COUNT - 4;

/**
 * 정산 리포트 (docs/design/정산-리포트-시안_v1.html §②).
 *
 * 총괄 결정으로 **이 화면이 정본**이고 출구는 둘뿐이다 —
 * 「🖨 인쇄 · PDF 저장」(브라우저 인쇄, 라이브러리 0) 과 「CSV」.
 * 엑셀(.xlsx)은 새 라이브러리가 필요해서 요구가 실제로 나올 때 붙인다.
 *
 * 필터는 넷뿐이다(기간·업체·담당자·수납구분). 시안이 그렸던 기관·상품 필터는
 * 이번 회차에서 총괄이 뺐다 — 그 둘은 보드 컬럼이라 회사가 지우면 비는 값이라서다.
 * 열로는 계속 보여주되(빈 칸 허용) 거르는 축으로는 쓰지 않는다.
 *
 * ⚠ 빈 칸을 「데이터 없음」 이라고 단정하지 않는다. RLS 비대칭·탭 삭제·미투영 등
 * «정상인데 안 보이는» 경로가 여럿이다(boardValues.ts 주석).
 */
export function LedgerReportView({ rows, printedOn, printedBy }: LedgerReportViewProps) {
  const [filter, setFilter] = useState<LedgerReportFilter>(EMPTY_LEDGER_REPORT_FILTER);
  const [grouping, setGrouping] = useState<LedgerReportGrouping>("company");

  const companies = useMemo(() => ledgerReportCompanyOptions(rows), [rows]);
  const assignees = useMemo(() => ledgerReportAssigneeOptions(rows), [rows]);
  const report = useMemo(() => buildLedgerReport(rows, filter, grouping), [rows, filter, grouping]);

  const patch = (next: Partial<LedgerReportFilter>) => setFilter((prev) => ({ ...prev, ...next }));

  const condition = describeLedgerReportFilter(filter, {
    assignee: assignees.find((option) => option.value === filter.assignee)?.label ?? null,
  });
  const visible = report.groups.flatMap((group) => group.rows);

  return (
    <section aria-labelledby="ledger-report-title" className={styles.report}>
      {/* 필터바 — 인쇄물에는 조작 도구가 남으면 안 된다(아래 rephead 의 «조건» 줄이 대신 남는다). */}
      <div className={styles.filters} data-print="hide">
        <label>
          기간 시작
          <input type="date" value={filter.from} onChange={(event) => patch({ from: event.target.value })} />
        </label>
        <label>
          기간 종료
          <input type="date" value={filter.to} onChange={(event) => patch({ to: event.target.value })} />
        </label>
        <label>
          업체
          <select value={filter.company} onChange={(event) => patch({ company: event.target.value })}>
            <option value="">전체</option>
            {companies.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          담당자
          <select value={filter.assignee} onChange={(event) => patch({ assignee: event.target.value })}>
            <option value="">전체</option>
            {assignees.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {/* ★ 「구분」 이 아니라 「수납구분」 — 보드의 구분(자금/지원금/인증/기타용역)과 다른 축이다. */}
        <label>
          수납구분
          <select
            value={filter.kind}
            onChange={(event) => patch({ kind: event.target.value as LedgerKind | "" })}
          >
            <option value="">전체</option>
            <option value="contract_deposit">계약금</option>
            <option value="fee">수수료</option>
          </select>
        </label>
        <label>
          묶기
          <select
            value={grouping}
            onChange={(event) => setGrouping(event.target.value as LedgerReportGrouping)}
          >
            {LEDGER_REPORT_GROUPINGS.map((key) => (
              <option key={key} value={key}>{LEDGER_REPORT_GROUPING_LABEL[key]}</option>
            ))}
          </select>
        </label>
        <span className={styles.exports}>
          <LedgerExportButton
            className={styles.ghostButton}
            build={() => createLedgerReportCsvExport(visible, { from: filter.from, to: filter.to })}
          />
          <button type="button" className={styles.printButton} onClick={() => window.print()}>
            🖨 인쇄 · PDF 저장
          </button>
        </span>
      </div>

      <div className={styles.reportHead}>
        <div>
          <h2 id="ledger-report-title">업무 원장 — {LEDGER_REPORT_GROUPING_LABEL[grouping]}</h2>
          <p className={styles.reportCondition}>{condition}</p>
        </div>
        <p className={styles.reportStamp}>
          모아워크<br />출력 {printedOn} · {printedBy}
        </p>
      </div>

      {report.total.rowCount === 0 ? (
        <p className={styles.notice}>고른 조건에 맞는 수납 항목이 없어요. 기간이나 업체를 바꿔 보세요.</p>
      ) : (
        <div className={styles.reportWrap}>
          <table className={styles.reportTable}>
            <thead>
              <tr>
                <th scope="col">업체</th>
                <th scope="col">담당자</th>
                <th scope="col">진행기관</th>
                <th scope="col">상품명칭(세부명칭)</th>
                <th scope="col">수납구분</th>
                <th scope="col">발생일</th>
                <th scope="col">입금일</th>
                <th scope="col" className={styles.num}>금액(공급가)</th>
                <th scope="col" className={styles.num}>입금액</th>
                <th scope="col" className={styles.num}>미수금</th>
                <th scope="col">계산서</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <Fragment key={group.key}>
                  <tr className={styles.groupRow}>
                    <td colSpan={COLUMN_COUNT}>{group.label}</td>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.companyName}</td>
                      <td>{row.assigneeName ?? UNASSIGNED_LABEL}</td>
                      <td>{row.institution ?? EM_DASH}</td>
                      <td>{ledgerProductLabel(row) ?? EM_DASH}</td>
                      <td>
                        <span className={row.kind === "fee" ? styles.tagFee : styles.tagDeposit}>
                          {LEDGER_KIND_LABEL[row.kind]}
                        </span>
                      </td>
                      <td>{row.occurredOn}</td>
                      <td>{row.paidOn ?? "미입금"}</td>
                      <td className={styles.num}>{num(row.amount)}</td>
                      <td className={styles.num}>{num(row.receivedAmount)}</td>
                      <td className={styles.num}>{num(entryOutstanding(row))}</td>
                      <td>{row.taxInvoiceIssued ? "발행✓" : EM_DASH}</td>
                    </tr>
                  ))}
                  <tr className={styles.subtotalRow}>
                    <td colSpan={LABEL_SPAN}>소계 — {group.label}</td>
                    <td className={styles.num}>{num(group.subtotal.amount)}</td>
                    <td className={styles.num}>{num(group.subtotal.received)}</td>
                    <td className={styles.num}>{num(group.subtotal.outstanding)}</td>
                    <td />
                  </tr>
                </Fragment>
              ))}
              <tr className={styles.totalRow}>
                <td colSpan={LABEL_SPAN}>{report.totalLabel}</td>
                <td className={styles.num}>{num(report.total.amount)}</td>
                <td className={styles.num}>{num(report.total.received)}</td>
                <td className={styles.num}>{num(report.total.outstanding)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

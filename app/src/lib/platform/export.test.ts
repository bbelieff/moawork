import { describe, it, expect } from "vitest";
import {
  BILLING_HEADERS,
  UTF8_BOM,
  billingCsv,
  billingExport,
  csvCell,
  toCsv,
} from "./export";
import type { BillingMonthRow } from "./types";

const rows: BillingMonthRow[] = [
  {
    month: "2026-07-01",
    invoiceCount: 2,
    supplySum: 1_000_000,
    vatSum: 100_000,
    totalSum: 1_100_000,
    paidSum: 600_000,
  },
];

describe("csvCell", () => {
  it("쉼표·따옴표·개행이 있으면 따옴표로 감싸고 이스케이프한다", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('그는 "말했다"')).toBe('"그는 ""말했다"""');
    expect(csvCell("줄\n바꿈")).toBe('"줄\n바꿈"');
  });

  it("평범한 값은 그대로 둔다", () => {
    expect(csvCell("가나다")).toBe("가나다");
    expect(csvCell(1234)).toBe("1234");
  });

  it("null·undefined 는 빈 칸이다", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("BOM 으로 시작한다 — 엑셀 한글 깨짐 방지", () => {
    const csv = toCsv(["가", "나"], [[1, 2]]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
  });

  it("CRLF 로 행을 구분한다", () => {
    expect(toCsv(["a"], [[1]])).toBe(`${UTF8_BOM}a\r\n1`);
  });

  it("행이 없어도 헤더는 남는다", () => {
    expect(toCsv(["a", "b"], [])).toBe(`${UTF8_BOM}a,b`);
  });
});

describe("billingCsv", () => {
  it("한국 SaaS 필수 열(공급가액·부가세 분리)을 포함한다", () => {
    expect(BILLING_HEADERS).toContain("공급가액");
    expect(BILLING_HEADERS).toContain("부가세");
    const csv = billingCsv(rows);
    expect(csv).toContain("공급가액");
    expect(csv).toContain("1000000");
  });

  it("미수금을 청구−수납으로 파생해 넣는다", () => {
    expect(billingCsv(rows)).toContain("500000"); // 1,100,000 − 600,000
  });
});

describe("billingExport — 3형식", () => {
  it("CSV 는 실제로 생성된다", () => {
    const d = billingExport(rows, "csv", "2026-07");
    expect(d.ready).toBe(true);
    expect(d.body).not.toBeNull();
    expect(d.filename).toBe("moawork-billing-2026-07.csv");
    expect(d.mimeType).toContain("charset=utf-8");
  });

  it("xlsx·PDF 는 아직 준비 중으로 명시하고 가짜 본문을 만들지 않는다", () => {
    for (const format of ["xlsx", "pdf"] as const) {
      const d = billingExport(rows, format, "2026-07");
      expect(d.ready).toBe(false);
      expect(d.body).toBeNull();
      expect(d.filename.endsWith(format)).toBe(true);
    }
  });
});

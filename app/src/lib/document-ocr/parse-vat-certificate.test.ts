import { describe, expect, it } from "vitest";
import { parseVatCertificateText } from "./parse-vat-certificate";

const HEADER = "사업자등록번호 123-45-67891";

describe("parseVatCertificateText", () => {
  it("명시된 여러 과세기간과 원 단위 매출액만 제안한다", () => {
    const result = parseVatCertificateText([
      HEADER,
      "과세기간 2025.01.01 ~ 2025.06.30 매출액 12,345,678원",
      "과세기간 2025년 7월 1일 ~ 2025년 12월 31일",
      "과세표준(매출액) 9,876,543 원",
      "합계 22,222,221원",
    ].join("\n"));
    expect(result.bizNo).toBe("123-45-67891");
    expect(result.bizNoValid).toBe(true);
    expect(result.periods).toEqual([
      expect.objectContaining({ periodStart: "2025-01-01", periodEnd: "2025-06-30", salesAmount: "12345678", valid: true }),
      expect.objectContaining({ periodStart: "2025-07-01", periodEnd: "2025-12-31", salesAmount: "9876543", valid: true }),
    ]);
    expect(result.periods).toHaveLength(2);
  });

  it("반기 표기를 정확한 기간으로 바꾸되 연간 합계는 만들지 않는다", () => {
    const result = parseVatCertificateText([
      HEADER,
      "2024년 제1기 매출액 0원",
      "2024년 제2기 매출액 2,000원",
      "연간 합계 2,000원",
    ].join("\n"));
    expect(result.periods.map((row) => [row.periodStart, row.periodEnd, row.salesAmount])).toEqual([
      ["2024-01-01", "2024-06-30", "0"],
      ["2024-07-01", "2024-12-31", "2000"],
    ]);
  });

  it("금액 라벨이 기간 앞에 있어도 날짜 연도를 금액으로 오인하지 않는다", () => {
    const result = parseVatCertificateText(
      `${HEADER}\n과세표준 2025.01.01 ~ 2025.06.30 12,345원`,
    );
    expect(result.periods).toEqual([
      expect.objectContaining({
        periodStart: "2025-01-01",
        periodEnd: "2025-06-30",
        salesAmount: "12345",
        valid: true,
      }),
    ]);
  });

  it("기간 앞 라벨만 있고 기간 뒤 금액이 없으면 누락으로 차단한다", () => {
    const result = parseVatCertificateText(
      `${HEADER}\n과세표준 2025.01.01 ~ 2025.06.30`,
    );
    expect(result.periods).toEqual([
      expect.objectContaining({ salesAmount: "", valid: false }),
    ]);
    expect(result.periods[0].warnings.join(" ")).toContain("매출액을 읽지 못했습니다");
  });

  it("동일 중복은 한 행으로 만들고 충돌 중복은 전부 차단한다", () => {
    const same = parseVatCertificateText([
      HEADER,
      "2025.01.01 ~ 2025.06.30 매출액 100원",
      "2025.01.01 ~ 2025.06.30 매출액 100원",
    ].join("\n"));
    expect(same.periods).toHaveLength(1);
    expect(same.documentWarnings.join(" ")).toContain("중복 행");

    const conflict = parseVatCertificateText([
      HEADER,
      "2025.01.01 ~ 2025.06.30 매출액 100원",
      "2025.01.01 ~ 2025.06.30 매출액 200원",
    ].join("\n"));
    expect(conflict.periods).toHaveLength(2);
    expect(conflict.periods.every((row) => row.valid === false)).toBe(true);
  });

  it("음수·금액 누락·잘못된 사업자번호를 fail-closed로 남긴다", () => {
    const result = parseVatCertificateText([
      "사업자등록번호 123-45-67890",
      "2025.01.01 ~ 2025.06.30 매출액 -100원",
      "2025.07.01 ~ 2025.12.31",
    ].join("\n"));
    expect(result.bizNoValid).toBe(false);
    expect(result.periods).toHaveLength(2);
    expect(result.periods.every((row) => row.valid === false)).toBe(true);
    expect(result.documentWarnings.join(" ")).toContain("체크섬");
  });

  it("빈 문서와 합계만 있는 문서에서 기간을 추론하지 않는다", () => {
    expect(parseVatCertificateText(" ").periods).toEqual([]);
    const result = parseVatCertificateText(`${HEADER}\n연간 합계 10,000원`);
    expect(result.periods).toEqual([]);
    expect(result.documentWarnings.join(" ")).toContain("추론하지 않습니다");
  });
});

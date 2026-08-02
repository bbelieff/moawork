// T07 · 결제·매출 Export (순수 함수).
//
// 3형식: CSV(UTF-8 BOM) · xlsx · PDF.
// P0 는 **CSV 를 실제로 생성**하고, xlsx/PDF 는 렌더러 의존성이 필요하므로
// 형식 기술(descriptor)만 만든다 — 화면은 준비 상태를 그대로 표시한다.
// 없는 기능을 있는 척 내려보내지 않기 위해 `ready` 플래그를 명시한다.

import type { BillingMonthRow } from "./types";

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * UTF-8 BOM. 엑셀(한국어 Windows)이 BOM 없는 UTF-8 CSV 를 CP949 로 읽어
 * 한글이 깨지므로 반드시 앞에 붙인다.
 */
export const UTF8_BOM = "﻿";

/** CSV 셀 이스케이프 — 쉼표·따옴표·개행이 있으면 따옴표로 감싼다. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 행 배열 → CSV 본문(BOM 포함). CRLF 는 엑셀 호환을 위한 것. */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return UTF8_BOM + lines.join("\r\n");
}

/** 결제·매출 월별 표의 열 정의 — 세 형식이 같은 열을 쓰도록 한곳에 둔다. */
export const BILLING_HEADERS = [
  "월",
  "청구건수",
  "공급가액",
  "부가세",
  "합계",
  "수납액",
  "미수금",
] as const;

export function billingRowsToMatrix(
  rows: readonly BillingMonthRow[],
): (readonly unknown[])[] {
  return rows.map((r) => [
    r.month,
    r.invoiceCount,
    r.supplySum,
    r.vatSum,
    r.totalSum,
    r.paidSum,
    Math.max(0, r.totalSum - r.paidSum),
  ]);
}

/** 결제·매출 CSV 문자열. */
export function billingCsv(rows: readonly BillingMonthRow[]): string {
  return toCsv(BILLING_HEADERS, billingRowsToMatrix(rows));
}

export interface ExportDescriptor {
  format: ExportFormat;
  filename: string;
  mimeType: string;
  /** 이 형식이 실제로 생성 가능한가. false 면 화면은 '준비 중'으로 표시한다. */
  ready: boolean;
  /** ready=true 일 때의 본문. 아니면 null. */
  body: string | null;
}

const MIME: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * 결제·매출 내보내기 기술.
 *
 * xlsx/PDF 는 각각 스프레드시트·PDF 렌더러가 필요하다. P0 에서 의존성을 들이지 않고
 * `ready:false` 로 명시한다 — 빈 파일을 xlsx 라고 내려보내면 열리지 않아 더 나쁘다.
 */
export function billingExport(
  rows: readonly BillingMonthRow[],
  format: ExportFormat,
  period: string,
): ExportDescriptor {
  const filename = `moawork-billing-${period}.${format}`;
  if (format === "csv") {
    return {
      format,
      filename,
      mimeType: MIME.csv,
      ready: true,
      body: billingCsv(rows),
    };
  }
  return { format, filename, mimeType: MIME[format], ready: false, body: null };
}

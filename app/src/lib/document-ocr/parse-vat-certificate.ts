/**
 * 부가가치세 과세표준증명원 OCR 텍스트를 기간별 매출액 제안으로 바꾼다.
 *
 * 이 모듈은 저장하지 않는다. 문서에 명시된 기간 행만 제안하며 합계·연간
 * 매출은 만들지 않는다. 중복 기간의 금액이 다르거나 금액/기간이 흐리면
 * valid:false로 남겨 사용자가 저장 대상으로 확정할 수 없게 한다.
 */

import { findBizNoCandidates, formatBizNo, isValidBizNo, normalizeBizNo } from "./bizno";
import { normalizeDate } from "./parse-certificate";

export type VatPeriodProposal = {
  periodStart: string;
  periodEnd: string;
  /** 쉼표 없는 원 단위 정수 문자열. 큰 금액을 Number로 반올림하지 않는다. */
  salesAmount: string;
  valid: boolean;
  warnings: string[];
  evidence: string;
};

export type VatCertificateParseResult = {
  bizNo: string;
  bizNoValid: boolean;
  periods: VatPeriodProposal[];
  documentWarnings: string[];
  sourceChars: number;
};

function normalize(raw: string): string {
  return (raw || "")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[‐‑‒–—―─ㅡ]/g, "-")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/ /g, " ");
}

const DATE_TOKEN = /\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일|\d{4}[.\-/]\s*\d{1,2}[.\-/]\s*\d{1,2}/g;
const AMOUNT_LABEL = /매\s*출\s*액|과\s*세\s*표\s*준|공\s*급\s*가\s*액/;
const TOTAL_LABEL = /합\s*계|누\s*계|연\s*간\s*합/;

function datesIn(line: string): Array<{ value: string; index: number; end: number }> {
  const matches = [...line.matchAll(DATE_TOKEN)];
  return matches.flatMap((match) => {
    const value = normalizeDate(match[0]);
    return value && match.index !== undefined
      ? [{ value, index: match.index, end: match.index + match[0].length }]
      : [];
  });
}

function halfYearPeriod(line: string): { start: string; end: string } | null {
  const match = line.match(/(19\d{2}|20\d{2})\s*년?\s*(?:제\s*)?([12])\s*기/);
  if (!match) return null;
  return match[2] === "1"
    ? { start: `${match[1]}-01-01`, end: `${match[1]}-06-30` }
    : { start: `${match[1]}-07-01`, end: `${match[1]}-12-31` };
}

function periodIn(line: string): { start: string; end: string; trailingIndex: number } | null {
  const dates = datesIn(line);
  if (dates.length >= 2) {
    return { start: dates[0].value, end: dates[1].value, trailingIndex: dates[1].end };
  }
  const half = halfYearPeriod(line);
  if (!half) return null;
  const matched = line.match(/(19\d{2}|20\d{2})\s*년?\s*(?:제\s*)?[12]\s*기/);
  return { start: half.start, end: half.end, trailingIndex: (matched?.index ?? 0) + (matched?.[0].length ?? 0) };
}

function amountIn(line: string, trailingIndex = 0): { value: string; valid: boolean; warning?: string } | null {
  // 기간을 찾은 행에서는 반드시 두 번째 날짜 뒤에서만 금액을 찾는다.
  // "과세표준 2025.01.01 ~ 2025.06.30 12,345원"처럼 라벨이 기간보다
  // 앞에 있어도 연도 2025를 금액으로 오인하지 않는다. 기간 뒤에 별도
  // 금액 라벨이 있으면 그 라벨 다음부터 더 좁혀 읽는다.
  const afterPeriod = line.slice(trailingIndex);
  const label = afterPeriod.match(AMOUNT_LABEL);
  const search = label
    ? afterPeriod.slice((label.index ?? 0) + label[0].length)
    : afterPeriod;
  const match = search.match(/(-?)\s*([0-9][0-9,]*)\s*(?:원)?/);
  if (!match) return null;
  if (match[1] === "-") {
    return { value: match[2].replace(/,/g, ""), valid: false, warning: "매출액이 음수라 저장할 수 없습니다." };
  }
  const value = match[2].replace(/,/g, "");
  if (!/^\d+$/.test(value)) return null;
  return { value: value.replace(/^0+(?=\d)/, ""), valid: true };
}

function findAmount(lines: string[], index: number, trailingIndex: number) {
  const same = amountIn(lines[index], trailingIndex);
  if (same) return same;
  for (let i = index + 1; i <= Math.min(index + 2, lines.length - 1); i += 1) {
    if (periodIn(lines[i]) || TOTAL_LABEL.test(lines[i])) break;
    if (!AMOUNT_LABEL.test(lines[i])) continue;
    const next = amountIn(lines[i]);
    if (next) return next;
  }
  return null;
}

export function parseVatCertificateText(rawText: string): VatCertificateParseResult {
  const text = normalize(rawText);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const documentWarnings: string[] = [];
  const bizCandidates = findBizNoCandidates(text);
  const rawBizNo = bizCandidates[0] ?? "";
  const bizNoValid = rawBizNo ? isValidBizNo(rawBizNo) : false;
  const bizNo = rawBizNo
    ? (bizNoValid ? formatBizNo(normalizeBizNo(rawBizNo)) : rawBizNo.slice(0, 20))
    : "";

  if (!text.trim()) {
    return {
      bizNo: "",
      bizNoValid: false,
      periods: [],
      documentWarnings: ["읽힌 글자가 없습니다. 더 선명한 원본으로 다시 시도하세요."],
      sourceChars: 0,
    };
  }
  if (bizCandidates.length === 0) documentWarnings.push("사업자등록번호를 찾지 못했습니다.");
  else if (bizCandidates.length > 1) documentWarnings.push("사업자등록번호 후보가 여러 개라 첫 후보를 표시합니다.");
  if (rawBizNo && !bizNoValid) documentWarnings.push("사업자등록번호 체크섬이 맞지 않습니다.");

  const proposals: VatPeriodProposal[] = [];
  lines.forEach((line, index) => {
    if (TOTAL_LABEL.test(line)) return;
    const period = periodIn(line);
    if (!period) return;
    const warnings: string[] = [];
    const amount = findAmount(lines, index, period.trailingIndex);
    if (period.start > period.end) warnings.push("과세기간의 시작일이 종료일보다 늦습니다.");
    if (!amount) warnings.push("이 과세기간의 매출액을 읽지 못했습니다.");
    if (amount?.warning) warnings.push(amount.warning);
    proposals.push({
      periodStart: period.start,
      periodEnd: period.end,
      salesAmount: amount?.value ?? "",
      valid: period.start <= period.end && amount?.valid === true,
      warnings,
      evidence: line.slice(0, 160),
    });
  });

  const byPeriod = new Map<string, VatPeriodProposal>();
  const periods: VatPeriodProposal[] = [];
  for (const proposal of proposals) {
    const key = `${proposal.periodStart}:${proposal.periodEnd}`;
    const prior = byPeriod.get(key);
    if (!prior) {
      byPeriod.set(key, proposal);
      periods.push(proposal);
      continue;
    }
    if (prior.salesAmount === proposal.salesAmount) {
      documentWarnings.push(`${proposal.periodStart}~${proposal.periodEnd} 중복 행 하나를 제외했습니다.`);
      continue;
    }
    prior.valid = false;
    prior.warnings.push("같은 과세기간에 서로 다른 매출액이 있어 저장할 수 없습니다.");
    proposal.valid = false;
    proposal.warnings.push("같은 과세기간에 서로 다른 매출액이 있어 저장할 수 없습니다.");
    periods.push(proposal);
  }

  if (periods.length === 0) {
    documentWarnings.push("명시된 과세기간·매출액 행을 찾지 못했습니다. 합계나 연간값은 추론하지 않습니다.");
  }
  return { bizNo, bizNoValid, periods, documentWarnings, sourceChars: text.length };
}

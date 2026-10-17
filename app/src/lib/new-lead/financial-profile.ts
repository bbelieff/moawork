import type { CellValue } from "@/lib/boards/types";
import { cellSearchText } from "@/lib/boards/cells";
import { formatQuantity } from "@/lib/format/number";

/** #589 이전의 단일 기대출 필드. 기존 값의 무손실 fallback에만 사용한다. */
export const EXISTING_LOAN_KEYS = {
  provider: "existing_loan_provider",
  month: "existing_loan_month",
  amount: "existing_loans",
  rate: "existing_loan_rate",
  terms: "existing_loan_terms",
  notes: "existing_loan_notes",
} as const;

/** 반복 가능한 기대출 목록을 한 셀에 원자적으로 보존하는 정본 키. */
export const EXISTING_LOAN_RECORDS_KEY = "existing_loan_records" as const;

export const CREDIT_SCORE_KEYS = {
  ncb: "credit_score_ncb",
  kcb: "credit_score_kcb",
} as const;

/**
 * Issue #600 leaf contract.
 *
 * These are durable EAV keys, not global number/date formatting rules. The
 * table/detail integration may present them as composite cells later without
 * rewriting the values already stored by #589.
 */
export const NEW_LEAD_COMPOSITE_FIELD_KEYS = {
  creditScores: "credit_scores",
  foundedDate: "founded_month",
  revenue3yMillion: "revenue_3y_million",
  legacyRevenueBand: "revenue_band",
} as const;

export type ExistingLoanProfile = Readonly<{
  provider: string;
  month: string;
  amount: number | null;
  rate: number | null;
  terms: string;
  notes: string;
}>;

export type ExistingLoanRecord = ExistingLoanProfile & Readonly<{ id: string }>;

const MAX_LOAN_RECORDS = 20;

function cellText(value: CellValue | undefined): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function cellNumber(value: CellValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function existingLoanProfileFromValues(
  values: Readonly<Record<string, CellValue | undefined>>,
): ExistingLoanProfile {
  return {
    provider: cellText(values[EXISTING_LOAN_KEYS.provider]),
    month: cellText(values[EXISTING_LOAN_KEYS.month]),
    amount: cellNumber(values[EXISTING_LOAN_KEYS.amount]),
    rate: cellNumber(values[EXISTING_LOAN_KEYS.rate]),
    terms: cellText(values[EXISTING_LOAN_KEYS.terms]),
    notes: cellText(values[EXISTING_LOAN_KEYS.notes]),
  };
}

export function parseOptionalNumber(
  raw: string,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): { ok: true; value: number | null } | { ok: false; message: string } {
  const normalized = raw.trim().replaceAll(",", "");
  if (!normalized) return { ok: true, value: null };
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    return { ok: false, message: `${label}을(를) 올바른 숫자로 입력해 주세요.` };
  }
  return { ok: true, value };
}

export function parseCreditScore(
  raw: string,
  label: "NCB" | "KCB",
): { ok: true; value: number | null } | { ok: false; message: string } {
  const parsed = parseOptionalNumber(raw, `${label} 신용점수`, 1000);
  if (!parsed.ok) return parsed;
  if (parsed.value !== null && (!Number.isInteger(parsed.value) || parsed.value < 1)) {
    return { ok: false, message: `${label} 신용점수는 1~1000 사이 정수로 입력해 주세요.` };
  }
  return parsed;
}

export type NewLeadCreditScores = Readonly<{
  ncb: number | null;
  kcb: number | null;
}>;

export function parseCreditScores(input: Readonly<{ ncb: string; kcb: string }>):
  | { ok: true; value: NewLeadCreditScores }
  | { ok: false; message: string } {
  const ncb = parseCreditScore(input.ncb, "NCB");
  if (!ncb.ok) return ncb;
  const kcb = parseCreditScore(input.kcb, "KCB");
  if (!kcb.ok) return kcb;
  return { ok: true, value: { ncb: ncb.value, kcb: kcb.value } };
}

export function creditScoresFromValues(
  values: Readonly<Record<string, CellValue | undefined>>,
): NewLeadCreditScores {
  const score = (key: string): number | null => {
    const value = values[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1000) return value;
    if (typeof value !== "string") return null;
    const parsed = parseCreditScore(value, key === CREDIT_SCORE_KEYS.ncb ? "NCB" : "KCB");
    return parsed.ok ? parsed.value : null;
  };
  return { ncb: score(CREDIT_SCORE_KEYS.ncb), kcb: score(CREDIT_SCORE_KEYS.kcb) };
}

/** 숫자 정본만 쉼표 표시하고, 비정형 legacy 원문은 손대지 않는다. */
export function formatCreditScoreValue(value: CellValue | undefined): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000) {
    return formatQuantity(value);
  }
  return typeof value === "string" ? value : "";
}

export type FoundedDatePrecision = "month" | "day";
export type ParsedFoundedDate = Readonly<{ value: string | null; precision: FoundedDatePrecision | null }>;

/**
 * 창업일 — 2026-10-17 belie: 달력으로 고르고, 리드가 연도·월까지만 주면 없는 값은 1로 채운다.
 * («2019» → 2019-01-01, «2019-05» → 2019-05-01). 점·빗금(2019.05)·붙여 쓰기(201905)도 받는다.
 * 이미 연월로 저장된 옛 값은 그대로 읽힌다(표시는 그 달 1일로).
 */
export function parseFoundedDate(raw: string):
  | { ok: true; value: ParsedFoundedDate }
  | { ok: false; message: string } {
  const value = toFoundedDateInput(raw);
  if (value === null) return { ok: false, message: "창업일은 연도, 연도-월, 연도-월-일 중 하나로 입력해 주세요." };
  if (!value) return { ok: true, value: { value: null, precision: null } };
  return { ok: true, value: { value, precision: "day" } };
}

/** 저장값·입력값 → 달력 칸 값(YYYY-MM-DD). 빈값은 "", 읽을 수 없으면 null. */
export function toFoundedDateInput(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  const compact = /^(\d{4})(\d{2})?(\d{2})?$/.exec(trimmed);
  const parts = compact
    ? [compact[1]!, compact[2], compact[3]]
    : /^(\d{4})(?:[-./](\d{1,2}))?(?:[-./](\d{1,2}))?\.?$/.exec(trimmed)?.slice(1, 4);
  if (!parts || !parts[0]) return null;
  const year = parts[0];
  const month = (parts[1] ?? "1").padStart(2, "0");
  const day = (parts[2] ?? "1").padStart(2, "0");
  const value = `${year}-${month}-${day}`;
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value;
}

/** 표 표시 — 연. 월. 일. (연월만 있던 옛 값은 그 달 1일). */
export function formatFoundedDate(raw: CellValue | undefined): string {
  if (typeof raw !== "string" || !raw.trim()) return "—";
  const value = toFoundedDateInput(raw);
  if (!value) return raw;
  const [year, month, day] = value.split("-");
  return year + ". " + month + ". " + day + ".";
}

export function parseRevenue3yMillion(raw: string):
  | { ok: true; value: number | null }
  | { ok: false; message: string } {
  const normalized = raw.trim().replaceAll(",", "");
  if (!normalized) return { ok: true, value: null };
  if (!/^\d+$/.test(normalized)) {
    return { ok: false, message: "3개년매출은 백만원 단위의 0 이상 정수로 입력해 주세요." };
  }
  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, message: "3개년매출이 저장 가능한 범위를 벗어났습니다." };
  }
  return { ok: true, value };
}

/** 저장값은 이미 백만원 단위다. 전역 포맷터는 표시 문자열에만 적용한다. */
export function formatRevenue3yMillion(value: CellValue | undefined): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return "";
  return formatQuantity(value, { suffix: "백만원" });
}

function sortableCreditScore(value: CellValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : null;
  }
  if (typeof value !== "string") return null;
  const parsed = parseCreditScore(value, "NCB");
  return parsed.ok ? parsed.value : null;
}

function sortableRevenue(value: CellValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const parsed = parseRevenue3yMillion(value);
  return parsed.ok ? parsed.value : null;
}

/**
 * 가상 finance 컬럼의 검색 projection. null은 공통 셀 검색기를 그대로 쓰라는 뜻이다.
 * raw와 표시 문자열을 함께 반환하므로 `1234`와 `1,234`가 같은 행을 찾는다.
 */
export function newLeadFinancialSearchText(
  columnKey: string,
  values: Readonly<Record<string, CellValue | undefined>>,
): string | null {
  if (columnKey === NEW_LEAD_COMPOSITE_FIELD_KEYS.creditScores) {
    const ncb = values[CREDIT_SCORE_KEYS.ncb] ?? null;
    const kcb = values[CREDIT_SCORE_KEYS.kcb] ?? null;
    return `NCB ${cellSearchText("number", ncb)} KCB ${cellSearchText("number", kcb)}`;
  }
  if (columnKey === NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion) {
    const revenue = values[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion] ?? null;
    const numeric = sortableRevenue(revenue);
    const current = numeric === null
      ? (typeof revenue === "string" ? revenue : "")
      : cellSearchText("number", numeric);
    const legacy = values[NEW_LEAD_COMPOSITE_FIELD_KEYS.legacyRevenueBand];
    return [current, typeof legacy === "string" ? legacy : ""].filter(Boolean).join(" ");
  }
  return null;
}

/**
 * 가상 finance 컬럼의 정렬 projection. 신용점수는 화면 읽기 순서인 NCB→KCB,
 * 매출은 새 숫자만 비교한다. 비정형/legacy-only 값은 null로 두어 안정적으로 뒤에 남긴다.
 */
export function compareNewLeadFinancialValues(
  columnKey: string,
  left: Readonly<Record<string, CellValue | undefined>>,
  right: Readonly<Record<string, CellValue | undefined>>,
  direction: "asc" | "desc" = "asc",
): number | null {
  const compareNullableNumbers = (a: number | null, b: number | null) => {
    if (a === null || b === null) {
      if (a === b) return 0;
      return a === null ? 1 : -1;
    }
    return direction === "desc" ? b - a : a - b;
  };
  if (columnKey === NEW_LEAD_COMPOSITE_FIELD_KEYS.creditScores) {
    const ncb = compareNullableNumbers(
      sortableCreditScore(left[CREDIT_SCORE_KEYS.ncb]),
      sortableCreditScore(right[CREDIT_SCORE_KEYS.ncb]),
    );
    return ncb !== 0
      ? ncb
      : compareNullableNumbers(
          sortableCreditScore(left[CREDIT_SCORE_KEYS.kcb]),
          sortableCreditScore(right[CREDIT_SCORE_KEYS.kcb]),
        );
  }
  if (columnKey === NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion) {
    return compareNullableNumbers(
      sortableRevenue(left[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion]),
      sortableRevenue(right[NEW_LEAD_COMPOSITE_FIELD_KEYS.revenue3yMillion]),
    );
  }
  return null;
}

export function parseLoanMonth(
  raw: string,
): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return { ok: false, message: "대출연월을 연도-월 형식으로 입력해 주세요." };
  }
  return { ok: true, value };
}

function boundedText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") return { ok: false as const, message: `${label} 형식을 확인해 주세요.` };
  const text = value.trim();
  if (text.length > maximum) return { ok: false as const, message: `${label}은(는) ${maximum}자 이내로 입력해 주세요.` };
  return { ok: true as const, value: text };
}

/** 브라우저가 보낸 반복 대출 목록을 서버에서도 다시 엄격히 검증한다. */
export function parseExistingLoanRecords(
  raw: string,
): { ok: true; value: ExistingLoanRecord[] } | { ok: false; message: string } {
  if (!raw.trim()) return { ok: true, value: [] };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, message: "기대출 목록 형식을 확인해 주세요." };
  }
  if (!Array.isArray(decoded) || decoded.length > MAX_LOAN_RECORDS) {
    return { ok: false, message: `기대출은 최대 ${MAX_LOAN_RECORDS}건까지 기록할 수 있어요.` };
  }
  const ids = new Set<string>();
  const records: ExistingLoanRecord[] = [];
  for (const [index, candidate] of decoded.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: `${index + 1}번째 기대출 형식을 확인해 주세요.` };
    }
    const row = candidate as Record<string, unknown>;
    const id = boundedText(row.id, "기대출 식별값", 100);
    const provider = boundedText(row.provider ?? "", "진행기관", 120);
    const terms = boundedText(row.terms ?? "", "조건", 500);
    const notes = boundedText(row.notes ?? "", "비고", 2000);
    if (!id.ok || !id.value || ids.has(id.value)) return { ok: false, message: "기대출 식별값이 없거나 중복됐어요." };
    if (!provider.ok) return provider;
    if (!terms.ok) return terms;
    if (!notes.ok) return notes;
    const month = parseLoanMonth(typeof row.month === "string" ? row.month : "");
    const amount = parseOptionalNumber(row.amount == null ? "" : String(row.amount), "대출 금액");
    const rate = parseOptionalNumber(row.rate == null ? "" : String(row.rate), "대출 금리", 100);
    if (!month.ok) return month;
    if (!amount.ok) return amount;
    if (!rate.ok) return rate;
    ids.add(id.value);
    records.push({ id: id.value, provider: provider.value, month: month.value ?? "", amount: amount.value, rate: rate.value, terms: terms.value, notes: notes.value });
  }
  return { ok: true, value: records };
}

export function existingLoanRecordsFromValues(
  values: Readonly<Record<string, CellValue | undefined>>,
): ExistingLoanRecord[] {
  const stored = values[EXISTING_LOAN_RECORDS_KEY];
  if (typeof stored === "string" && stored.trim()) {
    const parsed = parseExistingLoanRecords(stored);
    if (parsed.ok) return parsed.value;
  }
  const legacy = existingLoanProfileFromValues(values);
  if (!legacy.provider && !legacy.month && legacy.amount === null && legacy.rate === null && !legacy.terms && !legacy.notes) return [];
  return [{ id: "legacy", ...legacy }];
}

export function existingLoanSummary(profile: ExistingLoanProfile): string {
  const parts = [
    profile.provider,
    profile.month,
    profile.amount === null ? "" : `${profile.amount.toLocaleString("ko-KR")}원`,
    profile.rate === null ? "" : `${profile.rate}%`,
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

export function existingLoanRecordsSummary(records: readonly ExistingLoanRecord[]): string {
  if (records.length === 0) return "—";
  const first = existingLoanSummary(records[0]);
  return records.length === 1 ? first : `${records.length}건 · ${first} 외 ${records.length - 1}건`;
}

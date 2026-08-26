import type { CellValue } from "@/lib/boards/types";

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

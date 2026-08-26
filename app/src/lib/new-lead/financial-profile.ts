import type { CellValue } from "@/lib/boards/types";

export const EXISTING_LOAN_KEYS = {
  provider: "existing_loan_provider",
  month: "existing_loan_month",
  amount: "existing_loans",
  rate: "existing_loan_rate",
  terms: "existing_loan_terms",
  notes: "existing_loan_notes",
} as const;

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

export function existingLoanSummary(profile: ExistingLoanProfile): string {
  const parts = [
    profile.provider,
    profile.month,
    profile.amount === null ? "" : `${profile.amount.toLocaleString("ko-KR")}원`,
    profile.rate === null ? "" : `${profile.rate}%`,
  ].filter(Boolean);
  return parts.join(" · ") || "—";
}

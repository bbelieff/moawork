/**
 * D10 연락처 계약.
 *
 * 저장값은 숫자만 사용한다. 한국 국가번호(+82)는 국내 표기용 0으로
 * 바꾸고, 그 밖의 국제번호는 국가번호를 포함한 숫자열을 보존한다.
 */
export type PhoneNormalization =
  | { status: "empty"; normalized: "" }
  | { status: "normalized"; normalized: string }
  | { status: "needs_review"; normalized: "" };

export type PhoneNormalizationStatus = "normalized" | "needs_review";

function isReadablePhone(digits: string): boolean {
  if (digits.startsWith("0")) return digits.length >= 9 && digits.length <= 11;
  return digits.length >= 8 && digits.length <= 15;
}

export function analyzePhone(value: string | null | undefined): PhoneNormalization {
  if (!value?.trim()) return { status: "empty", normalized: "" };

  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, "");

  if (trimmed.startsWith("+") && digits.startsWith("82")) {
    digits = digits.slice(2).replace(/^0+/, "");
    digits = digits ? `0${digits}` : "";
  }

  if (!isReadablePhone(digits)) return { status: "needs_review", normalized: "" };
  return { status: "normalized", normalized: digits };
}

export function normalizePhone(value: string | null | undefined): string {
  return analyzePhone(value).normalized;
}

/** 화면 표시용 하이픈 포맷. 알 수 없는 길이는 숫자열을 그대로 보여준다. */
export function formatPhone(value: string | null | undefined): string {
  const result = analyzePhone(value);
  if (result.status === "needs_review") return "확인 필요";
  const phone = result.normalized;
  if (!phone) return "";

  if (phone.startsWith("02")) {
    if (phone.length === 9) return phone.replace(/^(02)(\d{3})(\d{4})$/, "$1-$2-$3");
    if (phone.length === 10) return phone.replace(/^(02)(\d{4})(\d{4})$/, "$1-$2-$3");
  }

  if (phone.startsWith("0")) {
    if (phone.length === 10) return phone.replace(/^(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");
    if (phone.length === 11) return phone.replace(/^(\d{3})(\d{4})(\d{4})$/, "$1-$2-$3");
  }

  return phone;
}

/**
 * 저장소의 정규화 상태를 함께 읽는 화면 표시 계약.
 *
 * migration은 판독 불가능한 EAV 값을 null로 바꾸고 원본과 상태를 별도로
 * 보존하므로, 화면 consumer는 값만 보고 빈 연락처로 오인하면 안 된다.
 */
export function presentPhone(
  value: string | null | undefined,
  normalizationStatus: PhoneNormalizationStatus = "normalized",
): string {
  if (normalizationStatus === "needs_review") return "확인 필요";
  return formatPhone(value);
}

/** 입력 형식이 달라도 저장 정규형이 같으면 같은 번호다. */
export function isSamePhone(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizePhone(left);
  return normalizedLeft !== "" && normalizedLeft === normalizePhone(right);
}

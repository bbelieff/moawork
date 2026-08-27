/**
 * 숫자 표시와 입력의 경계.
 *
 * 식별자(UUID, 사업자번호, 전화번호, request/version id), 날짜, sort_order 같은
 * 저장 문자열은 이 모듈의 입력이 아니다. 포맷터는 오직 `number`만 받으며 API/RPC/DB/CSV에는
 * 이 모듈의 표시 문자열을 저장하지 않는다.
 */

export type NumericDisplaySpec =
  | { kind: "quantity"; suffix?: string; allowNegative?: boolean }
  | {
      kind: "decimal";
      minimumFractionDigits?: number;
      maximumFractionDigits?: number;
    }
  | { kind: "ratio"; fractionDigits?: number }
  | { kind: "percentPoints"; fractionDigits?: number }
  | { kind: "krw"; rounding?: "reject-fraction" | "round"; unit?: "원" | "none" }
  | { kind: "millionKrw"; fractionDigits?: number }
  | { kind: "ordinal"; suffix?: string };

export interface NumericInputRules {
  allowNegative?: boolean;
  allowDecimal?: boolean;
  min?: number;
  max?: number;
}

export type NumericValidationError =
  | "not_finite"
  | "underflow"
  | "precision_loss"
  | "unsafe_integer"
  | "negative_not_allowed"
  | "decimal_not_allowed"
  | "below_min"
  | "above_max";

export type NumericValidationResult =
  | { ok: true; value: number }
  | { ok: false; value: null; error: NumericValidationError };

export type NumericParseResult =
  | { ok: true; value: number | null }
  | { ok: false; value: null; error: NumericValidationError | "invalid_syntax" };

const LOCALE = "ko-KR";
const MAX_FRACTION_DIGITS = 20;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function assertFinite(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("numeric display value must be a finite number");
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

function assertDigits(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_FRACTION_DIGITS) {
    throw new RangeError(`${field} must be an integer between 0 and ${MAX_FRACTION_DIGITS}`);
  }
}

/** Decimal source/canonical comparison only; never use this to rewrite stored identifiers. */
function normalizeExactDecimal(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerSource, fractionSource = ""] = unsigned.split(".");
  const integer = integerSource.replace(/^0+(?=\d)/, "") || "0";
  const fraction = fractionSource.replace(/0+$/, "");
  const isZero = integer === "0" && (fraction === "" || !/[1-9]/.test(fraction));
  if (isZero) return "0";
  return `${negative ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

function grouped(
  value: number,
  minimumFractionDigits = 0,
  maximumFractionDigits = MAX_FRACTION_DIGITS,
): string {
  assertFinite(value);
  assertDigits(minimumFractionDigits, "minimumFractionDigits");
  assertDigits(maximumFractionDigits, "maximumFractionDigits");
  if (minimumFractionDigits > maximumFractionDigits) {
    throw new RangeError("minimumFractionDigits must not exceed maximumFractionDigits");
  }
  return new Intl.NumberFormat(LOCALE, {
    useGrouping: true,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

/** 수량. 기본 계약은 0 이상의 정수이며 음수 허용은 호출부가 명시한다. */
export function formatQuantity(
  value: number,
  options: { suffix?: string; allowNegative?: boolean } = {},
): string {
  assertFinite(value);
  if (!Number.isInteger(value)) throw new RangeError("quantity must be an integer");
  assertSafeInteger(value, "quantity");
  if (value < 0 && !options.allowNegative) {
    throw new RangeError("quantity must not be negative");
  }
  return `${grouped(value, 0, 0)}${options.suffix ?? ""}`;
}

/** 일반 소수. 저장값을 바꾸지 않고 표시 정밀도만 제한한다. */
export function formatDecimal(
  value: number,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {},
): string {
  return grouped(
    value,
    options.minimumFractionDigits ?? 0,
    options.maximumFractionDigits ?? MAX_FRACTION_DIGITS,
  );
}

/** 0~1 비율을 퍼센트 표시로 바꾼다. */
export function formatRatio(value: number, options: { fractionDigits?: number } = {}): string {
  assertFinite(value);
  if (value < 0 || value > 1) throw new RangeError("ratio must be between 0 and 1");
  const digits = options.fractionDigits ?? 1;
  assertDigits(digits, "fractionDigits");
  return `${grouped(value * 100, digits, digits)}%`;
}

/** 이미 0~100 단위인 퍼센트 포인트. ratio와 절대 혼용하지 않는다. */
export function formatPercentPoints(
  value: number,
  options: { fractionDigits?: number } = {},
): string {
  assertFinite(value);
  if (value < 0 || value > 100) {
    throw new RangeError("percent points must be between 0 and 100");
  }
  const digits = options.fractionDigits ?? 0;
  assertDigits(digits, "fractionDigits");
  return `${grouped(value, digits, digits)}%`;
}

/** 원 단위 금액. 소수 처리와 단위 표시는 호출부가 명시할 수 있다. */
export function formatKrw(
  value: number,
  options: {
    rounding?: "reject-fraction" | "round";
    unit?: "원" | "none";
  } = {},
): string {
  assertFinite(value);
  const rounding = options.rounding ?? "reject-fraction";
  if (rounding === "reject-fraction" && !Number.isInteger(value)) {
    throw new RangeError("KRW value must be an integer unless rounding is explicit");
  }
  const normalized = rounding === "round" ? Math.round(value) : value;
  assertSafeInteger(normalized, "KRW value");
  return `${grouped(normalized, 0, 0)}${options.unit === "none" ? "" : "원"}`;
}

/** 원 단위 저장값을 백만원 단위로 표시한다. 저장 단위를 바꾸지 않는다. */
export function formatMillionKrw(
  valueKrw: number,
  options: { fractionDigits?: number } = {},
): string {
  assertFinite(valueKrw);
  const digits = options.fractionDigits ?? 1;
  assertDigits(digits, "fractionDigits");
  return `${grouped(valueKrw / 1_000_000, 0, digits)}백만원`;
}

/** 순위·차수처럼 1부터 시작하는 정수 표시. */
export function formatOrdinal(value: number, options: { suffix?: string } = {}): string {
  assertFinite(value);
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError("ordinal must be a positive integer");
  }
  assertSafeInteger(value, "ordinal");
  return `${grouped(value, 0, 0)}${options.suffix ?? "위"}`;
}

export function formatNumericDisplay(value: number, spec: NumericDisplaySpec): string {
  switch (spec.kind) {
    case "quantity":
      return formatQuantity(value, spec);
    case "decimal":
      return formatDecimal(value, spec);
    case "ratio":
      return formatRatio(value, spec);
    case "percentPoints":
      return formatPercentPoints(value, spec);
    case "krw":
      return formatKrw(value, spec);
    case "millionKrw":
      return formatMillionKrw(value, spec);
    case "ordinal":
      return formatOrdinal(value, spec);
  }
}

/** 입력 제약을 저장 전 숫자에 적용한다. 표시 포맷은 검증 결과를 바꾸지 않는다. */
export function validateNumericValue(
  value: number,
  rules: NumericInputRules = {},
): NumericValidationResult {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, value: null, error: "not_finite" };
  }
  if (rules.allowDecimal === false && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return { ok: false, value: null, error: "unsafe_integer" };
  }
  if (rules.allowNegative === false && value < 0) {
    return { ok: false, value: null, error: "negative_not_allowed" };
  }
  if (rules.allowDecimal === false && !Number.isInteger(value)) {
    return { ok: false, value: null, error: "decimal_not_allowed" };
  }
  if (rules.min !== undefined && value < rules.min) {
    return { ok: false, value: null, error: "below_min" };
  }
  if (rules.max !== undefined && value > rules.max) {
    return { ok: false, value: null, error: "above_max" };
  }
  return { ok: true, value };
}

/**
 * 편집 입력을 canonical number/null로 바꾼다. 올바른 3자리 쉼표는 허용하지만 원·%·날짜·ID
 * 같은 표시 토큰은 받지 않는다. 빈 입력은 삭제 의사인 null이다.
 */
export function parseNumericInput(
  raw: string,
  rules: NumericInputRules = {},
): NumericParseResult {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  const sign = "-?";
  const integer = "(?:0|[1-9]\\d*|[1-9]\\d{0,2}(?:,\\d{3})+)";
  const decimal = "(?:\\.\\d+)?";
  if (!new RegExp(`^${sign}${integer}${decimal}$`).test(text)) {
    return { ok: false, value: null, error: "invalid_syntax" };
  }

  const canonical = text.replaceAll(",", "");
  const hasDecimalPoint = canonical.includes(".");
  if (rules.allowDecimal === false && hasDecimalPoint) {
    return { ok: false, value: null, error: "decimal_not_allowed" };
  }
  if (rules.allowDecimal === false) {
    const integer = BigInt(canonical);
    if (integer > MAX_SAFE_INTEGER_BIGINT || integer < -MAX_SAFE_INTEGER_BIGINT) {
      return { ok: false, value: null, error: "unsafe_integer" };
    }
    const value = Number(canonical);
    if (!Number.isSafeInteger(value) || BigInt(value) !== integer) {
      return { ok: false, value: null, error: "unsafe_integer" };
    }
    return validateNumericValue(value, rules);
  }

  const value = Number(canonical);
  if (!Number.isFinite(value)) {
    return { ok: false, value: null, error: "not_finite" };
  }
  if (value === 0 && /[1-9]/.test(canonical)) {
    return { ok: false, value: null, error: "underflow" };
  }
  if (
    hasDecimalPoint
    && normalizeExactDecimal(canonical) !== normalizeExactDecimal(canonicalNumberString(value))
  ) {
    return { ok: false, value: null, error: "precision_loss" };
  }
  return validateNumericValue(value, rules);
}

/** 포커스 편집·API·CSV에 쓸 단위 없는 canonical 문자열. */
export function canonicalNumberString(value: number): string {
  assertFinite(value);
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(text);
  if (!match) return text;

  const [, sign, integer, fraction = "", exponentText] = match;
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + Number(exponentText);
  if (decimalIndex <= 0) {
    return `${sign}0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${sign}${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${sign}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

/** 검색에서 1234와 1,234가 같은 후보가 되도록 올바른 숫자 그룹만 정규화한다. */
export function normalizeNumericSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase(LOCALE)
    .replace(
      /(^|[^\d,])(-?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?)(?![\d,])/g,
      (_match, prefix: string, numeric: string) => `${prefix}${numeric.replaceAll(",", "")}`,
    );
}

export function numericSearchIncludes(candidate: string, query: string): boolean {
  return normalizeNumericSearchText(candidate).includes(normalizeNumericSearchText(query.trim()));
}

/**
 * 금액·숫자 입력 천단위 콤마 (2026-10-17 belie «모아워크에서 금액 숫자 적는 란은 다»).
 *
 * 저장 쪽 파서(field-types number/money, parseWonInput, parseOptionalNumber, parseRevenue…)는
 * 모두 콤마를 지우고 읽으므로 화면에서만 끊어 보여 준다.
 */

/** 숫자·소수점·앞 마이너스만 남기고 정수부를 3자리마다 끊는다. */
export function groupDigitsForInput(raw: string): string {
  const negative = raw.trimStart().startsWith("-");
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  const intPart = dot === -1 ? cleaned : cleaned.slice(0, dot);
  const fraction = dot === -1 ? "" : `.${cleaned.slice(dot + 1).replace(/\./g, "")}`;
  const grouped = intPart.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction}`;
}

/** 숫자만 친 경우에만 끊는다 — «1억 5천만» 처럼 단위를 섞어 치는 칸은 그대로 둔다. */
export function groupIfPlainNumber(raw: string): string {
  return /^\s*-?[\d,\s]*(\.\d*)?\s*$/.test(raw) ? groupDigitsForInput(raw) : raw;
}

/**
 * 비제어(uncontrolled) 입력용 onInput — 콤마를 다시 넣고 커서를 같은 숫자 뒤로 돌려놓는다.
 */
export function regroupInputInPlace(input: HTMLInputElement): void {
  const before = input.value;
  const next = groupIfPlainNumber(before);
  if (next === before) return;
  const caret = input.selectionStart ?? before.length;
  const digitsBefore = before.slice(0, caret).replace(/[^\d.-]/g, "").length;
  input.value = next;
  let seen = 0;
  let position = next.length;
  for (let index = 0; index < next.length; index += 1) {
    if (seen === digitsBefore) { position = index; break; }
    if (/[\d.-]/.test(next[index]!)) seen += 1;
  }
  input.setSelectionRange(position, position);
}

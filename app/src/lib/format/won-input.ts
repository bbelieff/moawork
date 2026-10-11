/**
 * 사람이 친 금액 → 원 단위 정수 (QA #885).
 *
 * 업무 상세의 금액 칸은 쉼표·공백만 지워서 «5,000,000원» 이나 «1억» 을 치면 저장이 오류 화면으로 끝났고
 * 음수도 저장됐다. 받는 꼴: 숫자(쉼표·공백 허용), 끝의 «원», 한국식 단위(억·천만·만·천).
 * 예: «5,000,000», «5000000원», «1억», «1억 5천만», «3,000만원». 읽을 수 없거나 음수면 null.
 */
const UNITS: ReadonlyArray<readonly [string, number]> = [
  ["억", 100_000_000],
  ["천만", 10_000_000],
  ["백만", 1_000_000],
  ["만", 10_000],
  ["천", 1_000],
];

export function parseWonInput(raw: string): number | null {
  const text = raw.replace(/[,\s]/g, "").replace(/원$/, "");
  if (text === "") return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : null;
  }
  let rest = text;
  let total = 0;
  for (const [unit, size] of UNITS) {
    const match = rest.match(new RegExp(`^(\\d+(?:\\.\\d+)?)${unit}`));
    if (!match) continue;
    total += Number(match[1]) * size;
    rest = rest.slice(match[0].length);
  }
  if (rest !== "") {
    if (!/^\d+$/.test(rest)) return null;
    total += Number(rest);
  }
  const rounded = Math.round(total);
  return Number.isSafeInteger(rounded) && rounded >= 0 && total > 0 ? rounded : null;
}

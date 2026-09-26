/**
 * document-ocr/bizno — 사업자등록번호(10자리) 형식·체크섬.
 *
 * 국세청 검증식: 앞 9자리 × [1,3,7,1,3,7,1,3,5] 합 + floor(9번째×5/10) 을
 * 10으로 나눈 나머지를 10에서 뺀 값의 1의 자리 == 10번째 자리.
 */

const WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const;

export function normalizeBizNo(raw: string): string {
  return (raw || "").replace(/\D/g, "");
}

export function formatBizNo(digits10: string): string {
  const d = normalizeBizNo(digits10);
  if (!/^\d{10}$/.test(d)) return (digits10 || "").trim();
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export function isValidBizNo(raw: string): boolean {
  const d = normalizeBizNo(raw);
  if (!/^\d{10}$/.test(d)) return false;
  // 000-00-00000 같은 자리 채움은 체크섬과 무관하게 거부한다.
  if (/^(\d)\1{9}$/.test(d)) return false;
  const digits = d.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += digits[i] * WEIGHTS[i];
  sum += Math.floor((digits[8] * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === digits[9];
}

/** 텍스트에서 사업자등록번호 후보를 순서대로 찾는다 (XXX-XX-XXXXX / 10연속). */
export function findBizNoCandidates(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const d = normalizeBizNo(raw);
    if (!/^\d{10}$/.test(d) || seen.has(d)) return;
    seen.add(d);
    out.push(raw.trim());
  };
  const dashed = text.match(/\d{3}\s*-\s*\d{2}\s*-\s*\d{5}/g) || [];
  dashed.forEach(push);
  const plain = text.match(/(?<!\d)\d{10}(?!\d)/g) || [];
  plain.forEach(push);
  return out;
}

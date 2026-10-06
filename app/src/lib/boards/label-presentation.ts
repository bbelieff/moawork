/**
 * 2026-10-06 — 보드 라벨의 «표시 전용» 정리 (#839 · 대표 지시 2026-10-06).
 *
 * 먼데이에서 옮겨 온 단계값·그룹명 일부는 맨 앞에 이모지가 붙어 있다
 * (예: `📂소진공 혁신성장 대기`, `⏹️ 준비단계`). 토큰 규약은 아이콘으로 이모지를 쓰지
 * 않으므로 화면에서만 앞머리 그림 문자를 걷어 낸다.
 *
 * ★ 데이터는 절대 바꾸지 않는다 — 선택지 id, item_values, move_rule 키, board_groups.name,
 *   먼데이 매핑 사전은 원문 그대로다. 이 함수는 «보여 주는 글자» 만 만든다.
 *   (id 를 바꾸면 저장값·이동규칙이 고아가 되고, 그룹명을 바꾸면 설치기가 정확한 이름으로
 *   기본 그룹을 다시 만든다.)
 * ★ 숫자·글자로 시작하는 라벨은 건드리지 않는다(`1차 부재`, `A등급`).
 * ★ 걷어 내고 남는 글자가 없으면 원문을 그대로 보여 준다.
 */

/**
 * 앞머리 그림 문자 한 덩어리 — 그림 문자(Extended_Pictographic)와 그 뒤의
 * 변이 선택자(VS16)·ZWJ·피부색 수식자·키캡 결합자를 한 묶음으로 본다.
 * 국기(지역 표시자 쌍)도 같은 자리에 오면 함께 걷는다.
 */
const LEADING_PICTOGRAPHS =
  /^(?:(?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\u{FE0F}|\u{FE0E}|\u{20E3}|\p{Emoji_Modifier}|\u{200D}(?:\p{Extended_Pictographic}|\p{Regional_Indicator}))*\s*)+/u;

/** 화면에 보일 라벨 — 앞머리 이모지만 걷고, 남는 것이 없으면 원문. */
export function presentLabel(raw: string): string {
  const cleaned = raw.replace(LEADING_PICTOGRAPHS, "").trim();
  return cleaned === "" ? raw : cleaned;
}

/**
 * 여러 라벨을 한 번에 — 이모지만 다르고 나머지가 같은 라벨끼리는 걷어 내면 구별이
 * 안 되므로, 그런 묶음은 원문을 그대로 보여 준다(같은 원문끼리의 중복은 그대로 중복이다).
 */
export function presentLabels(raws: readonly string[]): string[] {
  const rawsByClean = new Map<string, Set<string>>();
  for (const raw of raws) {
    const clean = presentLabel(raw);
    const bucket = rawsByClean.get(clean) ?? new Set<string>();
    bucket.add(raw);
    rawsByClean.set(clean, bucket);
  }
  return raws.map((raw) => {
    const clean = presentLabel(raw);
    return (rawsByClean.get(clean)?.size ?? 0) > 1 ? raw : clean;
  });
}

/** 검색은 원문과 표시 라벨을 «둘 다» 본다 — 이모지를 쳐도, 안 쳐도 찾힌다. */
export function labelSearchText(raw: string): string {
  const clean = presentLabel(raw);
  return clean === raw ? raw : `${raw} ${clean}`;
}

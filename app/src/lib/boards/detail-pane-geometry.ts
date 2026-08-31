/**
 * 상세 열기 화면의 «크기 계산» (#660).
 *
 * 가장자리를 끌어 전체 너비를, 가운데 선을 끌어 좌우 분할을 바꾼다.
 * 그 판정을 화면 밖에 둔다 — 컴포넌트 안에 있으면 검사할 자리가 없어진다(#638).
 *
 * ★ 기본값은 «건드리지 않는다».
 *   null 이면 CSS 기본(.surface 는 calc(100% - 6rem), .content 는 minmax(22rem,25rem))이 그대로 쓰인다.
 *   docs/design/visual-block-contract.json 이 그 기본 기하를 재고 있어서
 *   (왼쪽 여백 80~112px · 레일 352~430px), 기본을 바꾸면 시각 게이트가 빨개진다.
 *   사용자가 끌었을 때만 값이 생긴다.
 */

/** 대화상자가 이보다 좁아지면 두 칸을 나란히 둘 수 없다. */
export const DETAIL_MIN_WIDTH = 520;

/** 왼쪽 여백 기본값(6rem). 끌어서 0까지 줄이면 전체 화면이 된다. */
export const DETAIL_DEFAULT_INSET = 96;

/**
 * 왼쪽 여백(px) — 작을수록 대화상자가 넓다.
 * 0 아래로 못 가고, 대화상자가 최소 너비보다 좁아지게도 못 만든다.
 */
export function clampDetailInset(next: number, viewportWidth: number): number {
  if (!Number.isFinite(next)) return DETAIL_DEFAULT_INSET;
  const maxInset = Math.max(0, viewportWidth - DETAIL_MIN_WIDTH);
  return Math.min(Math.max(Math.round(next), 0), maxInset);
}

/** 왼쪽 정보 칸의 최소 너비. 이보다 좁으면 라벨과 값이 한 줄에 못 선다. */
export const RAIL_MIN_WIDTH = 260;

/** 정보 칸이 전체의 이 비율을 넘으면 오른쪽(히스토리)이 읽을 수 없게 좁아진다. */
export const RAIL_MAX_RATIO = 0.62;

export function railMaxWidth(contentWidth: number): number {
  return Math.max(RAIL_MIN_WIDTH, Math.round(contentWidth * RAIL_MAX_RATIO));
}

export function clampRailWidth(next: number, contentWidth: number): number {
  if (!Number.isFinite(next)) return RAIL_MIN_WIDTH;
  return Math.min(Math.max(Math.round(next), RAIL_MIN_WIDTH), railMaxWidth(contentWidth));
}

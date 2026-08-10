/**
 * 소식창 레이아웃 상수 — 375px 무깨짐 계약을 코드 한곳에 고정한다.
 *
 * 패널은 데스크톱에서 360px 이지만, 좁은 화면에서는 뷰포트를 넘지 않아야 한다.
 * min(360px, 100vw-24px) 이므로 375px 에서 351px 로 줄어 가로 스크롤이 생기지 않는다.
 * 세로는 max-h-[70vh] + 내부 overflow-y-auto 라 목록이 길어도 화면을 밀지 않는다.
 */
export const PANEL_WIDTH_CLASS = "w-[min(360px,calc(100vw-24px))]";
export const PANEL_HEIGHT_CLASS = "max-h-[70vh]";

/** 목록 영역: 내부에서만 스크롤한다(본문 가로 스크롤 금지). */
export const PANEL_SCROLL_CLASS = "min-h-0 flex-1 overflow-y-auto";

/** 긴 제목이 패널을 밀어내지 않도록 하는 조합. */
export const TEXT_CLAMP_CLASS = "min-w-0 flex-1";

/** 375px 기준 패널 실제 폭(px) — 테스트가 참조하는 계산값. */
export function panelWidthAt(viewportPx: number): number {
  return Math.min(360, viewportPx - 24);
}

/**
 * 보드 표의 공통 서식 정본.
 *
 * 그룹 색은 GroupBlock 머리말의 업무 단계 식별에만 쓰고, 실제 데이터를 읽고 편집하는
 * 표 셀은 어느 그룹·탭에서든 같은 높이와 중립 표면을 쓴다. 특수 셀도 이 값을 소비해야
 * 신규고객에서 맞춘 밀도가 2차 상담·부재·보류·거절과 다른 업무 보드에서 흐트러지지 않는다.
 *
 * 2026-10-06 (#839 · 대표 지시) — 칸 구분선은 격자선 토큰(--mw-grid-line, 글자색 10%)을 쓴다.
 * 행 제목만 13px/600 으로 한 단계 올려 «행 > 칸» 위계를 만든다(굵기는 400/600 두 단계만).
 */
export const BOARD_TABLE_CONTROL =
  "h-7 w-full rounded border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none hover:border-mw-record focus:border-mw-record";

/** 행 제목(이름) 입력 — 공통 컨트롤과 같은 틀에 글자만 13px/600. */
export const BOARD_TABLE_TITLE_CONTROL =
  "h-7 w-full rounded border border-mw-line bg-mw-card px-2 text-[length:var(--fs-13)] font-semibold text-mw-fg outline-none hover:border-mw-record focus:border-mw-record";

export const BOARD_TABLE_ROW = "h-8";

export const BOARD_TABLE_HEADER_CELL =
  "border-b border-r border-mw-grid-line px-2 py-1.5 text-xs font-semibold text-mw-sub";

export const BOARD_TABLE_BODY_CELL =
  "border-b border-r border-mw-grid-line bg-mw-card px-2 align-middle";

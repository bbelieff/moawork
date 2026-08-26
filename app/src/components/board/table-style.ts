/**
 * 보드 표의 공통 서식 정본.
 *
 * 그룹 색은 GroupBlock 머리말의 업무 단계 식별에만 쓰고, 실제 데이터를 읽고 편집하는
 * 표 셀은 어느 그룹·탭에서든 같은 높이와 중립 표면을 쓴다. 특수 셀도 이 값을 소비해야
 * 신규고객에서 맞춘 밀도가 2차 상담·부재·보류·거절과 다른 업무 보드에서 흐트러지지 않는다.
 */
export const BOARD_TABLE_CONTROL =
  "h-7 w-full rounded border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none hover:border-mw-record focus:border-mw-record";

export const BOARD_TABLE_ROW = "h-8";

export const BOARD_TABLE_HEADER_CELL =
  "border-b border-r border-mw-line px-2 py-1.5 text-xs font-semibold text-mw-sub";

export const BOARD_TABLE_BODY_CELL =
  "border-b border-r border-mw-line bg-mw-card px-2 align-middle";

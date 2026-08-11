/**
 * 사용자 임의 보드 엔진 도메인 타입 (T02b · ADR-0003).
 * `supabase/migrations/003_boards_engine.sql` 과 1:1 대응.
 *
 * 경계:
 *  - 정책자금 파이프라인(001 deals/stages/settlements)은 **여기서 다루지 않는다**.
 *    이 모듈은 사용자가 자유롭게 만드는 임의 보드(EAV) 전용.
 *  - 공용 계약(`@/lib/types`, `@/lib/repo/index.ts`)은 변경하지 않는다(T03 합의 필요).
 *    001 의 `FieldType`(13종)·`FieldOption` 만 읽기로 재사용한다.
 */

import type { FieldOption, FieldType } from "@/lib/types";
import type { FieldSource } from "@/lib/field/source";

/** 보드 뷰 종류 — 003 board_views.kind. */
export const BOARD_VIEW_KINDS = ["table", "kanban"] as const;
export type BoardViewKind = (typeof BOARD_VIEW_KINDS)[number];

export interface Board {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  /** 시스템 보드(정책자금 파이프라인 등)는 앱이 제공 — 사용자 삭제/컬럼편집 불가. */
  is_system: boolean;
  /** 시스템 보드의 출처 식별자(예: 'core.crm.pipeline'). */
  source: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardGroup {
  id: string;
  org_id: string;
  board_id: string;
  name: string;
  color: string | null;
  sort_order: number;
}

export interface BoardColumn {
  id: string;
  org_id: string;
  board_id: string;
  /** 보드 내 유일. item_values.column_key 가 이 값을 참조(EAV). */
  key: string;
  label: string;
  type: FieldType;
  /** 값이 어디서 오는가(D09) — 편집 가능 여부를 결정한다. 미지정 컬럼은 "in"(직접 입력)으로 본다. */
  source: FieldSource;
  /**
   * 이 컬럼이 "아이템을 옮기는" 우측 고정 열인가(D11). 보드당 보통 0~1개.
   * ⚠ 공지 보드의 데이터 컬럼 key `"pinned"`(상단고정 체크박스, T04)와는 무관 — 이름이 겹쳐
   * `rightPinned` 로 분명히 뗐다.
   */
  rightPinned: boolean;
  options_jsonb: { options: FieldOption[] } | null;
  sort_order: number;
  width: number | null;
}

/** 003 items — 임의 보드의 행. (001 deals 와 별개) */
export interface BoardItem {
  id: string;
  org_id: string;
  board_id: string;
  group_id: string | null;
  title: string;
  /** 담당범위(scope) 규칙의 기준 — deals 와 동일. */
  assigned_to: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** EAV 셀. PK = (item_id, column_key). */
export interface ItemValue {
  org_id: string;
  item_id: string;
  column_key: string;
  value_jsonb: CellValue;
}

/** 셀 값 — jsonb. 컬럼 타입별 정규화는 cells.ts 참조. */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | null;

export interface BoardView {
  id: string;
  org_id: string;
  board_id: string;
  user_id: string | null;
  name: string;
  kind: BoardViewKind;
  filters_jsonb: Record<string, unknown>;
  sort_jsonb: unknown[];
  visible_columns_jsonb: unknown[];
  shared: boolean;
}

/** 행 + 셀 맵(컬럼 key → 값). 화면 렌더용. */
export interface ItemWithValues extends BoardItem {
  values: Record<string, CellValue>;
}

/** 보드 + 컬럼/그룹 — 보드 화면 1회 로드 단위. */
export interface BoardDetail {
  board: Board;
  columns: BoardColumn[];
  groups: BoardGroup[];
}

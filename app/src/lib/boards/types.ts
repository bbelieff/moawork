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
import type { DetailLayoutEntry } from "./detail-layout";

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
  /** 상세 패널의 보드 기본 배치. 빈 배열은 의도적으로 비어 있는 기본 배치다. */
  detail_layout_jsonb?: DetailLayoutEntry[];
}

export interface BoardGroup {
  id: string;
  org_id: string;
  board_id: string;
  name: string;
  color: string | null;
  sort_order: number;
  /** null이면 보드 기본을 상속하고, 배열이면 이 그룹(제품의 아이템)만 오버라이드한다. */
  detail_layout_jsonb?: DetailLayoutEntry[] | null;
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
  /**
   * 아이템 자동 이동 규칙(D68~D70) — 「선택지 id → 이동할 그룹 id」 맵.
   * 이 칸의 값이 바뀌어 매핑된 선택지가 되면 아이템이 해당 그룹으로 옮겨간다
   * (먼데이의 "다음 단계로 넘기는 조작 열"·상태 변경 시 자동 이동과 동일 개념).
   * select/status 계열 컬럼에서만 의미가 있다. null/undefined = 이동 안 함(일반 컬럼).
   *
   * ⚠ 선택 필드다(필수 아님) — components/board/**·lib/policyfund/** 등 이 타입을
   * 리터럴로 구성하는 다른 트랙 소유 파일이 여럿이라, 필수로 만들면 그 파일들의
   * 빌드가 깨진다(불가침 경계). 값이 없는 컬럼은 "이동 규칙 없음"으로 취급한다.
   */
  move_rule_jsonb?: Record<string, string> | null;
  /**
   * 손으로 못 고치는 칸(목업 개정 ④) — ƒ수식 결과(예: ƒ재신청 안내일·ƒ심사 D-day)처럼
   * 다른 값에서 자동 계산되는 칸. true 면 setCells 가 이 키의 쓰기를 전부 거부한다
   * (값의 «형식»이 아니라 «편집 자체»를 막는다 — isIntegrityField 와는 다른 축).
   * 실제 계산은 이 모듈 소관이 아니다 — 계산 서비스가 자기 쓰기 경로로 채운다.
   * 선택 필드(다른 트랙 소유 파일의 리터럴 생성부를 깨지 않기 위해 — 위 move_rule_jsonb 와 동일 이유).
   */
  is_readonly?: boolean;
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
  /** Recoverable deletion marker. Active item reads always exclude non-null rows. */
  deleted_at?: string | null;
  /** User who moved the item to trash. Values/group/assignee/order remain untouched. */
  deleted_by?: string | null;
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

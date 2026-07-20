/**
 * core.crm 도메인 타입 (T02 영업코어).
 * DB 스키마 `supabase/migrations/0002_core_crm.sql` 와 1:1 대응.
 * 방식 B(하이브리드 정규화): 사용자 화면은 먼데이 컬럼/수식과 동일, 내부는 정규화.
 */

/** 컬럼 타입 — 먼데이 컬럼 종류 미러. */
export type ColumnType =
  | "text"
  | "number"
  | "date"
  | "status"
  | "people"
  | "formula";

/** 파이프라인 기본 단계 키(4단계). 보드별로 확장 가능. */
export type StageKey =
  | "consulting" // 상담중
  | "awaiting_contract" // 계약대기
  | "in_progress" // 진행중
  | "done"; // 완료

/** 내장 수식 컬럼 키. formula 컬럼의 settings.formulaKey 로 지정. */
export type FormulaKey =
  | "commission" // 수수료
  | "total_revenue" // 총매출
  | "d_plus_180" // D+180
  | "d_plus_365"; // D+365

export interface Board {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  position: number;
  archived: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  orgId: string;
  boardId: string;
  key: string;
  label: string;
  position: number;
  color: string | null;
  isTerminal: boolean;
  createdAt: string;
}

export interface BoardColumn {
  id: string;
  orgId: string;
  boardId: string;
  key: string;
  title: string;
  type: ColumnType;
  /** 타입별 메타: status 라벨, formula 의 formulaKey, number 의 단위 등. */
  settings: ColumnSettings;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnSettings {
  /** formula 컬럼: 어떤 내장 수식인지. */
  formulaKey?: FormulaKey;
  /** status 컬럼: 라벨 목록(옵션 커스터마이징은 T05 core.custom). */
  labels?: string[];
  [k: string]: unknown;
}

/** 셀 값 — jsonb. number/date/text/status/people 모두 수용. */
export type CellValue = string | number | boolean | null | Record<string, unknown>;

export interface ColumnValue {
  itemId: string;
  columnId: string;
  orgId: string;
  value: CellValue;
  updatedAt: string;
}

export interface Item {
  id: string;
  orgId: string;
  boardId: string;
  stageId: string | null;
  name: string;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** 아이템 + 컬럼값 맵(컬럼 key → 값) + 계산된 수식값. UI 렌더용. */
export interface ItemWithValues extends Item {
  /** 입력 컬럼 값 (컬럼 key 기준). */
  values: Record<string, CellValue>;
  /** 계산된 수식 컬럼 값 (컬럼 key 기준). */
  formulas: Record<string, CellValue>;
}

// ── 저장뷰(saved view) 설정 ────────────────────────────────

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty";

export interface ViewFilter {
  /** 대상 컬럼 key. 특수값 "__stage__" 는 파이프라인 단계. */
  columnKey: string;
  operator: FilterOperator;
  value?: CellValue;
}

export interface ViewSort {
  columnKey: string;
  direction: "asc" | "desc";
}

export interface ViewConfig {
  filters: ViewFilter[];
  sorts: ViewSort[];
  /** 표시할 컬럼 key 목록. 비면 전체. */
  visibleColumns?: string[];
}

export interface SavedView {
  id: string;
  orgId: string;
  boardId: string;
  name: string;
  config: ViewConfig;
  isDefault: boolean;
  createdBy: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** 요청 컨텍스트 — org 스코핑/감사에 사용. (Auth 연동은 T03) */
export interface RequestContext {
  orgId: string;
  userId: string | null;
}

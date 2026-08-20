// T09 · 정책자금 업종팩(ind.policyfund) 도메인 타입.
//
// SSOT: supabase/migrations/002_seed_policyfund.sql 의 industry_modules.presets_jsonb
// (첫 고객의 먼데이 전수추출 v1). 여기 타입은 그 JSONB 구조와 앱 도메인 표현.

// ── 원본 프리셋 JSONB 구조 (industry_modules.presets_jsonb) ────────────

/** 먼데이 컬럼 타입(원본 라벨 그대로). */
export type RawColumnType =
  | "title"
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "timeline"
  | "select"
  | "checkbox"
  | "file"
  | "person"
  | "email"
  | "phone"
  | "url"
  | "formula";

/** select 컬럼의 옵션: 인라인 문자열 배열 | 전역 프리셋 참조 | 비공개(고객데이터 제외). */
export type RawColumnOptions =
  | string[]
  | { ref: string } // field_presets 참조 (region, product)
  | { redacted: string }; // 실제 고객사명 제외

/** 보드 컬럼 1개(원본). */
export interface RawBoardColumn {
  label: string;
  type: RawColumnType;
  options?: RawColumnOptions;
  /** formula 컬럼의 원본 수식 문자열(먼데이 표기). */
  formula?: string;
}

/** 파이프라인 단계 정의(원본). */
export interface PipelineStageDef {
  name: string;
  kind: string;
}

/**
 * 보드별 컬럼 맵. 대부분 RawBoardColumn[] 이나,
 * "회계_연도차이" 는 연도(24년/25년/26년) → 컬럼[] 의 중첩 구조.
 */
export type BoardColumnsMap = Record<
  string,
  RawBoardColumn[] | Record<string, RawBoardColumn[]>
>;

/** industry_modules.presets_jsonb 전체 구조. */
export interface PolicyfundPresets {
  pipeline_stages: PipelineStageDef[];
  board_columns: BoardColumnsMap;
  /** 전역 선택지 프리셋(region, product, biz_type, biz_reg_type). */
  field_presets: Record<string, string[]>;
  message_templates?: { code: string; name: string }[];
  hometax_doc_checklist?: string[];
  formulas?: Record<string, string>;
}

// ── 앱 도메인 표현 (선택지·보드) ──────────────────────────────────────

/** 앱에서 다루는 선택지 카테고리 식별자. */
export type OptionCategoryId =
  | "region" // 지역 (field_presets.region)
  | "product" // 진행상품 (field_presets.product)
  | "agency" // 진행기관 (업무관리 "진행 기관")
  | "consult_status" // 상담상황 (신규고객 "상담 상황")
  | "contract_status" // 계약상황 (컨텍관리 "계약상황")
  | "progress_status" // 진행상항 (업무관리 "진행상항")
  | "fund_name"; // 자금명 (회계_연도차이 25년 "품목")

/** 단일 선택지 옵션. 먼데이는 라벨=값 이므로 id=label(안정). */
export interface PresetOption {
  id: string;
  label: string;
  order?: number;
}

/** 한 카테고리의 옵션 묶음. */
export interface OptionCategory {
  id: OptionCategoryId;
  label: string;
  options: PresetOption[];
}

/** 보드 컬럼(앱 표현) — 원본 컬럼 + 선택지 카테고리 참조 해석. */
export interface BoardColumn {
  /** 안정 키(라벨 slug 아님 — 원본 라벨 기준 인덱스). */
  index: number;
  label: string;
  type: RawColumnType;
  /** select 이며 전역 프리셋 참조 시 카테고리 id(region/product). */
  optionRef?: string;
  /** select 이며 인라인 옵션일 때. */
  inlineOptions?: string[];
  /** formula 컬럼의 원본 수식. */
  formula?: string;
  /** 고객데이터 비공개 컬럼 여부. */
  redacted?: boolean;
}

/** 보드 아이템(행) — 컬럼 라벨 → 셀 값. */
export interface BoardItem {
  id: string;
  cells: Record<string, BoardCellValue>;
}

export type BoardCellValue = string | number | boolean | null;

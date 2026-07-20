// T09 · 정책자금 업종팩(ind.policyfund) 도메인 타입.
//
// 실제 값(진행기관·상품·지역 목록, 보드 31개 컬럼 정의)은
// supabase/migrations/002_seed_policyfund.sql 및 기획 v0.2 가 SSOT 다.
// 이 파일은 그 데이터가 들어올 그릇(타입)만 정의한다 — 값은 지어내지 않는다.

/** 먼데이 선택지(드롭다운/상태) 옵션 카테고리 식별자. */
export type OptionCategoryId =
  | "region" // 지역
  | "product" // 진행상품
  | "agency" // 진행기관
  | "consult_status" // 상담상황
  | "contract_status" // 계약상황
  | "progress_status" // 진행상항(진행상황)
  | "fund_name"; // 자금명

/** 단일 선택지 옵션. `id` 는 안정적 키(먼데이 라벨/시드 키와 매핑). */
export interface PresetOption {
  /** 안정적 식별자(시드가 부여). 표시용이 아님. */
  id: string;
  /** 화면 표시 라벨(한국어). */
  label: string;
  /** 먼데이 상태 컬럼의 색상(있으면). 없으면 undefined. */
  color?: string;
  /** 정렬 순서(작을수록 먼저). 시드 순서 보존용. */
  order?: number;
}

/** 한 카테고리의 옵션 묶음 + 메타. */
export interface OptionCategory {
  id: OptionCategoryId;
  /** 카테고리 표시명(사용자/먼데이 명칭 그대로). */
  label: string;
  options: PresetOption[];
}

/** 정책자금 진행기관(취급기관) 마스터 레코드. */
export interface Agency {
  id: string;
  name: string;
}

/** 정책자금 진행상품(상품 카탈로그) 레코드. */
export interface Product {
  id: string;
  name: string;
  /** 취급 진행기관 id(있으면). */
  agencyId?: string;
}

// ── 보드(먼데이 "업무" 보드) 컬럼 모델 ────────────────────────────────
// 31개 컬럼을 "그대로 재현" 하려면 컬럼 정의가 필요하다.
// 컬럼 정의(라벨/순서/타입)의 SSOT 는 002_seed / 기획 v0.2 다.
// 여기서는 컬럼을 표현하는 타입만 둔다 — 31개 실목록은 시드에서 주입.

/** 먼데이 컬럼 종류(재현 대상). */
export type BoardColumnKind =
  | "text" // 텍스트
  | "long_text" // 긴 텍스트
  | "number" // 숫자
  | "date" // 날짜
  | "status" // 상태(단일 선택 · 색상)
  | "dropdown" // 드롭다운(선택지)
  | "person" // 담당자
  | "formula"; // 수식(계산 컬럼)

/** 보드 컬럼 1개 정의. */
export interface BoardColumn {
  id: string;
  title: string;
  kind: BoardColumnKind;
  /** status/dropdown 컬럼이 참조하는 옵션 카테고리(있으면). */
  optionCategory?: OptionCategoryId;
  /** 화면 표시 순서. */
  order: number;
}

/** 보드 아이템(행) — 값은 컬럼 id → 셀 값 맵으로 보관(먼데이 방식). */
export interface BoardItem {
  id: string;
  /** 컬럼 id → 셀 값. 파이프라인 단계 판정 등에 사용. */
  cells: Record<string, BoardCellValue>;
}

/** 셀 값(느슨한 유니온 — 컬럼 kind 에 따라 해석). */
export type BoardCellValue = string | number | null;

/**
 * 서류 체크리스트 도메인 타입 (BBE-110).
 *
 * 경계: 이 모듈은 001 deals 의 `custom`(JSONB 자유 필드)이나 T05 커스텀필드 엔진(13종
 * FieldType)에 얹지 않는다. 체크리스트는 "항목 추가/삭제 + 상품별 기본값 프리셋"이 필요한데
 * 13종 어디에도 맞지 않고(select/multiselect 는 옵션이 고정 카탈로그라 딜마다 자유 추가가 안 됨),
 * 커스텀필드 엔진(2중 구현 금지 규약)을 억지로 확장하느니 독립 저장소로 분리했다.
 *
 * "진행 상품"(product) 카테고리는 `@/lib/policyfund/presets`(59종, PresetOption.id=label)를
 * 그대로 참조키로 쓴다 — 별도 상품 목록을 만들지 않는다.
 */

/** 딜 하나의 체크리스트 항목. checked 는 딜 단위 상태(프리셋에는 없음). */
export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  order: number;
}

/** 프리셋 항목 — 딜 상태(checked)가 없는 템플릿 형태. */
export interface ChecklistPresetItem {
  id: string;
  label: string;
  order: number;
}

/**
 * 상품별 기본 체크리스트 프리셋. "회사 공용"(org 단위) 라이브러리 — BBE-110 수용 기준 3.
 * 키는 product 옵션 id(=라벨, PresetOption 관례). 상품마다 최대 1개.
 */
export interface ProductChecklistPreset {
  productId: string;
  items: ChecklistPresetItem[];
  updatedAt: string;
}

/**
 * 딜 하나의 체크리스트 상태. 프리셋 적용 이후에도 자유롭게 추가/삭제되므로
 * 프리셋과 독립적으로 저장한다(프리셋이 바뀌어도 이미 진행 중인 딜은 영향받지 않는다).
 */
export interface DealChecklistState {
  dealId: string;
  /** 마지막으로 적용/선택한 상품. 프리셋 재적용 UI 판단에 쓴다. */
  productId: string | null;
  items: ChecklistItem[];
}

/** 완료율 — 표의 셀과 상세 패널이 **반드시 같은 함수**(engine.completionOf)로 계산한 값만 쓴다. */
export interface ChecklistCompletion {
  checked: number;
  total: number;
  /** 0~100 정수. total=0 이면 0(분모 0 방지, "아직 없음"과 "다 함"을 혼동하지 않도록 total 도 함께 노출). */
  percent: number;
}

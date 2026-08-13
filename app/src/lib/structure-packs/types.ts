/**
 * 구조 팩(structure pack) 도메인 타입 — PLAN-002/WO-1.
 *
 * SSOT: `supabase/migrations/040_preset_depersonalize.sql`(031 의 행을 update)의
 * `structure_packs.pack_jsonb`. 이 파일은 그 JSONB 의 앱 표현이며,
 * 두 정의가 어긋나지 않는지는 `policyfund-pack.test.ts` 가 고정한다.
 *
 * 용어(PLAN-002 §1 · 사용자 확정 2026-08-04): **아이템 = 탭 안의 그룹**이다.
 * 먼데이 API 의 item(행)과 다르므로 코드에서는 `sectionPreset` 으로 부른다.
 * 팩은 보드 통짜가 아니라 그룹 단위 `sectionPreset` 으로 분해되어 있고,
 * 이것이 WO-6 공용 프리셋 라이브러리의 초기 데이터가 된다.
 */

import type { FieldOption, FieldType } from "@/lib/types";

/**
 * 003 boards 엔진이 아직 표현하지 못하는 먼데이 컬럼 종류.
 *
 * `field_type` enum(001, 13종)에 대응 값이 없다. 구조는 팩에 기록하되
 * 설치 시에는 만들지 않는다 — 실동작은 PLAN-003 범위다(PLAN-002 §5 WO-1).
 * 지원되지 않는 타입을 `text` 같은 것으로 바꿔 만들면 실제로는 없는 컬럼이
 * 있는 것처럼 보이므로, 만들지 않고 목록으로만 남긴다.
 */
export const DEFERRED_COLUMN_KINDS = [
  "formula",
  "timeline",
  "subtasks",
  "creation_log",
] as const;
export type DeferredColumnKind = (typeof DEFERRED_COLUMN_KINDS)[number];

/** 설치되는 컬럼 1개. */
export interface PackColumn {
  /** `board_columns.key` — 보드 안에서 유일. 먼데이 컬럼 id 를 그대로 쓴다(실측 추적성). */
  key: string;
  label: string;
  type: FieldType;
  /** select/multiselect 의 선택지. 라벨 hex 색을 그대로 옮긴다. */
  options?: FieldOption[];
  /** 전역 선택지 프리셋 참조(002 `field_presets`). 인라인 옵션 대신 쓴다. */
  optionRef?: string;
  width?: number | null;
}

/**
 * 보드의 Name(제목) 칸 — 시드 확정 ① (PLAN-002 §5 WO-1).
 *
 * 003 엔진에서 Name 은 `board_columns` 행이 아니라 `items.title` 이다.
 * 별도 컬럼으로 만들면 실제로는 없는 컬럼이 생기므로 계약으로만 남긴다.
 * 먼데이 원본은 Name 칸에 업종 텍스트(`자사_직접제조`)를 넣는 관행이 있었으나
 * 승계하지 않는다 — Name 은 업체명이고 업종은 `사업자 유형` 컬럼이 받는다.
 */
export interface PackNameColumn {
  /** 화면에 뜨는 이름. 3보드 공통으로 `업체명`. */
  label: string;
  /** 먼데이 원본 Name 칸 표기(`Name`·`이름`) — 대조 추적성. */
  mondayLabel: string;
}

/** 구조만 기록하고 설치하지 않는 컬럼. */
export interface DeferredColumn {
  key: string;
  label: string;
  kind: DeferredColumnKind;
  /** 먼데이 원본 수식 등 후속 구현에 필요한 원문. */
  source?: string;
}

/**
 * 아이템 프리셋 = 탭 안의 그룹 1개.
 *
 * `탭-그룹` 형식으로 명명한다(PLAN-002 §5 WO-6). 예: `신규업체-1차 부재`.
 */
export interface SectionPreset {
  /** 라이브러리 식별자. `탭-그룹` 형식. */
  name: string;
  /**
   * 화면에 뜨는 그룹 이름(이모지 포함 — 먼데이 원문 그대로).
   *
   * `assigneeSlot` 이 있는 항목은 여기 실명이 아니라 **이모지 접두사만** 담는다
   * (예: `"♻️"`). 실제 그룹 이름은 설치 시 `${groupName}${멤버 표시명}` 으로 만든다.
   */
  groupName: string;
  /** 그룹 헤더 밴드 색(hex). ui-guidelines 원칙 10 이 이 값을 쓴다. */
  color: string;
  /** 보드 안에서의 순서(0부터). 먼데이 position 오름차순을 그대로 옮긴다. */
  order: number;
  /**
   * 담당자별 그룹 슬롯 — 결정대장 D73 (2026-08-10 belie 교정 · BBE-130).
   *
   * 먼데이 원본은 "담당자별로 카드를 나눠 담는다"는 구조를 특정 직원 실명으로 심어 뒀다.
   * 구조(담당자별 분류) 자체는 실제 업무 방식이라 남기지만,
   * 실명은 전역 카탈로그에 박아 둘 수 없다(다른 회사가 설치하면 그 회사에 없는 사람 이름의
   * 그룹이 생긴다). 그래서 이름 대신 **0부터 시작하는 슬롯 번호**만 남긴다.
   *
   * 설치 시 조직 멤버를 가입순으로 정렬해 `members[assigneeSlot]` 이 있으면 그 멤버 이름으로
   * 그룹을 만들고, 없으면 그 슬롯은 만들지 않는다 — 새 조직(멤버 1명)은 슬롯 0만 채워져
   * 아이템 1개, 초대할 때마다 다음 슬롯이 채워진다. 슬롯 수(=이 값을 가진 항목 수)는
   * 원본의 담당자 수(2명)를 그대로 유지해 "아이템 종류 수" 를 불변으로 지킨다.
   */
  assigneeSlot?: number;
}

/** 보드 1개의 구조. */
export interface PackBoard {
  /** 팩 안에서의 식별자. */
  slug: string;
  name: string;
  icon: string;
  description: string;
  /** 먼데이 원본 보드 id — 실측 추적성 확보용(앱 동작에는 쓰지 않는다). */
  mondayBoardId: string;
  /** Name(제목) 칸의 의미. 시드 확정 ① — 업체명. */
  nameColumn: PackNameColumn;
  /** 설치할 컬럼. 배열 순서가 곧 `sort_order` 다. */
  columns: PackColumn[];
  /** 구조만 기록하는 컬럼(PLAN-003). */
  deferredColumns: DeferredColumn[];
  /** 이 보드의 아이템 프리셋(= 그룹) 목록. */
  sections: SectionPreset[];
  /** 저장 뷰. */
  views: PackView[];
}

export interface PackView {
  name: string;
  kind: "table" | "kanban";
  /** `board_views.filters_jsonb` — 컬럼 key → 허용 라벨 목록. */
  filters?: Record<string, string[]>;
  shared: boolean;
}

/** 팩 전체. */
export interface StructurePack {
  key: string;
  /** 이전 배포가 보드 source에 기록한 팩 키. 설치 시 canonical key로 승격한다. */
  legacyKeys?: readonly string[];
  name: string;
  /** 실측 출처·시점을 팩 안에 남긴다(나중에 어디서 온 값인지 추적 가능하게). */
  source: string;
  /**
   * 보드가 공유하는 선택지 세트. `PackColumn.optionRef` 가 여기를 가리킨다.
   *
   * 시드 확정 ②(지역 공용 1세트)가 이 자리를 쓴다. 팩이 자기 선택지를 들고 있어야
   * 설치 때 실제로 심긴다 — 참조만 남기면 옵션 없는 컬럼이 만들어진다.
   */
  optionSets: Record<string, FieldOption[]>;
  boards: PackBoard[];
}

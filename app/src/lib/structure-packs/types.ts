/**
 * 구조 팩(structure pack) 도메인 타입 — PLAN-002/WO-1.
 *
 * SSOT: `supabase/migrations/031_newcust_structure_pack.sql` 의
 * `structure_packs.pack_jsonb`. 이 파일은 그 JSONB 의 앱 표현이며,
 * 두 정의가 어긋나지 않는지는 `seoul-pack.test.ts` 가 고정한다.
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
  /** 화면에 뜨는 그룹 이름(이모지 포함 — 먼데이 원문 그대로). */
  groupName: string;
  /** 그룹 헤더 밴드 색(hex). ui-guidelines 원칙 10 이 이 값을 쓴다. */
  color: string;
  /** 보드 안에서의 순서(0부터). 먼데이 position 오름차순을 그대로 옮긴다. */
  order: number;
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
  name: string;
  /** 실측 출처·시점을 팩 안에 남긴다(나중에 어디서 온 값인지 추적 가능하게). */
  source: string;
  boards: PackBoard[];
}

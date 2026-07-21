import type { Deal, Stage, StageKind } from "@/lib/types";

/**
 * 단계 보드 정의 (T02 · B2) — 먼데이 보드를 화면 레이어로 재현한다.
 *
 * 데이터 모델은 001 정본 불변(deals/stages). "보드"는 별도 테이블이 아니라
 * **stage_kind 로 거른 뷰**다(ADR-0002: 범용 EAV 보드는 Phase 3, MVP 스코프 밖).
 *
 * 단계 이름/kind 는 002_seed_policyfund 의 pipeline_stages 를 따른다:
 *   신규고객(marketing) · 컨텍관리(meeting) · 계약(contract) ·
 *   업무관리(work) · 수납·정산(settle) · 사후관리(post)
 */
export interface StageBoardDef {
  /** URL 세그먼트 (/(app)/<slug>) */
  slug: string;
  /** 화면에 보이는 보드 이름 — 002 시드의 단계명과 일치시킨다. */
  title: string;
  /** 이 보드가 대응하는 001 stage_kind. */
  kind: StageKind;
  description: string;
}

/**
 * B2 선구현 대상 3개 보드.
 *
 * ⚠️ 명명 주의: `/contract` 는 배정 지시서에 적힌 경로를 그대로 따랐지만, 이 보드가 담는 단계는
 * 시드상 **컨텍관리(kind=meeting)** 다. 001 의 `contract` kind 는 그 다음 단계인 **계약**으로
 * 별개다. 지시서의 보드 이름("컨텍관리")을 정본으로 보고 kind=meeting 에 묶었다.
 * 만약 의도가 "계약 보드"였다면 아래 kind 만 "contract" 로 바꾸면 된다(한 줄).
 */
export const STAGE_BOARDS: readonly StageBoardDef[] = [
  {
    slug: "newcust",
    title: "신규고객",
    kind: "marketing",
    description: "유입된 신규 고객사를 접수하고 담당을 배정한다.",
  },
  {
    slug: "contract",
    title: "컨텍관리",
    kind: "meeting",
    description: "상담·미팅 진행 중인 건을 관리한다.",
  },
  {
    slug: "work",
    title: "업무관리",
    kind: "work",
    description: "계약 후 실제 업무가 진행 중인 건을 관리한다.",
  },
] as const;

export function getStageBoard(slug: string): StageBoardDef | undefined {
  return STAGE_BOARDS.find((b) => b.slug === slug);
}

/** 해당 보드(kind)에 속하는 단계들. 시드가 kind 당 1개라도 복수를 허용한다. */
export function stagesForBoard(
  stages: readonly Stage[],
  kind: StageKind,
): Stage[] {
  return stages
    .filter((s) => s.kind === kind)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * 보드에 표시할 딜만 추린다.
 * stage_id 가 비어 있는 딜(단계 미배정)은 어느 보드에도 뜨지 않는다 — 임의 귀속을 만들지 않는다.
 */
export function dealsForBoard(
  deals: readonly Deal[],
  boardStages: readonly Stage[],
): Deal[] {
  if (boardStages.length === 0) return [];
  const ids = new Set(boardStages.map((s) => s.id));
  return deals.filter((d) => d.stage_id !== null && ids.has(d.stage_id));
}

/** 단계별로 묶는다(칸반 컬럼). 단계 순서는 sort_order 를 따른다. */
export function groupByStage(
  deals: readonly Deal[],
  boardStages: readonly Stage[],
): Array<{ stage: Stage; deals: Deal[] }> {
  return boardStages.map((stage) => ({
    stage,
    deals: deals.filter((d) => d.stage_id === stage.id),
  }));
}

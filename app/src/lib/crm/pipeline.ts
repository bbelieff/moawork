/**
 * 파이프라인 단계 이동 + 자동화 (T02).
 *
 * 단계(4): 상담중(consulting) → 계약대기(awaiting_contract) → 진행중(in_progress) → 완료(done)
 *
 * 이동 정책(MVP): 먼데이처럼 자유 이동 허용(any → any). 단, 아래 자동화가 트리거된다.
 * 자동화(부수효과):
 *   - 진행중(in_progress) 진입: 계약일(contract_date)이 비어 있으면 이동일로 채운다.
 *     → D+180 / D+365 수식의 기준일이 생긴다.
 *   - 완료(done) 진입: completed_at 스탬프 + 완료일(completed_date) 컬럼값 세팅.
 *   - 완료(done) 이탈: completed_at 해제(다시 진행 상태로 되돌릴 때).
 */

import type { CellValue, StageKey } from "./types";
import { INPUT_KEYS } from "./formulas";

/** 완료 시 스탬프되는 컬럼 key. */
export const COMPLETED_DATE_KEY = "completed_date";

export interface StageTemplate {
  key: StageKey;
  label: string;
  position: number;
  color: string;
  isTerminal: boolean;
}

/** 보드 생성 시 기본 제공되는 4단계. */
export const DEFAULT_STAGES: StageTemplate[] = [
  { key: "consulting", label: "상담중", position: 0, color: "#fdab3d", isTerminal: false },
  { key: "awaiting_contract", label: "계약대기", position: 1, color: "#579bfc", isTerminal: false },
  { key: "in_progress", label: "진행중", position: 2, color: "#a25ddc", isTerminal: false },
  { key: "done", label: "완료", position: 3, color: "#00c875", isTerminal: true },
];

const STAGE_KEYS = new Set<string>(DEFAULT_STAGES.map((s) => s.key));

/** 알려진 기본 단계 키인지. */
export function isKnownStageKey(key: string): key is StageKey {
  return STAGE_KEYS.has(key);
}

/**
 * 단계 이동 결과 — 아이템에 적용할 패치.
 * store 어댑터가 이 패치를 items / column_values 에 반영한다.
 */
export interface StageMoveEffect {
  /** items.completed_at 설정값. undefined = 변경 없음, null = 해제. */
  completedAt?: string | null;
  /** 세팅할 컬럼값 (컬럼 key → 값). 빈 객체면 없음. */
  columnPatches: Record<string, CellValue>;
}

/**
 * 목표 단계로 이동할 때 발생하는 자동화 부수효과를 순수 계산.
 *
 * @param toStageKey   목표 단계 key
 * @param fromIsTerminal 현재 단계가 종료 단계였는지 (이탈 감지)
 * @param currentValues 아이템의 현재 입력 컬럼값 맵
 * @param today        기준 오늘 날짜(YYYY-MM-DD) — 호출측 주입(테스트 결정성)
 */
export function computeStageMoveEffect(
  toStageKey: string,
  fromIsTerminal: boolean,
  currentValues: Record<string, CellValue>,
  today: string,
): StageMoveEffect {
  const effect: StageMoveEffect = { columnPatches: {} };

  if (toStageKey === "in_progress") {
    const hasContractDate =
      currentValues[INPUT_KEYS.contractDate] !== undefined &&
      currentValues[INPUT_KEYS.contractDate] !== null &&
      currentValues[INPUT_KEYS.contractDate] !== "";
    if (!hasContractDate) {
      effect.columnPatches[INPUT_KEYS.contractDate] = today;
    }
  }

  if (toStageKey === "done") {
    effect.completedAt = `${today}T00:00:00.000Z`;
    effect.columnPatches[COMPLETED_DATE_KEY] = today;
  } else if (fromIsTerminal) {
    // 종료 단계에서 비종료 단계로 되돌림 → 완료 해제
    effect.completedAt = null;
  }

  return effect;
}

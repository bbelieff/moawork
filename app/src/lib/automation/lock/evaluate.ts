// BBE-105 · 이중 잠금 게이트 실행기 (순수 로직).
//
// D36: 조건이 하나라도 미충족이면 이관을 막고 사유를 남긴다. "조용한 실패"는 이 카드가
// 막으려는 사고 그 자체다 — 항상 LockGateResult 를 반환하고, 호출부가 이걸로 다이얼로그를
// 그린다. D66: enabled=false 면 조건과 무관하게 통과시키되, 그게 "정상 통과"가 아니라
// "우회 통과"였다는 사실(bypassed)을 결과에 남긴다 — 차단·통과 모두 히스토리에 남아야
// 한다는 BBE-105 수용 기준이 여기서 갈린다.

import type { LockCondition, LockGateInput, LockGateResult } from "./types";

/** 미충족 조건만 골라낸다(순서 보존). */
function unmetConditionsOf(
  conditions: readonly LockCondition[],
): LockCondition[] {
  return conditions.filter((condition) => !condition.satisfied);
}

/**
 * 이중 잠금 게이트 판정.
 *
 * - enabled=false: 항상 통과. 미충족 조건이 있었다면 bypassed=true 로 표시(감사용).
 * - enabled=true: 조건 전부(AND) 충족일 때만 통과. 하나라도 미충족이면 그 조건들을
 *   unmet 에 담아 반환한다 — "무엇이 빠졌는지"를 다이얼로그가 그대로 렌더링할 수 있게.
 */
export function evaluateLockGate(input: LockGateInput): LockGateResult {
  const unmet = unmetConditionsOf(input.conditions);

  if (!input.enabled) {
    return { passed: true, bypassed: unmet.length > 0, unmet: [] };
  }

  return { passed: unmet.length === 0, bypassed: false, unmet };
}

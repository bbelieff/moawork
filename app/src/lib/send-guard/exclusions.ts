/**
 * 못 보내는 건을 사유별로 셈한다 (BBE-148).
 *
 * ## 왜 `plan.ts` 가 아니라 따로 있나
 *
 * `plan.ts` 는 지문을 만들려고 `node:crypto` 를 부른다. 그래서 **클라이언트 번들에 들어갈 수 없다.**
 * 확인 화면(`SendConfirmDialog`)은 소비하는 쪽이 `"use client"` 안에서 그릴 수도 있는데,
 * 그때 배럴(`index.ts`)을 거쳐 `plan.ts` 가 딸려 들어오면 빌드가 깨진다.
 *
 * 화면이 필요로 하는 이 계산에는 crypto 가 필요 없다. 그래서 순수한 자리로 떼어 둔다.
 * **화면은 이 파일과 `template.ts` 만 값으로 가져다 쓴다** (나머지는 타입만 가져간다).
 */

import type { SendPlan } from "./types";

export function exclusionCounts(plan: SendPlan): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of plan.excluded) {
    counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count }));
}

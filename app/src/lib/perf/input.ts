// T07 · mod.perf API 입력 검증.
//
// 라우트가 받은 값은 전부 외부 입력이다 — 형식을 여기서 한 번 좁히고 나면
// 아래 계층(집계·저장)은 `YYYY-MM` 이라는 가정을 안전하게 쓸 수 있다.

import { ValidationError } from "@/lib/crm/validation";
import type { LeaderboardSort } from "./types";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * `YYYY-MM` 월 문자열 검증.
 *
 * 정규식으로 월(01~12)까지 좁힌다 — `2026-13` 을 통과시키면 monthRangeKst 가
 * 다음 해 1월 구간을 만들어 **조용히 엉뚱한 달**을 재계산한다.
 *
 * @param value 검증할 값. null/undefined 면 undefined 반환(호출부가 기본값 결정).
 */
export function parsePeriod(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !PERIOD_RE.test(value)) {
    throw new ValidationError("period 는 YYYY-MM 형식이어야 합니다");
  }
  return value;
}

const SORTS: readonly LeaderboardSort[] = ["fee", "exec", "deals"];

/** 리더보드 정렬 기준 검증. 미지정이면 undefined(서비스 기본값 사용). */
export function parseSort(value: unknown): LeaderboardSort | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !SORTS.includes(value as LeaderboardSort)) {
    throw new ValidationError(`sort 는 ${SORTS.join(" | ")} 중 하나여야 합니다`);
  }
  return value as LeaderboardSort;
}

/** 재계산 요청 본문. */
export interface RebuildInput {
  period?: string;
}

/** POST /api/perf/snapshots/rebuild 본문 검증. 본문 없음도 허용(현재월 재계산). */
export function parseRebuild(body: unknown): RebuildInput {
  if (body === undefined || body === null) return {};
  if (typeof body !== "object") {
    throw new ValidationError("요청 본문은 객체여야 합니다");
  }
  return { period: parsePeriod((body as { period?: unknown }).period) };
}

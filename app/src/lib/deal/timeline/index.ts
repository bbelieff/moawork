/**
 * 딜 통합 타임라인 (BBE-16) — activities(자동 기록) + comments(사람이 씀)를
 * 하나의 시간순 피드로 합친다. "무엇이 언제 바뀌었는가는 자동으로 쌓인다" 요건은
 * `activities`(단계 이동·담당자 변경을 서비스가 자동 기록)가 이미 보장하고,
 * 이 모듈은 그것과 댓글을 **화면 표시용으로 병합**만 한다 — 저장 형식은 바꾸지 않는다.
 */

import type { Activity } from "@/lib/types";
import type { DealComment } from "@/lib/deal/comments";

export type TimelineEntry =
  | { kind: "activity"; at: string; activity: Activity }
  | { kind: "comment"; at: string; comment: DealComment };

/** activities + comments → 시간순(오래된 → 최신) 병합. */
export function mergeTimeline(
  activities: readonly Activity[],
  comments: readonly DealComment[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...activities.map((a): TimelineEntry => ({ kind: "activity", at: a.at, activity: a })),
    ...comments.map((c): TimelineEntry => ({ kind: "comment", at: c.created_at, comment: c })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 단계 이동 활동로그 헬퍼 (T02 core.crm).
 * 먼데이 "이동" 자동화 재현: 딜 단계가 바뀌면 activities 에 status 기록을 남긴다.
 * (수식/정산은 T09, 커스텀필드/뷰는 T05 소유 — 여기서 다루지 않음)
 */

/** 활동 type 상수. */
export const ACTIVITY_TYPES = {
  status: "status", // 단계 이동
  call: "call",
  meeting: "meeting",
  memo: "memo",
} as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES];

/** 단계 이동 로그 문구. from 이 없으면(최초 배치) 목적 단계만 표기. */
export function stageMoveContent(
  fromStageName: string | null,
  toStageName: string,
): string {
  return fromStageName ? `${fromStageName} → ${toStageName}` : `→ ${toStageName}`;
}

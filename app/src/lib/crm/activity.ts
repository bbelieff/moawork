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
  assignment: "assignment", // 담당자 변경 (BBE-16)
} as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES];

/** 단계 이동 로그 문구. from 이 없으면(최초 배치) 목적 단계만 표기. */
export function stageMoveContent(
  fromStageName: string | null,
  toStageName: string,
): string {
  return fromStageName ? `${fromStageName} → ${toStageName}` : `→ ${toStageName}`;
}

/**
 * 담당자 변경 로그 문구 (BBE-16).
 * 이름을 알 수 없으면(조회 실패 등) "미지정"으로 수렴 — 개인정보(이메일 등)는 넣지 않는다.
 */
export function assignmentChangeContent(
  fromName: string | null,
  toName: string | null,
): string {
  const from = fromName ?? "미배정";
  const to = toName ?? "미배정";
  return `담당자: ${from} → ${to}`;
}

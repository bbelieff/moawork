// BBE-105 · 리드컨택 → 업무관리 이관 게이트 (D36 의 구체 사례).
//
// 목업 실측(`docs/design/UI목업_워크스페이스_최종_v6.html` showBlock/approveSeal):
// 트리거는 `업무이동 = 업무관리 이동` 시도이고, 그 순간 확인하는 가드 조건은
// `직인 완료 = 완료` 단 1개다. 자동화 규칙(데이터)로는 "조건 2개 AND"로 표현되지만
// (트리거 컬럼 자체의 값 일치 + 가드 컬럼), 트리거 조건은 이관을 시도하는 순간 이미
// 참이므로 사용자에게 보여줄 미충족 사유는 실질적으로 가드 조건 1개뿐이다 — 목업의
// 차단 문구도 "대표 직인 승인이 필요합니다"만 보여준다(직인+업무이동 둘 다 나열하지 않음).
//
// BBE-104(A-1) 가 조건절 엔진을 완성하면 이 파일의 역할은 "그 엔진이 낸 조건 목록을
// LockCondition[] 로 옮기는" 매퍼 하나로 좁아질 것이다. 지금은 그 엔진이 없으므로,
// 이 파일이 D36 의 정확한 계약(라벨·문구)을 직접 표현해 다이얼로그·테스트가 기댈 수 있는
// 안정된 대상을 만든다.

import type { LockCondition } from "./types";

export const SEAL_APPROVAL_KEY = "seal_approval";
export const SEAL_APPROVAL_LABEL = "대표 직인 승인";
export const SEAL_APPROVAL_COMPLETE_VALUE = "완료";
export const HANDOFF_TRIGGER_VALUE = "업무관리 이동";
export const HANDOFF_TRIGGER_KEY = "work_move";
export const HANDOFF_TRIGGER_LABEL = "업무이동";

/** 리드컨택 표의 현재 값 — 게이트 판정에 필요한 두 컬럼만. */
export interface ContactHandoffFields {
  /** `직인 완료` 컬럼의 현재 값. 비어 있으면 null. */
  sealApprovalStatus: string | null;
}

/**
 * `업무이동 = 업무관리 이동` 시도 시점의 가드 조건 목록.
 * 목업과 동일하게 조건 1개(직인 완료)만 담는다.
 */
export function buildContactHandoffConditions(
  fields: ContactHandoffFields,
): LockCondition[] {
  const satisfied = fields.sealApprovalStatus === SEAL_APPROVAL_COMPLETE_VALUE;
  return [
    {
      key: SEAL_APPROVAL_KEY,
      label: SEAL_APPROVAL_LABEL,
      satisfied,
      currentValueLabel: fields.sealApprovalStatus ?? "미입력",
    },
  ];
}

/** DB가 기록한 BBE-152 차단 사유를 BBE-105 표시 계약으로 변환한다. */
export function conditionFromTransitionBlockReason(reason: string): LockCondition | null {
  const sealPrefix = "대표 직인 승인이 필요합니다. 현재 직인 완료 = ";
  if (reason.startsWith(sealPrefix)) {
    return {
      key: SEAL_APPROVAL_KEY,
      label: SEAL_APPROVAL_LABEL,
      satisfied: false,
      currentValueLabel: reason.slice(sealPrefix.length).trim() || "미입력",
    };
  }
  if (reason === "업무관리 이동을 먼저 선택해 주세요.") {
    return {
      key: HANDOFF_TRIGGER_KEY,
      label: HANDOFF_TRIGGER_LABEL,
      satisfied: false,
      currentValueLabel: "미선택",
    };
  }
  return null;
}

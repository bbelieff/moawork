// BBE-105 · 이중 잠금 스위치 변경 판정 (순수 로직, D66).
//
// belie 지적(온보딩 녹취): "이 허들은 조금 없애 달라라고 하면 없애줄 수는 있는데" —
// MoaWork 는 여러 회사가 쓰는 제품이라 이 안전장치를 원하지 않는 회사도 있다.
// 조건: 끌 때는 사유가 필수다("왜 있는지 한 줄로 보여주고, 끈 기록을 남긴다"). 켤 때는
// 사유가 없어도 된다 — 다시 안전장치를 세우는 쪽으로는 정당화가 필요 없다.
//
// 경계: 실제 영속화(마이그레이션·RPC)는 이 카드 리스 밖이다. 이 함수는 시계도, DB도
// 모른다 — 호출부가 `at`(호출 시각)을 넘기고, 반환된 audit 레코드를 저장하는 것도 호출부 몫.

import type {
  LockToggleAudit,
  LockToggleRejection,
  LockToggleRequest,
} from "./types";

export type LockToggleDecision =
  | { ok: true; audit: LockToggleAudit }
  | { ok: false; rejection: LockToggleRejection };

/**
 * 스위치 변경 요청 판정.
 *
 * - enabled=false (끄기): reason 이 비어 있으면(공백만 있어도) 거부한다.
 * - enabled=true (켜기): reason 유무를 따지지 않는다.
 * - 통과 시 감사 레코드를 만든다. reason 은 앞뒤 공백을 다듬는다.
 */
export function decideLockToggle(
  request: LockToggleRequest,
  at: string,
): LockToggleDecision {
  const trimmedReason = request.reason?.trim() ?? "";

  if (!request.enabled && !trimmedReason) {
    return {
      ok: false,
      rejection: {
        code: "reason_required",
        message: "이중 잠금을 끄려면 이유를 입력해야 합니다.",
      },
    };
  }

  return {
    ok: true,
    audit: {
      actor: request.actor,
      enabled: request.enabled,
      reason: trimmedReason,
      at,
    },
  };
}

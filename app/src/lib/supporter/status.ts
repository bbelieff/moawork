import "server-only";

import { loadSupporterAccess } from "./access";
import {
  SUPPORTER_STATUS_ERROR_HTTP,
  SUPPORTER_STATUS_UNAVAILABLE,
  type SupporterMode,
  type SupporterStatus,
  type SupporterStatusError,
} from "./contracts";

/**
 * 런타임 모델 연결 여부. 첫 실제 통합에서는 등록된 어댑터가 없으므로
 * 항상 미연결이다. 하드코딩된 낙관이 아니라 "배선 없음"이라는 사실을
 * 코드로 말하는 자리이며, 활성화는 연결 검증 + 승인된 배선 뒤에 별도로 한다.
 * 어떤 세션·회사 데이터·서비스 자격증명도 읽지 않는다.
 */
export const SUPPORTER_RUNTIME_WIRED = false as const;

export function resolveRuntimeStatus(): SupporterStatus {
  // SUPPORTER_RUNTIME_WIRED 가 true 가 되더라도 여기서 세션·자격증명을
  // 꺼내지 않는다. 상태는 최소 메타데이터만 둔다.
  if (!SUPPORTER_RUNTIME_WIRED) return SUPPORTER_STATUS_UNAVAILABLE;
  return SUPPORTER_STATUS_UNAVAILABLE;
}

export type SupporterStatusResult =
  | { ok: true; status: SupporterStatus }
  | { ok: false; error: SupporterStatusError; httpStatus: number };

/**
 * 서포터 상태 조회. 접근 판정에 실패하면 상태 대신 오류를 돌려준다.
 * 백엔드 예외는 503 으로 닫는다(빈 회사·가짜 정상으로 표시하지 않음).
 */
export async function loadSupporterStatus(
  mode: SupporterMode,
): Promise<SupporterStatusResult> {
  let decision;
  try {
    decision = await loadSupporterAccess(mode);
  } catch {
    return { ok: false, error: "status_unavailable", httpStatus: 503 };
  }
  if (!decision.ok) {
    const error: SupporterStatusError =
      decision.error === "unauthenticated"
        ? "unauthenticated"
        : decision.error === "operations_forbidden"
          ? "operations_forbidden"
          : "status_unavailable";
    return { ok: false, error, httpStatus: SUPPORTER_STATUS_ERROR_HTTP[error] };
  }
  return { ok: true, status: resolveRuntimeStatus() };
}

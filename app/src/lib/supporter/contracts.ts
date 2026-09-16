/**
 * 서포터(모아서포터/운영서포터) 공유 계약.
 *
 * 클라이언트·서버가 함께 import 하는 순수 모듈이다. 타입 + I/O 없는
 * 순수 판정 함수만 둔다. 세션·회사 데이터·자격증명을 절대 담지 않는다.
 */

export type SupporterMode = "user" | "operations";

export function parseSupporterMode(value: unknown): SupporterMode | null {
  return value === "user" || value === "operations" ? value : null;
}

/**
 * 런타임 상태. 첫 실제 통합에서는 모델이 연결되지 않았으므로
 * 서버가 솔직히 판별하는 유일한 값이다.
 */
export type SupporterStatus =
  | { kind: "unavailable"; reason: "not_configured" };

export const SUPPORTER_STATUS_UNAVAILABLE: SupporterStatus = {
  kind: "unavailable",
  reason: "not_configured",
};

export type SupporterStatusError =
  | "mode_invalid"
  | "unauthenticated"
  | "operations_forbidden"
  | "status_unavailable";

export const SUPPORTER_STATUS_ERROR_HTTP: Record<SupporterStatusError, number> = {
  mode_invalid: 400,
  unauthenticated: 401,
  operations_forbidden: 403,
  status_unavailable: 503,
};

/**
 * 엄격한 상태 계약 — 서버가 돌려주는 유일한 정상 본문 모양이다.
 * 클라이언트는 이 모양과 정확히 일치할 때만 "확인됨"으로 친다.
 * 200 HTML/리다이렉트 본문·찌꺼기 필드가 섞인 응답을 승인으로 믿지 않는다.
 */
export function isUnconfiguredSupporterStatus(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1) return false;
  const status = (body as { status?: unknown }).status;
  if (!status || typeof status !== "object") return false;
  const record = status as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    record.kind === "unavailable" &&
    record.reason === "not_configured"
  );
}

/**
 * 실제 AI 어댑터 계약 — 타입 정의만 둔다.
 * 구현체 등록·provider 호출은 없으며, 연결 검증 + 승인된 배선 뒤에 별도로 활성화한다.
 * 이 인터페이스를 import 하는 것만으로는 어떤 외부 호출도 일어나지 않는다.
 */
export interface SupporterAdapterRequest {
  /** 회사 ID 또는 "platform". 서버가 검증한 컨텍스트 키와 일치해야 한다. */
  contextKey: string;
  mode: SupporterMode;
  /** 사용자 입력 원문 — 로그·영속화에 쓰지 않는다. */
  input: string;
  signal: AbortSignal;
}

export interface SupporterAdapterResponse {
  text: string;
}

export interface SupporterAdapter {
  readonly name: string;
  send(request: SupporterAdapterRequest): Promise<SupporterAdapterResponse>;
}

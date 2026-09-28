/**
 * 상담 컨설팅 도메인 — 타입 오류 (v17 consultation foundation).
 *
 * 입력 보존(input-preserving) 규칙: 검증 실패는 어느 필드가 왜 막혔는지와
 * 제출된 값을 함께 돌려준다. 화면이 입력값을 버리지 않고 실패 이유와
 * 수정할 필드를 표시할 수 있어야 한다(승인 조건 5).
 */

export type ConsultationErrorCode =
  | "invalid_request"
  | "not_allowed"
  | "stage_contract"
  | "validation"
  | "checklist_blocked"
  | "seal_required"
  | "conflict"
  | "handoff_blocked";

export class ConsultationError extends Error {
  readonly code: ConsultationErrorCode;
  /** 막힌 입력 필드 (해당될 때만). */
  readonly field: string | null;
  /** 제출된 입력값 그대로 — 화면이 값을 복원한다. */
  readonly echo: Readonly<Record<string, unknown>>;

  constructor(
    code: ConsultationErrorCode,
    message: string,
    options?: { field?: string | null; echo?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "ConsultationError";
    this.code = code;
    this.field = options?.field ?? null;
    this.echo = options?.echo ?? {};
  }
}

/** contactPipeline 과 같은 요청 식별자 규약 — 양쪽 replay/idempotency 가 같은 눈을 쓴다. */
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;

export function assertConsultationRequestId(requestId: string): void {
  if (!REQUEST_ID.test(requestId)) {
    throw new ConsultationError("invalid_request", "요청 식별자가 올바르지 않습니다.", {
      field: "requestId",
      echo: { requestId },
    });
  }
}

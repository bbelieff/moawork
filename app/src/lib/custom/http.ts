/**
 * API 라우트 공용 HTTP 헬퍼 (T05 core.custom).
 *
 * T02 `@/lib/crm/http` 와 형태는 같지만 **에러 클래스가 달라** 별도로 둔다
 * (crm 의 toErrorResponse 는 crm 의 ValidationError 만 400 으로 매핑하므로,
 *  core.custom 의 에러를 넘기면 500 으로 떨어진다).
 * 세션(Ctx)은 T03 파운데이션(`@/lib/auth/session`)을 직접 쓴다.
 */

import type { Ctx } from "@/lib/types";
import { getSessionOrNull } from "@/lib/auth/session";
import { ValidationError } from "./field-types";
import { CustomFieldError } from "./service";

export class UnauthorizedError extends Error {
  constructor(message = "인증이 필요합니다") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "권한이 없습니다") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class ServiceUnavailableError extends Error {
  constructor(message = "권한을 확인할 수 없습니다") {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

/** 현재 요청의 세션 컨텍스트. 없으면 401. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getSessionOrNull();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

export function toErrorResponse(err: unknown): Response {
  if (err instanceof ValidationError) return jsonError(err.message, 400);
  if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
  if (err instanceof ForbiddenError) return jsonError(err.message, 403);
  if (err instanceof ServiceUnavailableError) return jsonError(err.message, 503);
  // 프리셋 락·없는 정의 등 도메인 규칙 위반 → 409(충돌).
  if (err instanceof CustomFieldError) return jsonError(err.message, 409);
  const message = err instanceof Error ? err.message : "알 수 없는 오류";
  return jsonError(message, 500);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("JSON 본문을 파싱할 수 없습니다");
  }
}

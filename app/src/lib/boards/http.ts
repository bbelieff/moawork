/**
 * 보드 API 라우트 공용 HTTP 헬퍼 (T02b 보드 · T05 B3).
 *
 * `@/lib/custom/http` 와 형태는 같지만 **매핑하는 에러 클래스가 다르다**
 * (boards 의 ValidationError/NotFoundError/BoardRuleError). 다른 모듈의
 * toErrorResponse 를 재사용하면 이 에러들이 전부 500 으로 떨어진다.
 */

import type { Ctx } from "@/lib/types";
import { getSessionOrNull } from "@/lib/auth/session";
import { ValidationError } from "./validation";
import { BoardRuleError, NotFoundError } from "./service";

export class UnauthorizedError extends Error {
  constructor(message = "인증이 필요합니다") {
    super(message);
    this.name = "UnauthorizedError";
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
  if (err instanceof NotFoundError) return jsonError(err.message, 404);
  // 시스템 보드 편집 금지·무결성 필드 거부 등 도메인 규칙 위반 → 409(충돌).
  if (err instanceof BoardRuleError) return jsonError(err.message, 409);
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

/**
 * API 라우트 공용 HTTP 헬퍼 (T02).
 * 도메인 에러 → 적절한 상태코드 JSON 응답 매핑.
 */

import { ValidationError } from "./validation";
import { NotFoundError } from "./service";
import { UnauthorizedError } from "./context";

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** throw 된 에러를 상태코드로 변환. */
export function toErrorResponse(err: unknown): Response {
  if (err instanceof ValidationError) return jsonError(err.message, 400);
  if (err instanceof UnauthorizedError) return jsonError(err.message, 401);
  if (err instanceof NotFoundError) return jsonError(err.message, 404);
  const message = err instanceof Error ? err.message : "알 수 없는 오류";
  return jsonError(message, 500);
}

/** 요청 바디를 JSON 으로 파싱. 실패 시 ValidationError. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ValidationError("JSON 본문을 파싱할 수 없습니다");
  }
}

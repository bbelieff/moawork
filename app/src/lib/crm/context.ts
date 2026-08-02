/**
 * API 라우트 컨텍스트 (T02 core.crm).
 * T03 인증 레이어(`@/lib/auth/session`)의 세션을 읽어 Ctx 를 확보한다.
 * 세션이 없으면 UnauthorizedError → 401. (API 는 리다이렉트 대신 401 JSON)
 */

import type { Ctx } from "@/lib/types";
import { getSessionOrNull } from "@/lib/auth/session";

// 오류 클래스는 의존성 0 인 ./errors 가 정본이다(순수 계층에서도 쓰기 위해).
// 기존 `@/lib/crm/context` 경로 import 를 깨지 않도록 여기서 다시 내보낸다.
export { ForbiddenError, UnauthorizedError } from "./errors";
import { UnauthorizedError } from "./errors";

/** 현재 요청의 세션 컨텍스트. 없으면 UnauthorizedError. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getSessionOrNull();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

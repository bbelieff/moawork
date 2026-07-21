/**
 * API 라우트 컨텍스트 (T02 core.crm).
 * T03 인증 레이어(`@/lib/auth/session`)의 세션을 읽어 Ctx 를 확보한다.
 * 세션이 없으면 UnauthorizedError → 401. (API 는 리다이렉트 대신 401 JSON)
 */

import type { Ctx } from "@/lib/types";
import { getSessionOrNull } from "@/lib/auth/session";

export class UnauthorizedError extends Error {
  constructor(message = "인증이 필요합니다") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** 현재 요청의 세션 컨텍스트. 없으면 UnauthorizedError. */
export async function requireCtx(): Promise<Ctx> {
  const ctx = await getSessionOrNull();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}

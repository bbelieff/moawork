/**
 * 요청 컨텍스트 해석 (T02).
 *
 * ⚠ Auth/조직 소속 확정은 T03(core.org + Supabase Auth) 소유.
 * 그 전까지 MVP: 헤더 `x-org-id` / `x-user-id` 로 org 컨텍스트를 받는다.
 * T03 연동 시 이 함수만 교체하면 된다(세션 JWT → org 멤버십 조회).
 */

import type { RequestContext } from "./types";

export class UnauthorizedError extends Error {
  constructor(message = "org 컨텍스트가 없습니다") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function getRequestContext(req: Request): RequestContext {
  const orgId = req.headers.get("x-org-id");
  if (!orgId) {
    throw new UnauthorizedError(
      "x-org-id 헤더가 필요합니다 (T03 Auth 연동 전 임시 org 스코핑)",
    );
  }
  const userId = req.headers.get("x-user-id");
  return { orgId, userId: userId ?? null };
}

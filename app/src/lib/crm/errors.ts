/**
 * API 인가 오류 (T02 core.crm).
 *
 * **의존성 0** 인 파일로 따로 둔다 — 인가 판정은 순수 도메인 계층(성과 재계산 등)에서도
 * 필요한데, 이 클래스가 `context.ts` 에 있으면 그걸 import 하는 순간 `auth/session` →
 * `@supabase/ssr` 까지 딸려 들어와 서버 전용 모듈이 순수 계층을 오염시킨다.
 */

export class UnauthorizedError extends Error {
  constructor(message = "인증이 필요합니다") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * 인증은 됐지만 권한이 모자랄 때 — 401 이 아니라 **403**.
 * 401 로 내려보내면 클라이언트가 재로그인을 시도하는데, 다시 로그인해도 결과는 같다.
 */
export class ForbiddenError extends Error {
  constructor(message = "권한이 없습니다") {
    super(message);
    this.name = "ForbiddenError";
  }
}

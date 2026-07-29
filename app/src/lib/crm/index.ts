/**
 * core.crm 배럴 (T02).
 * 공유 저장소 포트 `@/lib/repo` 위의 서비스/검증/HTTP 헬퍼를 모은다.
 */

export { CrmService, NotFoundError, type PipelineWithStages } from "./service";
export { ValidationError } from "./validation";
export * from "./validation";
export { UnauthorizedError, requireCtx } from "./context";
export { jsonOk, jsonError, toErrorResponse, readJson } from "./http";
export { ACTIVITY_TYPES, stageMoveContent, type ActivityType } from "./activity";
export { AsyncCrmService } from "./asyncService";
import { CrmService } from "./service";
import { AsyncCrmService } from "./asyncService";

/**
 * 요청 처리용 서비스 인스턴스.
 *
 * 비동기 소스(`CrmSource`) 위에서 돈다 — 환경변수가 있으면 **실 Supabase**,
 * 없으면 로컬 인메모리. API 라우트는 이것만 쓴다(경로 하나로 두 저장소 지원).
 */
export function getCrmService(): AsyncCrmService {
  return new AsyncCrmService();
}

/**
 * 동기 서비스(공용 `Repo` 포트 위). 공용 포트가 아직 동기라서 남겨둔다 —
 * 인메모리 전제 테스트/트랙에서만 쓰고, 요청 경로에서는 `getCrmService()` 를 쓴다.
 */
export function getSyncCrmService(): CrmService {
  return new CrmService();
}

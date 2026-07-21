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
import { CrmService } from "./service";

/** 요청 처리용 서비스 인스턴스(공유 repo 사용). */
export function getCrmService(): CrmService {
  return new CrmService();
}

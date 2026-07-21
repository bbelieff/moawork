/**
 * 임의 보드 엔진 배럴 (T02b · ADR-0003).
 * 정책자금 파이프라인(001 deals)은 `@/lib/crm` — 여기와 별개.
 */

export * from "./types";
export * from "./cells";
export * from "./store";
export * from "./validation";
export {
  BoardsService,
  NotFoundError,
  BoardRuleError,
  DEFAULT_NEW_BOARD_COLUMNS,
} from "./service";

import { BoardsService } from "./service";

/** 요청 처리용 서비스(로컬 어댑터 사용). */
export function getBoardsService(): BoardsService {
  return new BoardsService();
}

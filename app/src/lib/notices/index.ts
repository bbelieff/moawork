/**
 * 공지사항(core.notice) 배럴 — T04.
 * 저장은 003 보드 엔진(@/lib/boards) 위. 전용 테이블 없음(ADR-0002).
 */

export * from "./types";
export {
  NoticesService,
  NoticeRuleError,
  compareNotices,
  getNoticesService,
  todayKst,
} from "./service";

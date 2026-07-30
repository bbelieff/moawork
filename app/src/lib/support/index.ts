/**
 * 지원(1:1 문의) + 접근위임 배럴 — T08.
 * 저장 정본: `supabase/migrations/017_support_access_delegation.sql`.
 */

export * from "./types";
export {
  SupportService,
  SupportRuleError,
  SupportNotFoundError,
  SupportForbiddenError,
  GRANT_BLOCKED_TABLES,
  isGrantReadable,
  sanitizeDiag,
  getSupportService,
  grantBannerText,
} from "./service";
export type { SupportAuditEntry, SupportRepo } from "./store";

/**
 * 구조 팩 배럴 — PLAN-002/WO-1.
 * 팩 데이터의 SSOT 는 `supabase/migrations/040_preset_depersonalize.sql` 이다
 * (031 이 만든 행을 040 이 최신 내용으로 update 한다 — BBE-130).
 */

export * from "./types";
export { CANONICAL_REGIONS, normalizeRegion, regionOptions } from "./region-options";
export {
  assigneeGroupDisplayName,
  assigneeGroupIdForUser,
  installStructurePack,
  reconcileAssigneeGroups,
  type AssigneeGroupBinding,
  type AssigneeMember,
  type InstallResult,
  type InstalledBoard,
} from "./install";

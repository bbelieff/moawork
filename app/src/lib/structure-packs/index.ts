/**
 * 구조 팩 배럴 — PLAN-002/WO-1.
 * 팩 데이터의 SSOT 는 `supabase/migrations/036_preset_depersonalize.sql` 이다
 * (031 이 만든 행을 036 이 최신 내용으로 update 한다 — BBE-130).
 */

export * from "./types";
export {
  SEOUL_OPTION_SETS,
  SEOUL_PACK_KEY,
  SEOUL_PACK_NAME,
  SEOUL_STRUCTURE_PACK,
  allSectionPresets,
} from "./seoul-pack";
export { CANONICAL_REGIONS, normalizeRegion, regionOptions } from "./region-options";
export { SEOUL_NEWCUST_BOARD } from "./seoul-newcust";
export { SEOUL_CONTACT_BOARD } from "./seoul-contact";
export { SEOUL_WORK_BOARD } from "./seoul-work";
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

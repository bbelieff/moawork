/**
 * 구조 팩 배럴 — PLAN-002/WO-1.
 * 팩 데이터의 SSOT 는 `supabase/migrations/031_newcust_structure_pack.sql` 이다.
 */

export * from "./types";
export {
  SEOUL_PACK_KEY,
  SEOUL_PACK_NAME,
  SEOUL_STRUCTURE_PACK,
  allSectionPresets,
} from "./seoul-pack";
export { SEOUL_NEWCUST_BOARD } from "./seoul-newcust";
export { SEOUL_CONTACT_BOARD } from "./seoul-contact";
export { SEOUL_WORK_BOARD } from "./seoul-work";
export { installStructurePack, type InstallResult, type InstalledBoard } from "./install";

/**
 * 기본 탭 배럴 — BBE-145 · D76.
 * 구조 팩(`@/lib/structure-packs`)과 다른 물건이다 — `./types.ts` 머리말의 대조표 참고.
 */

export * from "./types";
export { NEW_LEAD_TAB, NEW_LEAD_GROUPS, SEND_PENDING_REASON } from "./new-lead";
export { CONTACT_TAB, CONTACT_GROUPS } from "./contact";
export { CONTRACT_WORK_TAB, CONTRACT_WORK_TAB_SOURCE } from "./contract-work";
export { NOTICE_TAB, NOTICE_GROUPS } from "./notice";
export { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE, NOTICE_TAB_SOURCE } from "./types";
export { DEFAULT_TABS, ensureDefaultTab, ensureDefaultTabs, readDefaultTabBoardDrift, readDefaultTabBootstrapDrift, readDefaultTabDrift } from "./install";
export type { EnsuredTab } from "./install";

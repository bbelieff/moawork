export const CASE_OPTION_DOMAINS = [
  "activity.type",
  "activity.category",
  "ledger.kind",
] as const;

export type CaseOptionDomain = (typeof CASE_OPTION_DOMAINS)[number];

export type CaseOption = {
  readonly domain: CaseOptionDomain;
  readonly id: string;
  readonly label: string;
  readonly legacyAliases: readonly string[];
  readonly retired?: boolean;
  readonly providerDispatch?: false;
};

export const CASE_OPTIONS: readonly CaseOption[] = [
  { domain: "activity.type", id: "activity.status", label: "상태 변경", legacyAliases: ["status"] },
  { domain: "activity.type", id: "activity.call", label: "통화", legacyAliases: ["call"] },
  { domain: "activity.type", id: "activity.meeting", label: "미팅", legacyAliases: ["meeting"] },
  { domain: "activity.type", id: "activity.memo", label: "메모", legacyAliases: ["memo"] },
  { domain: "activity.type", id: "activity.assignment", label: "담당자 변경", legacyAliases: ["assignment"] },
  { domain: "activity.type", id: "activity.customer_message", label: "고객 메시지", legacyAliases: [], providerDispatch: false },
  { domain: "activity.category", id: "activity.category.workflow", label: "워크플로", legacyAliases: ["workflow"] },
  { domain: "activity.category", id: "activity.category.conversation", label: "대화", legacyAliases: ["conversation"] },
  { domain: "activity.category", id: "activity.category.note", label: "메모", legacyAliases: ["note"] },
  { domain: "activity.category", id: "activity.category.ownership", label: "담당", legacyAliases: ["ownership"] },
  { domain: "activity.category", id: "activity.category.customer_message", label: "고객 메시지", legacyAliases: [], providerDispatch: false },
  { domain: "ledger.kind", id: "ledger.contract_deposit", label: "계약금", legacyAliases: ["contract_deposit"] },
  { domain: "ledger.kind", id: "ledger.fee", label: "수수료", legacyAliases: ["fee"] },
] as const;

export type ActivityTypeId =
  | "activity.status"
  | "activity.call"
  | "activity.meeting"
  | "activity.memo"
  | "activity.assignment"
  | "activity.customer_message";
export type ActivityCategoryId =
  | "activity.category.workflow"
  | "activity.category.conversation"
  | "activity.category.note"
  | "activity.category.ownership"
  | "activity.category.customer_message";
export type LedgerOptionId = "ledger.contract_deposit" | "ledger.fee";

export const FINANCE_PERMISSION_KEYS = {
  read: "finance.ledger_read",
  manage: "finance.ledger_manage",
} as const;

/**
 * Stable IDs are the write contract. Legacy labels/keys remain read aliases only;
 * retired entries may still resolve for historical rows but are never writable.
 */
export function resolveCaseOption(
  domain: CaseOptionDomain,
  value: string,
  mode: "read" | "write" = "read",
): CaseOption | undefined {
  const option = CASE_OPTIONS.find(
    (candidate) =>
      candidate.domain === domain &&
      (candidate.id === value || candidate.legacyAliases.includes(value)),
  );
  if (mode === "write" && option?.retired) return undefined;
  return option;
}

export function legacyAliasOf(optionId: string): string | undefined {
  return CASE_OPTIONS.find((option) => option.id === optionId)?.legacyAliases[0];
}

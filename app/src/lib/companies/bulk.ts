import { parseUpdateCompany, parseUpdateDeal } from "@/lib/crm/validation";

/**
 * 업체관리 현황 일괄 선택 pure 헬퍼.
 *
 * board 쪽 bulk-selection 판정을 재사용한다 — 선택 집합은 1곳, 대상은
 * «선택 ∩ 보이는·펼쳐진 행», 접힌 하위는 절대 포함하지 않는다.
 * id는 `company:<id>` / `deal:<id>` 로 구분하고, 업체 선택이 하위 딜을
 * 암묵 선택하지 않는다.
 */

export const COMPANY_BULK_PREFIX = "company:";
export const DEAL_BULK_PREFIX = "deal:";

export type CompaniesBulkKind = "company" | "deal";

export function toCompanyBulkId(id: string): string {
  return `${COMPANY_BULK_PREFIX}${id}`;
}

export function toDealBulkId(id: string): string {
  return `${DEAL_BULK_PREFIX}${id}`;
}

export function parseCompaniesBulkId(value: string): { kind: CompaniesBulkKind; id: string } | null {
  if (value.startsWith(COMPANY_BULK_PREFIX) && value.length > COMPANY_BULK_PREFIX.length) {
    return { kind: "company", id: value.slice(COMPANY_BULK_PREFIX.length) };
  }
  if (value.startsWith(DEAL_BULK_PREFIX) && value.length > DEAL_BULK_PREFIX.length) {
    return { kind: "deal", id: value.slice(DEAL_BULK_PREFIX.length) };
  }
  return null;
}

export function splitCompaniesBulkIds(ids: readonly string[]): {
  companyIds: string[];
  dealIds: string[];
} {
  const companyIds: string[] = [];
  const dealIds: string[] = [];
  for (const entry of ids) {
    const parsed = parseCompaniesBulkId(entry);
    if (!parsed) continue;
    if (parsed.kind === "company") companyIds.push(parsed.id);
    else dealIds.push(parsed.id);
  }
  return { companyIds, dealIds };
}

export type CompaniesBulkVisibleView = Readonly<{
  companyId: string;
  dealIds: readonly string[];
}>;

/**
 * 보이는·펼쳐진 순서대로 bulk id를 펼친다.
 * 접힌 회사의 하위 딜은 포함하지 않는다 — 펼쳐진 행만 실제 대상이다.
 */
export function visibleCompaniesBulkIds(
  views: readonly CompaniesBulkVisibleView[],
  open: Readonly<Record<string, boolean>>,
): string[] {
  const out: string[] = [];
  for (const view of views) {
    out.push(toCompanyBulkId(view.companyId));
    if (open[view.companyId]) {
      for (const dealId of view.dealIds) out.push(toDealBulkId(dealId));
    }
  }
  return out;
}

export function describeCompaniesBulkTargets(ids: readonly string[]): {
  companyCount: number;
  dealCount: number;
  label: string;
} {
  const { companyIds, dealIds } = splitCompaniesBulkIds(ids);
  const companyCount = new Set(companyIds).size;
  const dealCount = new Set(dealIds).size;
  const parts: string[] = [];
  if (companyCount > 0) parts.push(`회사 ${companyCount}개`);
  if (dealCount > 0) parts.push(`자금 건 ${dealCount}개`);
  return {
    companyCount,
    dealCount,
    label: parts.length > 0 ? parts.join(" · ") : "선택 없음",
  };
}

/**
 * 회사 행 집계(상태·금액·담당)는 직접 수정하지 않는다 — 접은 값이라 정본이 아니다.
 * 일괄로 고칠 수 있는 회사 일반 필드만 둔다.
 */
export const COMPANY_BULK_EDITABLE_FIELDS = [
  { key: "biz_type", label: "업종", type: "text" },
  { key: "region", label: "지역", type: "text" },
  { key: "owner_name", label: "대표자", type: "text" },
  { key: "phone", label: "연락처", type: "text" },
  { key: "email", label: "이메일", type: "text" },
  { key: "homepage", label: "홈페이지", type: "text" },
  { key: "revenue", label: "매출", type: "number" },
  { key: "founded_on", label: "설립일", type: "date" },
] as const;

export type CompanyBulkFieldKey = (typeof COMPANY_BULK_EDITABLE_FIELDS)[number]["key"];

/**
 * 딜 일반 필드 — 단계(stage_id) 변경은 move 전용이라 일괄에서 받지 않는다.
 * 담당(assigned_to)은 lineage 경로 전용이라 일반 필드에서 뺀다.
 */
export const DEAL_BULK_EDITABLE_FIELDS = [
  { key: "title", label: "자금명", type: "text" },
  { key: "amount", label: "실행액", type: "number" },
  { key: "applied_on", label: "신청일", type: "date" },
  { key: "status_note", label: "상태 메모", type: "text" },
] as const;

export type DealBulkFieldKey = (typeof DEAL_BULK_EDITABLE_FIELDS)[number]["key"];

const COMPANY_BULK_FIELD_KEYS = new Set<string>(
  COMPANY_BULK_EDITABLE_FIELDS.map((field) => field.key),
);
const DEAL_BULK_FIELD_KEYS = new Set<string>(DEAL_BULK_EDITABLE_FIELDS.map((field) => field.key));

/** 집계 직접수정 차단 — 상태·금액·담당을 회사 필드로 보내면 거부한다. */
const COMPANY_AGGREGATE_BLOCKED = new Set(["status", "amount", "assigned_to", "owner", "execution_amount"]);

export function validateCompanyBulkPatch(field: string, value: unknown): Record<string, unknown> {
  if (COMPANY_AGGREGATE_BLOCKED.has(field)) {
    throw new Error("회사 집계(상태·금액·담당)는 직접 수정할 수 없습니다");
  }
  if (!COMPANY_BULK_FIELD_KEYS.has(field)) {
    throw new Error("일괄로 고칠 수 없는 회사 필드입니다");
  }
  return parseUpdateCompany({ [field]: value }) as Record<string, unknown>;
}

export function validateDealBulkPatch(field: string, value: unknown): Record<string, unknown> {
  if (!DEAL_BULK_FIELD_KEYS.has(field)) {
    throw new Error("일괄로 고칠 수 없는 자금 건 필드입니다");
  }
  return parseUpdateDeal({ [field]: value }) as Record<string, unknown>;
}

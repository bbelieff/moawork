import { createHash } from "node:crypto";
import { WORK_TEMPLATE_KEY, WORK_TEMPLATE_VERSION, type WorkColumnContract } from "./contracts";

const legacy = (key: string, label: string, kind: WorkColumnContract["kind"], order: number, extra: Partial<WorkColumnContract> = {}): WorkColumnContract => ({ key, label, kind, legacyOrder: order, ...extra });

export const LEGACY_WORK_COLUMNS: readonly WorkColumnContract[] = [
  legacy("title", "태스크", "title", 1), legacy("assigned_to", "담당자", "person", 2),
  legacy("company", "회사명", "virtual", 3, { readOnly: true }), legacy("homepage", "홈페이지", "virtual", 4, { readOnly: true }),
  legacy("business_type", "사업자유형", "select", 5), legacy("founded_year", "창업년도", "year", 6),
  legacy("files", "파일", "file", 7), legacy("link", "링크", "url", 8), legacy("annual_revenue", "연 매출액", "amount", 9),
  legacy("representative", "대표자명", "virtual", 10, { readOnly: true }), legacy("email", "이메일", "virtual", 11, { readOnly: true }),
  legacy("phone", "전화번호", "virtual", 12, { readOnly: true }), legacy("industry", "업종/업태", "select", 13),
  legacy("regions", "지역", "multiselect", 14), legacy("institution", "진행 기관", "select", 15), legacy("product", "진행 상품", "select", 16),
  legacy("workflow_status", "진행상황", "select", 17, { sourceAliases: ["진행상항"] }),
  legacy("visit_application_date", "방문 및 신청 일", "date", 18), legacy("review_period", "예상 심사기간", "date_range", 19),
  legacy("inspection_date", "실사일", "date", 20), legacy("guidance", "지도내용", "longtext", 21), legacy("execution_amount", "실행액", "amount", 22),
  legacy("fee_percent", "수수료(%)", "percent", 23), legacy("fee_amount", "수수료(원)", "amount", 24),
  legacy("fee_paid_on", "수수료 입금일", "date", 25, { sourceAliases: ["수수료_입금일"] }), legacy("total_revenue", "총 매출액", "amount", 26),
  legacy("reapply_date", "재신청 안내일", "date", 27), legacy("d180", "D+180", "date", 28), legacy("d365", "D+365", "date", 29),
  legacy("deposit", "계약금", "amount", 30), legacy("deposit_paid_on", "계약금 입금일", "date", 31, { sourceAliases: ["계약금_입금일"] }),
] as const;

export const DUE_DATE_COLUMN: WorkColumnContract = { key: "due_date", label: "마감일", kind: "system_date", legacyOrder: null, system: true };
export const WORK_COLUMNS = [...LEGACY_WORK_COLUMNS.slice(0, 17), DUE_DATE_COLUMN, ...LEGACY_WORK_COLUMNS.slice(17)] as const;
export const DEFAULT_WORK_GROUPS = ["준비단계", "진행중", "완료"] as const;
export const DEFAULT_WORK_VIEWS = [
  { name: "메인 테이블", kind: "table", isDefault: true }, { name: "캘린더", kind: "calendar", isDefault: false }, { name: "간트", kind: "gantt", isDefault: false },
] as const;

export function structureFingerprint(columns: readonly WorkColumnContract[] = LEGACY_WORK_COLUMNS): string {
  return createHash("sha256").update(JSON.stringify(columns.map(({ key, label, kind, legacyOrder, sourceAliases, readOnly, system }) => ({ key, label, kind, legacyOrder, sourceAliases: sourceAliases ?? [], readOnly: Boolean(readOnly), system: Boolean(system) })))).digest("hex");
}

export function currentStructureFingerprint(columns: readonly WorkColumnContract[]): string { return structureFingerprint(columns); }

export const WORK_TEMPLATE = { key: WORK_TEMPLATE_KEY, version: WORK_TEMPLATE_VERSION, columns: WORK_COLUMNS, groups: DEFAULT_WORK_GROUPS, views: DEFAULT_WORK_VIEWS, baselineFingerprint: structureFingerprint() } as const;

export function validateLegacyTemplate(columns: readonly WorkColumnContract[]): string[] {
  const errors: string[] = [];
  if (columns.length !== 31) errors.push("legacy_column_count");
  columns.forEach((column, index) => { if (column.legacyOrder !== index + 1) errors.push(`legacy_order:${column.key}`); });
  if (new Set(columns.map((column) => column.key)).size !== columns.length) errors.push("duplicate_key");
  return errors;
}

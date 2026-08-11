/**
 * Monday CSV를 실제 데이터에 적용하기 전의 순수 preview 계약이다.
 * 이 모듈은 DB·네트워크·자동 병합을 수행하지 않는다.
 */

export type MondayImportRow = Readonly<{
  rowNumber: number;
  externalItemId: string | null;
  companyName: string | null;
  raw: Readonly<Record<string, string>>;
}>;

export type ExistingMondayLink = Readonly<{
  workspaceId: string;
  externalItemId: string;
}>;

export type ExistingCompany = Readonly<{
  workspaceId: string;
  normalizedName: string;
}>;

export type MondayImportDecision =
  | "create"
  | "skip_exact_duplicate"
  | "needs_review"
  | "reject";

export type MondayImportPreviewRow = Readonly<{
  rowNumber: number;
  decision: MondayImportDecision;
  reasons: readonly (
    | "duplicate_in_file"
    | "duplicate_external_id"
    | "missing_external_id"
    | "possible_company_duplicate"
    | "missing_company_name"
  )[];
  /** 원본 값은 preview에서만 보존하며 이름으로 기존 회사를 갱신하거나 병합하지 않는다. */
  raw: Readonly<Record<string, string>>;
}>;

export type MondayImportPreview = Readonly<{
  workspaceId: string;
  rows: readonly MondayImportPreviewRow[];
  counts: Readonly<Record<MondayImportDecision, number>>;
  /** CT01 지역 분해 규칙 전에는 원본 지역 문자열을 분해하거나 변환하지 않는다. */
  regionPolicy: "preserve_source_until_ct01";
}>;

const normalizeCompanyName = (value: string | null) => value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR") ?? "";
const isMissingExternalItemId = (value: string | null): value is null | "" => value === null || value === "";

function increment(counts: Record<MondayImportDecision, number>, decision: MondayImportDecision) {
  counts[decision] += 1;
}

/**
 * D40: 이름이 같거나 비슷하다는 이유로 기존 회사를 갱신/병합하지 않는다.
 * 같은 workspace의 이미 처리된 Monday item ID만 안전하게 "이미 처리됨"으로 분류한다.
 */
export function previewMondayImport(input: Readonly<{
  workspaceId: string;
  rows: readonly MondayImportRow[];
  existingLinks: readonly ExistingMondayLink[];
  existingCompanies: readonly ExistingCompany[];
}>): MondayImportPreview {
  if (!input.workspaceId.trim()) throw new Error("workspaceId is required");

  const existingExternalIds = new Set(
    input.existingLinks
      .filter((link) => link.workspaceId === input.workspaceId)
      .map((link) => link.externalItemId),
  );
  const existingCompanyNames = new Set(
    input.existingCompanies
      .filter((company) => company.workspaceId === input.workspaceId)
      .map((company) => normalizeCompanyName(company.normalizedName)),
  );
  const fileExternalIdCounts = new Map<string, number>();
  for (const row of input.rows) {
    if (!isMissingExternalItemId(row.externalItemId)) {
      fileExternalIdCounts.set(row.externalItemId, (fileExternalIdCounts.get(row.externalItemId) ?? 0) + 1);
    }
  }
  const counts: Record<MondayImportDecision, number> = {
    create: 0,
    skip_exact_duplicate: 0,
    needs_review: 0,
    reject: 0,
  };

  const rows = input.rows
    .slice()
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((row): MondayImportPreviewRow => {
      // Monday item ID는 opaque identity다. 대소문자·공백을 포함해 원문 그대로 비교한다.
      const externalItemId = row.externalItemId;
      const companyName = normalizeCompanyName(row.companyName);
      const reasons: MondayImportPreviewRow["reasons"][number][] = [];

      if (isMissingExternalItemId(externalItemId)) reasons.push("missing_external_id");
      if (!companyName) reasons.push("missing_company_name");
      if (!isMissingExternalItemId(externalItemId) && (fileExternalIdCounts.get(externalItemId) ?? 0) > 1) reasons.push("duplicate_in_file");
      if (!isMissingExternalItemId(externalItemId) && existingExternalIds.has(externalItemId)) reasons.push("duplicate_external_id");
      if (companyName && existingCompanyNames.has(companyName)) reasons.push("possible_company_duplicate");

      const decision: MondayImportDecision =
        reasons.includes("missing_external_id") || reasons.includes("missing_company_name") || reasons.includes("duplicate_in_file")
          ? "reject"
          : reasons.includes("duplicate_external_id")
            ? "skip_exact_duplicate"
            : reasons.includes("possible_company_duplicate")
              ? "needs_review"
              : "create";
      increment(counts, decision);
      return { rowNumber: row.rowNumber, decision, reasons, raw: row.raw };
    });

  return { workspaceId: input.workspaceId, rows, counts, regionPolicy: "preserve_source_until_ct01" };
}

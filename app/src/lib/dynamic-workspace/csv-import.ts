/**
 * Deidentified CSV dry-run contract. This module only plans an import; it has
 * no database, network, or owner-apply implementation.
 */
export type CsvImportScope = Readonly<{
  orgId: string;
  workspaceId: string;
  sourceId: string;
  mappingVersion: string;
}>;

export type CsvFieldMapping = Readonly<{
  sourceHeader: string;
  targetField: string;
  required: boolean;
}>;

export type CsvRowDiagnostic = Readonly<{
  rowNumber: number;
  code: "missing_required" | "duplicate_external_id" | "column_count";
  severity: "error" | "warning";
  message: string;
}>;

export type CsvQuarantinedRow = Readonly<{
  rowNumber: number;
  reason: CsvRowDiagnostic["code"];
}>;

export type CsvImportRowPlan = Readonly<{
  rowNumber: number;
  externalId: string | null;
  values: Readonly<Record<string, string>>;
}>;

export type CsvDryRunPlan = Readonly<{
  kind: "csv_dry_run";
  scope: CsvImportScope;
  idempotencyKey: string;
  rows: readonly CsvImportRowPlan[];
  diagnostics: readonly CsvRowDiagnostic[];
  quarantinedRows: readonly CsvQuarantinedRow[];
  canApply: boolean;
  persistence: "external_authorized_persistence_required";
}>;

export type OwnerApplyContract = Readonly<{
  kind: "owner_apply_contract";
  idempotencyKey: string;
  scope: CsvImportScope;
  requiresOwnerAuthorization: true;
  canMutateHere: false;
}>;

function splitCsvLine(line: string): string[] | null {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += character;
  }
  if (quoted) return null;
  values.push(value.trim());
  return values;
}

function stableKey(scope: CsvImportScope, headers: readonly string[], source: string): string {
  const payload = `${scope.orgId}|${scope.workspaceId}|${scope.sourceId}|${scope.mappingVersion}|${headers.join("\u001f")}|${source}`;
  let hash = 2166136261;
  for (const character of payload) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `csv-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function validScope(scope: CsvImportScope): boolean {
  return Boolean(scope.orgId && scope.workspaceId && scope.sourceId && scope.mappingVersion);
}

/** Parses in-memory CSV text and builds a non-mutating, explicit-mapping plan. */
export function planCsvDryRun(input: Readonly<{
  scope: CsvImportScope;
  csvText: string;
  mappings: readonly CsvFieldMapping[];
  externalIdHeader?: string;
}>): CsvDryRunPlan {
  if (!validScope(input.scope)) throw new Error("orgId, workspaceId, sourceId, and mappingVersion are required.");
  const lines = input.csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  const headers = lines.length > 0 ? splitCsvLine(lines[0]) : null;
  if (!headers || headers.length === 0 || new Set(headers).size !== headers.length) throw new Error("CSV headers must be present and unique.");
  const mappings = [...input.mappings];
  if (mappings.length === 0 || new Set(mappings.map((mapping) => mapping.sourceHeader)).size !== mappings.length) {
    throw new Error("Mappings must be explicit and unique.");
  }
  for (const mapping of mappings) if (!headers.includes(mapping.sourceHeader) || !mapping.targetField) throw new Error("Mapping does not match CSV headers.");

  const diagnostics: CsvRowDiagnostic[] = [];
  const quarantinedRows: CsvQuarantinedRow[] = [];
  const rows: CsvImportRowPlan[] = [];
  const seenExternalIds = new Set<string>();
  const externalIndex = input.externalIdHeader ? headers.indexOf(input.externalIdHeader) : -1;
  if (input.externalIdHeader && externalIndex < 0) throw new Error("externalIdHeader does not match CSV headers.");

  lines.slice(1).forEach((line, offset) => {
    const rowNumber = offset + 2;
    const cells = splitCsvLine(line);
    if (!cells || cells.length !== headers.length) {
      diagnostics.push({ rowNumber, code: "column_count", severity: "error", message: "CSV 열 개수를 확인해 주세요." });
      quarantinedRows.push({ rowNumber, reason: "column_count" });
      return;
    }
    const byHeader = Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
    const missing = mappings.find((mapping) => mapping.required && !byHeader[mapping.sourceHeader]);
    if (missing) {
      diagnostics.push({ rowNumber, code: "missing_required", severity: "error", message: "필수 값을 확인해 주세요." });
      quarantinedRows.push({ rowNumber, reason: "missing_required" });
      return;
    }
    const externalId = externalIndex < 0 ? null : cells[externalIndex];
    if (externalId && seenExternalIds.has(externalId)) {
      diagnostics.push({ rowNumber, code: "duplicate_external_id", severity: "error", message: "같은 외부 ID가 파일에 두 번 있습니다." });
      quarantinedRows.push({ rowNumber, reason: "duplicate_external_id" });
      return;
    }
    if (externalId) seenExternalIds.add(externalId);
    rows.push({
      rowNumber,
      externalId,
      values: Object.fromEntries(mappings.map((mapping) => [mapping.targetField, byHeader[mapping.sourceHeader]])),
    });
  });

  return {
    kind: "csv_dry_run",
    scope: input.scope,
    idempotencyKey: stableKey(input.scope, headers, input.csvText),
    rows,
    diagnostics,
    quarantinedRows,
    canApply: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    persistence: "external_authorized_persistence_required",
  };
}

/** Produces an authorization boundary only; persistence must be supplied by a separately authorized owner flow. */
export function createOwnerApplyContract(plan: CsvDryRunPlan): OwnerApplyContract {
  if (!plan.canApply) throw new Error("A dry-run with errors cannot be submitted for owner apply.");
  return {
    kind: "owner_apply_contract",
    idempotencyKey: plan.idempotencyKey,
    scope: plan.scope,
    requiresOwnerAuthorization: true,
    canMutateHere: false,
  };
}

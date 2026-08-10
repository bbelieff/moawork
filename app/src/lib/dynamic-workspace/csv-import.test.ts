import { describe, expect, it } from "vitest";
import { createOwnerApplyContract, planCsvDryRun } from "./csv-import";

const scope = { orgId: "org-demo", workspaceId: "workspace-demo", sourceId: "source-demo", mappingVersion: "v1" } as const;
const mappings = [
  { sourceHeader: "external_id", targetField: "externalId", required: true },
  { sourceHeader: "company", targetField: "companyName", required: true },
] as const;

describe("CSV dry-run planner", () => {
  it("creates a stable, explicit-mapping plan without persistence", () => {
    const input = { scope, mappings, externalIdHeader: "external_id", csvText: "external_id,company\nrow-1,Example\n" };
    const first = planCsvDryRun(input);
    const second = planCsvDryRun(input);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first).toMatchObject({ canApply: true, persistence: "external_authorized_persistence_required" });
    expect(first.rows).toEqual([{ rowNumber: 2, externalId: "row-1", values: { externalId: "row-1", companyName: "Example" } }]);
  });

  it("quarantines row diagnostics and blocks an owner apply contract", () => {
    const plan = planCsvDryRun({ scope, mappings, externalIdHeader: "external_id", csvText: "external_id,company\nrow-1,Example\nrow-1,Duplicate\n,Missing\n" });
    expect(plan.rows).toHaveLength(1);
    expect(plan.quarantinedRows.map((row) => row.reason)).toEqual(["duplicate_external_id", "missing_required"]);
    expect(plan.canApply).toBe(false);
    expect(() => createOwnerApplyContract(plan)).toThrow("dry-run with errors");
  });

  it("returns an external owner authorization seam rather than a mutation", () => {
    const plan = planCsvDryRun({ scope, mappings, externalIdHeader: "external_id", csvText: "external_id,company\nrow-1,Example" });
    expect(createOwnerApplyContract(plan)).toMatchObject({
      requiresOwnerAuthorization: true,
      canMutateHere: false,
      idempotencyKey: plan.idempotencyKey,
    });
  });
});

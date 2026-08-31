import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CASE_OPTIONS, FINANCE_PERMISSION_KEYS, legacyAliasOf, resolveCaseOption } from "./registry";

describe("case option registry", () => {
  it("keeps stable IDs unique and resolves legacy aliases without making them canonical", () => {
    expect(new Set(CASE_OPTIONS.map((option) => `${option.domain}:${option.id}`)).size).toBe(13);
    expect(resolveCaseOption("activity.type", "status")?.id).toBe("activity.status");
    expect(resolveCaseOption("ledger.kind", "fee")?.id).toBe("ledger.fee");
    expect(legacyAliasOf("ledger.contract_deposit")).toBe("contract_deposit");
  });

  it("exposes message activity as a provider-free future seam", () => {
    const message = resolveCaseOption("activity.type", "activity.customer_message", "write");
    expect(message?.providerDispatch).toBe(false);
  });

  it("separates ledger read and manage permissions", () => {
    expect(FINANCE_PERMISSION_KEYS).toEqual({
      read: "finance.ledger_read",
      manage: "finance.ledger_manage",
    });
  });

  it("matches the additive SQL registry and permission keys", () => {
    const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/144_issue645_case_ownership_registry.sql"), "utf8");
    for (const option of CASE_OPTIONS) expect(sql).toContain(`'${option.domain}','${option.id}'`);
    for (const key of Object.values(FINANCE_PERMISSION_KEYS)) expect(sql).toContain(`'${key}'`);
  });
});

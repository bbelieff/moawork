import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/035_ledger.sql"),
  "utf8",
);

describe("deal ledger migration", () => {
  it("keeps one deal and attaches many ledger rows with cascade cleanup", () => {
    expect(sql).toContain("deal_id uuid not null references public.deals(id) on delete cascade");
    expect(sql).not.toMatch(/unique\s*\(\s*deal_id\s*\)/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.deals/i);
  });

  it("derives totals and receivables only from ledger rows", () => {
    expect(sql).toContain("sum(amount) filter (where kind = 'fee')");
    expect(sql).toContain("sum(amount - received_amount)");
    expect(sql).toContain("received_amount between 0 and amount");
  });

  it("uses tenant and assigned-scope guards without app_admins", () => {
    expect(sql).toContain("public.is_org_member(d.org_id)");
    expect(sql).toContain("d.assigned_to = auth.uid()");
    expect(sql).not.toContain("app_admins");
    expect(sql).toContain("add_deal_ledger_entry");
    expect(sql).toContain("delete_deal_ledger_entry");
  });
});

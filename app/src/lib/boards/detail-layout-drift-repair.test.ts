import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/088_bbe175_detail_layout_drift_repair.sql"),
  "utf8",
);

describe("BBE-175 detail-layout hosted drift repair contract", () => {
  it("is additive, array-validated, role-guarded, and customer-row preserving", () => {
    expect(sql).toContain("add column if not exists detail_layout_jsonb jsonb default '[]'::jsonb");
    expect(sql).toContain("add column if not exists detail_layout_jsonb jsonb");
    expect(sql).toContain("jsonb_typeof(detail_layout_jsonb) = 'array'");
    expect(sql).toContain("not in ('owner', 'admin')");
    expect(sql).toContain("before insert or update of detail_layout_jsonb");
    expect(sql).toContain("security invoker");
    expect(sql).not.toMatch(/\bupdate\s+public\.(boards|board_groups)\b/i);
  });
});

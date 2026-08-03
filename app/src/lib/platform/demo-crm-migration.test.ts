import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../../supabase/migrations/025_platform_demo_crm_admin_boundary.sql", import.meta.url), "utf8");

describe("platform demo CRM database boundary", () => {
  it("keeps access platform-only and does not relax tenant RLS", () => {
    expect(sql).toContain("not public.is_platform_admin()");
    expect(sql).toContain("reviewed_internal_demo");
    expect(sql).toContain("revoke all on table public.platform_demo_crm_imports");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("and s.kind = v_kind");
  });

  it("creates a deal and initial activity in one idempotent RPC", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("insert into public.deals");
    expect(sql).toContain("insert into public.activities");
    expect(sql).toContain("rows_payload is distinct from p_rows");
    expect(sql).toContain("insert into public.stages");
    expect(sql).toContain("platform-demo-crm-stage:");
  });
});

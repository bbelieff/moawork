import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/076_permission_read_foundation_repair.sql"), "utf8");

describe("permission read foundation repair", () => {
  it("is additive, tenant checked, and grants only authenticated execution", () => {
    expect(sql).toContain("create table if not exists public.org_role_permission_overrides");
    expect(sql).toContain("m.org_id=p_org_id and m.user_id=v_actor and m.status='active'");
    expect(sql).toContain("i.org_id=p_org_id");
    expect(sql).toContain("i.assigned_to=v_actor");
    expect(sql).toContain("grant execute on function public.effective_permission(uuid,text) to authenticated");
    expect(sql).not.toMatch(/\b(update|delete from|truncate)\b/i);
  });
});

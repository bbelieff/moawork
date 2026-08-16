import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/076_permission_read_foundation_repair.sql"), "utf8");
const reporting = readFileSync(resolve(process.cwd(), "../supabase/migrations/050_org_reporting.sql"), "utf8").trim();
const permissions = readFileSync(resolve(process.cwd(), "../supabase/migrations/055_permission_role_matrix.sql"), "utf8").trim();

describe("permission read foundation repair", () => {
  it("replays the canonical organization and permission definitions without semantic reduction", () => {
    expect(sql).toContain(reporting);
    expect(sql).toContain(permissions);
    expect(sql).toContain("alter type public.member_role add value if not exists 'team_lead'");
    expect(sql).toContain("alter type public.member_scope add value if not exists 'department'");
    expect(sql).toContain("revoke all on function public.effective_permission(uuid, text) from service_role");
    expect(sql).toContain("revoke all on function public.read_permission_scoped_work_items(uuid, uuid) from service_role");
  });
});

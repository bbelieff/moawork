import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/070_seal_approval_requests.sql"), "utf8");
describe("070 seal approval migration", () => {
  it("is tenant-idempotent, audited, permission checked and not public", () => {
    expect(sql).toMatch(/unique\s*\(org_id,\s*request_id\)/i);
    expect(sql).toMatch(/v_role in \('owner','admin'\)[\s\S]*v_scope='all'[\s\S]*v_assigned=v_actor/i);
    expect(sql).toMatch(/m\.status='active' and o\.status='active'/i);
    expect(sql).toMatch(/m\.status='active'[\s\S]*m\.role in \('owner','admin'\)/i);
    expect(sql).toMatch(/insert into public\.notifications/i);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all on function public\.request_deal_seal_approval[\s\S]*from public/i);
    expect(sql).toMatch(/grant execute[\s\S]*to authenticated/i);
  });
});

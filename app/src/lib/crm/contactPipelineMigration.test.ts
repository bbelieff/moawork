import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/069_contact_pipeline_transitions.sql"), "utf8");

describe("BBE-152 transition migration", () => {
  it("records actor, before/after stages and blocked reasons under tenant RLS", () => {
    expect(sql).toMatch(/org_id uuid not null/);
    expect(sql).toMatch(/source_item_id uuid/);
    expect(sql).toMatch(/from_stage_id uuid/);
    expect(sql).toMatch(/to_stage_id uuid/);
    expect(sql).toMatch(/actor_id uuid not null/);
    expect(sql).toMatch(/block_reason text/);
    expect(sql).toMatch(/enable row level security/);
  });
  it("locks the deal, enforces the seal and performs company handoff in the same transaction", () => {
    expect(sql).toMatch(/for update/);
    expect(sql).toContain("대표 직인 승인이 필요합니다. 현재 직인 완료 = ");
    expect(sql).toMatch(/handoff_company_to_work/);
    expect(sql).toMatch(/column_key='seal_status'/);
    expect(sql).toMatch(/column_key='work_move'/);
    expect(sql).toMatch(/update public\.deals set stage_id=v_to/);
  });
  it("does not expose mutation access outside the authenticated RPC", () => {
    expect(sql).toMatch(/revoke all on public\.contact_pipeline_transitions from public, anon/);
    expect(sql).toMatch(/grant execute on function[\s\S]*to authenticated/);
  });
});

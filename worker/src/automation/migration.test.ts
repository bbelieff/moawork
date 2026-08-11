import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../supabase/migrations/057_automation_execution_trusted_request.sql", import.meta.url), "utf8");

describe("057 trusted automation execution contract", () => {
  it("uses an atomic non-null execution ledger and one trusted RPC", () => {
    expect(sql).toContain("execution_key text primary key");
    expect(sql).toContain("for update");
    expect(sql).toContain("execute_trusted_board_automation");
    expect(sql).toContain("update public.items");
    expect(sql).toContain("state = 'succeeded'");
  });

  it("recomputes current tenant, status and condition scope in the database", () => {
    expect(sql).toContain("item.org_id = request_row.org_id");
    expect(sql).toContain("coalesce(status_value->>'label_id', '')");
    expect(sql).toContain("automation_condition_matches");
  });

  it("fails closed before is_not evaluation when the current condition value is missing or JSON null", () => {
    expect(sql).toContain("p_value is null");
    expect(sql).toContain("p_value = 'null'::jsonb");
    expect(sql).toContain("then false");
  });

  it("is service-role only, disables the legacy payload RPC and preserves 042 storage", () => {
    expect(sql).toContain("revoke execute on function public.execute_board_automation_move");
    expect(sql).toContain("grant execute on function public.execute_trusted_board_automation");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("alter table public.board_automation_rules");
  });
});

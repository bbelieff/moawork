import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../supabase/migrations/045_automation_execution.sql", import.meta.url), "utf8");

describe("045 automation execution contract", () => {
  it("owns atomic claim, move and append-only history", () => {
    expect(sql).toContain("unique (execution_key, rule_id)");
    expect(sql).toContain("attempt_count = public.board_automation_execution_claims.attempt_count + 1");
    expect(sql).toContain("claim_id uuid references public.board_automation_execution_claims");
    expect(sql).toContain("execute_board_automation_move");
    expect(sql).toContain("update public.items");
    expect(sql).toContain("status = 'succeeded'");
  });

  it("is service-role only and does not alter GT04 condition storage", () => {
    expect(sql).toContain("grant execute on function public.execute_board_automation_move");
    expect(sql).toContain("to service_role");
    expect(sql).not.toContain("alter table public.board_automation_rules");
  });
});

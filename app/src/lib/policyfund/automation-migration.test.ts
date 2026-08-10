import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../../supabase/migrations/035_automation_cond.sql", import.meta.url), "utf8");

describe("035 automation AND contract", () => {
  it("stores an ordered condition array and stable trigger label id", () => {
    expect(sql).toContain("add column if not exists trigger_label_id text");
    expect(sql).toContain("add column if not exists conditions jsonb not null default '[]'::jsonb");
    expect(sql).toContain("^label:[A-Za-z0-9_-]+$");
  });

  it("accepts only flat AND condition operators and stable status label ids", () => {
    expect(sql).toContain("condition->>'operator' not in ('is', 'is_not')");
    expect(sql).toContain("condition->>'value_kind' not in ('label_id', 'user_id', 'text')");
    expect(sql).toContain("board_automation_conditional_trigger_check");
    expect(sql).not.toContain("'or'");
  });

  it("keeps legacy condition-free rules valid", () => {
    expect(sql).toContain("jsonb_array_length(conditions) = 0 or trigger_label_id is not null");
  });

  it("stores every skipped reason instead of silently dropping execution", () => {
    expect(sql).toContain("create table if not exists public.board_automation_evaluations");
    expect(sql).toContain("outcome text not null check (outcome in ('executed', 'skipped'))");
    expect(sql).toContain("outcome = 'skipped' and jsonb_array_length(blocked_reasons) > 0");
    expect(sql).toContain("record_board_automation_evaluation");
    expect(sql).toMatch(/grant execute on function public\.record_board_automation_evaluation[\s\S]*to service_role/);
  });

  it("stores expanded action schemas without replacing existing migrations", () => {
    for (const kind of ["move_group", "move_board", "set_field", "button"]) expect(sql).toContain(`'${kind}'`);
  });
});

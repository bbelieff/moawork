import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../../../supabase/migrations/037_automation_cond.sql", import.meta.url), "utf8");

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

  it("does not cross into GT09 execution or history ownership", () => {
    expect(sql).not.toContain("board_automation_evaluations");
    expect(sql).not.toContain("record_board_automation_evaluation");
    expect(sql).not.toContain("service_role");
  });
});

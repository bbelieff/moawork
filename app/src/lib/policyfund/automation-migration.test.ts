import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("../../../../supabase/migrations/042_automation_conditions.sql", import.meta.url),
  "utf8",
);

describe("BBE-104 automation rule migration contract", () => {
  it("stores stable trigger IDs and flat AND conditions", () => {
    expect(sql).toContain("trigger_label_id text");
    expect(sql).toContain("conditions jsonb not null default '[]'::jsonb");
    expect(sql).toContain("^label:[A-Za-z0-9_-]+$");
    expect(sql).toContain("condition->>'operator' not in ('is', 'is_not')");
    expect(sql).not.toContain("'or'");
  });

  it("keeps legacy rows but rejects new or changed trigger fields without a stable ID", () => {
    expect(sql).toContain("tg_op = 'INSERT'");
    expect(sql).toContain("new.status_value is distinct from old.status_value");
    expect(sql).toContain("trigger_label_id is required for new or changed automation triggers");
  });

  it("preserves authenticated validator use while denying public and anon", () => {
    expect(sql).toContain("revoke all on function public.validate_automation_conditions(jsonb) from public, anon");
    expect(sql).toContain("grant execute on function public.validate_automation_conditions(jsonb) to authenticated");
  });

  it("checks board and target-group ownership without adding execution or delivery", () => {
    expect(sql).toContain("automation rule board must belong to its organization");
    expect(sql).toContain("automation rule target group must belong to its board");
    expect(sql).not.toContain("pg_net");
    expect(sql).not.toContain("http_");
    expect(sql).not.toContain("automation_execution");
  });
});

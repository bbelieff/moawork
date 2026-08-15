import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "../supabase/migrations/072_tab_views.sql"), "utf8");

describe("072 tab views persistence contract", () => {
  it("binds saved views to an org and a real board with RLS", () => {
    expect(sql).toMatch(/org_id\s+uuid not null references orgs/);
    expect(sql).toMatch(/board_id\s+uuid not null references boards/);
    expect(sql).toMatch(/alter table tab_views enable row level security/);
    expect(sql).toMatch(/visibility = 'shared' or owner_id = auth\.uid\(\)/);
  });

  it("stores the complete board state and deterministic default/last fallback keys", () => {
    expect(sql).toMatch(/config_jsonb\s+jsonb not null/);
    expect(sql).toMatch(/is_default\s+boolean not null/);
    expect(sql).toMatch(/last_used_at\s+timestamptz/);
    expect(sql).toMatch(/unique index tab_views_one_default_per_user_board/);
  });

  it("exposes mutations only to authenticated users", () => {
    expect(sql).toMatch(/revoke all on table tab_views from public, anon/);
    expect(sql).toMatch(/grant select, insert, update, delete on table tab_views to authenticated/);
    expect(sql).toMatch(/security invoker/);
    expect(sql).toMatch(/revoke all on function set_tab_view_default\(uuid\) from public, anon/);
  });
});

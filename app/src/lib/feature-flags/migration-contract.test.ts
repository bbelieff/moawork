import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = existsSync(resolve(process.cwd(), "supabase"))
  ? process.cwd()
  : resolve(process.cwd(), "..");
const sql = readFileSync(resolve(
  repositoryRoot,
  "supabase/migrations/032_feature_flag_lifecycle.sql",
), "utf8");

describe("032 feature flag lifecycle migration", () => {
  it("keeps writes operator-only and client table access revoked", () => {
    expect(sql).toContain("release_rings_require_operator()");
    expect(sql).toMatch(/revoke all on table public\.feature_flag_registry[\s\S]*authenticated/);
  });

  it("implements an atomic two-ring emergency off with audit", () => {
    expect(sql).toContain("platform_emergency_disable_feature");
    expect(sql).toContain("'feature_emergency_off'");
    expect(sql).toMatch(/set enabled = false[\s\S]*release_ring in \('canary', 'stable'\)/);
  });

  it("enforces ordered rollout and removal debt", () => {
    expect(sql).toContain("feature rollout must pass canary before stable");
    expect(sql).toContain("removal_due_at");
    expect(sql).toContain("list_feature_flag_debt");
    expect(sql).toContain("platform_retire_feature_flag");
    expect(sql).toContain("feature flag must be off before retirement");
  });
});

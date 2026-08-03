import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NewcustLegacyMigrationError, NewcustLegacyMigrationSource } from "./newcustLegacyMigrationSource";

describe("NewcustLegacyMigrationSource", () => {
  it("apply checksum/request를 RPC에 그대로 전달한다", async () => {
    const calls: unknown[] = [];
    const db = { rpc: async (name: string, args: unknown) => { calls.push([name, args]); return { data: { replayed: false }, error: null }; } } as unknown as SupabaseClient;
    await new NewcustLegacyMigrationSource(db).apply("org-a", "request-a", "sha256-a");
    expect(calls).toEqual([["newcust_legacy_apply", { p_org_id: "org-a", p_request_id: "request-a", p_expected_checksum: "sha256-a" }]]);
  });
  it("RPC 오류를 래핑한다", async () => {
    const db = { rpc: async () => ({ data: null, error: { message: "NEWCUST_PREFLIGHT_FAILED", code: "P0001" } }) } as unknown as SupabaseClient;
    await expect(new NewcustLegacyMigrationSource(db).dryRun("org-a")).rejects.toBeInstanceOf(NewcustLegacyMigrationError);
  });
});

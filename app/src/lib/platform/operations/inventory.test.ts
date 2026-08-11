import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PLATFORM_OPERATION_SECTION_KEYS } from "./contracts";
import { PLATFORM_OPERATION_REPOSITORY_INVENTORY } from "./inventory";

const readRepositorySource = (relativePath: string) =>
  readFileSync(new URL(`../../../../../${relativePath}`, import.meta.url), "utf8");

describe("platform operations repository inventory", () => {
  it("binds every section to repository evidence without claiming hosted state", () => {
    expect(Object.keys(PLATFORM_OPERATION_REPOSITORY_INVENTORY)).toEqual([
      ...PLATFORM_OPERATION_SECTION_KEYS,
    ]);
    for (const inventory of Object.values(PLATFORM_OPERATION_REPOSITORY_INVENTORY)) {
      expect(inventory.repositoryVerification).toBe("origin-main-static");
      expect(inventory.hostedVerification).toBe("not-run");
      expect(inventory.artifacts.length).toBeGreaterThan(0);
    }
  });

  it("does not mistake product usage metrics for billing data", () => {
    const billing = PLATFORM_OPERATION_REPOSITORY_INVENTORY.billing;
    expect(billing.currentTabState).toBe("contract-status");
    expect(billing.safeReader).toBeNull();
    expect(
      billing.artifacts.find(
        (item) => item.name === "platform_console_metrics_daily(date,date)",
      ),
    ).toMatchObject({ useForTab: "none" });
  });

  it("keeps audit tables closed and support reads self-scoped", () => {
    const access = PLATFORM_OPERATION_REPOSITORY_INVENTORY.access;
    expect(access.repositoryState).toBe("schema-without-safe-tab-reader");
    expect(access.safeReader).toBeNull();
    expect(access.artifacts.filter((item) => item.kind === "table")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "member_account_ops_audit", useForTab: "none" }),
        expect.objectContaining({ name: "audit_logs", useForTab: "none" }),
      ]),
    );

    const support = PLATFORM_OPERATION_REPOSITORY_INVENTORY.support;
    expect(support.safeReader).toBe("get_my_support_read_scope");
    expect(
      support.artifacts.find((item) => item.name === "get_my_support_read_scope()"),
    ).toMatchObject({ useForTab: "self-scope-only" });

    const migration = readRepositorySource("supabase/migrations/011_member_account_ops.sql");
    expect(migration).toContain("revoke all on table public.member_account_ops_audit");
    expect(migration).toContain("create or replace function public.get_my_support_read_scope()");
  });

  it("uses app_admin_role and never selects the allowlist directly", () => {
    const admins = PLATFORM_OPERATION_REPOSITORY_INVENTORY.admins;
    expect(admins.safeReader).toBe("app_admin_role");
    expect(admins.artifacts.find((item) => item.name === "app_admins")).toMatchObject({
      useForTab: "none",
    });

    const server = readRepositorySource("app/src/lib/platform/operations/server.ts");
    expect(server).toContain('client.rpc("app_admin_role"');
    expect(server).not.toMatch(/\.from\(["']app_admins["']\)/);

    const migration = readRepositorySource("supabase/migrations/005_app_admins.sql");
    expect(migration).toContain("create or replace function public.app_admin_role(p_email text)");
    expect(migration).toContain("alter table app_admins enable row level security");
  });
});

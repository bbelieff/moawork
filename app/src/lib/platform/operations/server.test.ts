import { describe, expect, it, vi } from "vitest";
import {
  loadPlatformOperationSnapshot,
  type PlatformOperationClient,
} from "./server";

function client(
  responses: Partial<Record<"app_admin_role" | "get_my_support_read_scope", unknown>>,
  errors: Partial<Record<"app_admin_role" | "get_my_support_read_scope", unknown>> = {},
) {
  const rpc = vi.fn(async (name: "app_admin_role" | "get_my_support_read_scope") => ({
    data: responses[name] ?? null,
    error: errors[name] ?? null,
  }));
  return {
    value: {
      auth: {
        getUser: async () => ({
          data: { user: { email: "operator@example.test" } },
          error: null,
        }),
      },
      rpc,
    } satisfies PlatformOperationClient,
    rpc,
  };
}

describe("platform operation snapshots", () => {
  const now = new Date("2026-08-11T00:00:00.000Z");

  it("shows honest contract state when billing and access readers do not exist", async () => {
    for (const section of ["billing", "access"] as const) {
      const fixture = client({ app_admin_role: "owner" });
      const result = await loadPlatformOperationSnapshot(section, now, fixture.value);
      expect(result).toMatchObject({
        kind: "limited",
        section,
        observedAt: now.toISOString(),
      });
      expect(JSON.stringify(result)).toContain("아직 연결되지 않음");
      expect(fixture.rpc).toHaveBeenCalledTimes(1);
      expect(fixture.rpc).toHaveBeenCalledWith("app_admin_role", {
        p_email: "operator@example.test",
      });
    }
  });

  it("shows only the current operator role on the admins tab", async () => {
    const fixture = client({ app_admin_role: "admin" });
    const result = await loadPlatformOperationSnapshot("admins", now, fixture.value);
    expect(result).toMatchObject({ kind: "ready", section: "admins" });
    expect(JSON.stringify(result)).toContain("관리자");
    expect(JSON.stringify(result)).toContain("관리자 목록");
    expect(JSON.stringify(result)).not.toContain("operator@example.test");
  });

  it("aggregates only the current operator support scope without tenant details", async () => {
    const fixture = client({
      app_admin_role: "owner",
      get_my_support_read_scope: [
        {
          org_id: "11111111-1111-1111-1111-111111111111",
          purpose: "private purpose",
          expires_at: "2026-08-12T00:00:00.000Z",
        },
        {
          org_id: "22222222-2222-2222-2222-222222222222",
          purpose: "another private purpose",
          expires_at: "2026-08-13T00:00:00.000Z",
        },
      ],
    });
    const result = await loadPlatformOperationSnapshot("support", now, fixture.value);
    const rendered = JSON.stringify(result);
    expect(result).toMatchObject({ kind: "ready", section: "support" });
    expect(rendered).toContain("2건");
    expect(rendered).not.toContain("11111111");
    expect(rendered).not.toContain("private purpose");
  });

  it("fails closed instead of turning malformed or failed reads into zero", async () => {
    const malformed = client({
      app_admin_role: "owner",
      get_my_support_read_scope: [{ expires_at: "not-a-date" }],
    });
    await expect(
      loadPlatformOperationSnapshot("support", now, malformed.value),
    ).resolves.toMatchObject({ kind: "unavailable" });

    const denied = client({}, { app_admin_role: { code: "42501" } });
    await expect(
      loadPlatformOperationSnapshot("admins", now, denied.value),
    ).resolves.toMatchObject({ kind: "unavailable" });
  });

  it.each(["superadmin", "", " owner "])(
    "treats malformed platform role %j as unavailable",
    async (role) => {
      const fixture = client({ app_admin_role: role });
      const result = await loadPlatformOperationSnapshot(
        "admins",
        now,
        fixture.value,
      );

      expect(result).toMatchObject({ kind: "unavailable", section: "admins" });
      expect(JSON.stringify(result)).not.toContain("운영 역할 확인됨");
    },
  );
});

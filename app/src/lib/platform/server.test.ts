import { describe, it, expect, vi } from "vitest";
import {
  getAdminLevel,
  listAdmins,
  listBillingMonthly,
  listMetricsRange,
  listOrgOverview,
  touchLastSeen,
  type PlatformRpcClient,
} from "./server";

/** 호출된 RPC 이름·인자를 기록하는 가짜 클라이언트. */
function fakeClient(
  responses: Record<string, { data?: unknown; error?: unknown }>,
): PlatformRpcClient & { calls: Array<{ fn: string; args?: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  return {
    calls,
    async rpc(fn: string, args?: Record<string, unknown>) {
      calls.push({ fn, args });
      const r = responses[fn] ?? { data: null, error: null };
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
}

describe("getAdminLevel", () => {
  it("SECURITY DEFINER 함수(platform_admin_level)를 호출한다", async () => {
    const client = fakeClient({ platform_admin_level: { data: "super" } });
    expect(await getAdminLevel(client)).toBe("super");
    expect(client.calls[0].fn).toBe("platform_admin_level");
  });

  it("app_admins 테이블을 직접 조회하지 않는다", async () => {
    const client = fakeClient({ platform_admin_level: { data: "viewer" } });
    await getAdminLevel(client);
    expect(client.calls.every((c) => !c.fn.includes("app_admins"))).toBe(true);
  });

  it("에러거나 알 수 없는 값이면 null — 관리자로 오인하지 않는다", async () => {
    expect(await getAdminLevel(fakeClient({ platform_admin_level: { error: new Error("x") } }))).toBeNull();
    expect(await getAdminLevel(fakeClient({ platform_admin_level: { data: "root" } }))).toBeNull();
    expect(await getAdminLevel(fakeClient({}))).toBeNull();
  });
});

describe("listOrgOverview", () => {
  it("RPC 행을 파싱하고 내부 조직 포함 여부를 인자로 넘긴다", async () => {
    const client = fakeClient({
      platform_org_overview: {
        data: [
          {
            org_id: "o1",
            name: "가나상사",
            plan_tier: "t1_3",
            is_internal: false,
            created_at: "2026-01-01T00:00:00.000Z",
            member_count: 5,
            active_users_7d: 2,
            writes_7d: 30,
            errors_7d: 1,
            last_activity_at: "2026-07-28T00:00:00.000Z",
          },
        ],
      },
    });
    const rows = await listOrgOverview(client, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: "o1", name: "가나상사", memberCount: 5 });
    expect(client.calls[0].args).toEqual({ p_include_internal: true });
  });

  it("기본은 내부 조직 제외다", async () => {
    const client = fakeClient({ platform_org_overview: { data: [] } });
    await listOrgOverview(client);
    expect(client.calls[0].args).toEqual({ p_include_internal: false });
  });

  it("numeric 이 문자열로 와도 수치로 읽는다", async () => {
    const client = fakeClient({
      platform_org_overview: {
        data: [{ org_id: "o1", name: "A", member_count: "7", writes_7d: "12" }],
      },
    });
    const rows = await listOrgOverview(client);
    expect(rows[0].memberCount).toBe(7);
    expect(rows[0].writes7d).toBe(12);
  });

  it("에러·비배열이면 빈 배열이다 (화면은 0건 표시)", async () => {
    expect(await listOrgOverview(fakeClient({ platform_org_overview: { error: "boom" } }))).toEqual([]);
    expect(await listOrgOverview(fakeClient({ platform_org_overview: { data: { nope: 1 } } }))).toEqual([]);
  });
});

describe("listMetricsRange", () => {
  it("날짜 구간을 인자로 넘기고 date 는 앞 10자만 쓴다", async () => {
    const client = fakeClient({
      platform_metrics_range: {
        data: [
          {
            date: "2026-07-28T00:00:00.000Z",
            org_id: "o1",
            active_users: 3,
            writes: 10,
            errors: 0,
            member_count: 5,
          },
        ],
      },
    });
    const rows = await listMetricsRange(client, "2026-07-01", "2026-07-29");
    expect(rows[0].date).toBe("2026-07-28");
    expect(client.calls[0].args).toMatchObject({
      p_from: "2026-07-01",
      p_to: "2026-07-29",
    });
  });
});

describe("listAdmins", () => {
  it("등급이 파싱되지 않는 행은 버린다", async () => {
    const client = fakeClient({
      platform_admin_list: {
        data: [
          { email: "operator@example.invalid", level: "super", is_platform: true, created_at: "2026-01-01" },
          { email: "operator@example.invalid", level: "unknown", is_platform: true },
          { level: "viewer", is_platform: true },
        ],
      },
    });
    const rows = await listAdmins(client);
    expect(rows.map((r) => r.email)).toEqual(["operator@example.invalid"]);
  });

  it("회수된 관리자도 감사 목적으로 남긴다", async () => {
    const client = fakeClient({
      platform_admin_list: {
        data: [
          {
            email: "operator@example.invalid",
            level: "operator",
            is_platform: true,
            revoked_at: "2026-07-01T00:00:00.000Z",
            created_at: "2026-01-01",
          },
        ],
      },
    });
    const rows = await listAdmins(client);
    expect(rows[0].revokedAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("listBillingMonthly", () => {
  it("월 수를 인자로 넘기고 numeric 문자열을 수치로 읽는다", async () => {
    const client = fakeClient({
      platform_billing_monthly: {
        data: [
          {
            month: "2026-07-01",
            invoice_count: 2,
            supply_sum: "1000000",
            vat_sum: "100000",
            total_sum: "1100000",
            paid_sum: "600000",
          },
        ],
      },
    });
    const rows = await listBillingMonthly(client, 6);
    expect(rows[0].supplySum).toBe(1_000_000);
    expect(client.calls[0].args).toEqual({ p_months: 6 });
  });
});

describe("touchLastSeen", () => {
  it("RPC 가 던져도 화면을 막지 않는다", async () => {
    const client: PlatformRpcClient = {
      rpc: vi.fn().mockRejectedValue(new Error("network")),
    };
    await expect(touchLastSeen(client)).resolves.toBeUndefined();
  });
});

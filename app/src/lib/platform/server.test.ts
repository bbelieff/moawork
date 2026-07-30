import { describe, expect, it } from "vitest";
import { toMetricsDailyRow, toPlatformAggregate } from "./server";

const row = { day: "2026-07-30", workspace_count: 3, dau: 8, mau: 20, stickiness: 0.4, active_users: 8, dormant_users: 2, new_deals: 5, computed_at: "2026-07-30T01:00:00Z" };

describe("platform aggregate adapter", () => {
  it("accepts aggregate-only RPC rows and rejects malformed metric values", () => {
    expect(toMetricsDailyRow(row)).toMatchObject({ day: "2026-07-30", workspace_count: 3, active_users: 8 });
    expect(toMetricsDailyRow({ ...row, dau: "8" })).toBeNull();
  });
  it("renders only contracted aggregates and never fabricates an empty zero", () => {
    const metrics = toMetricsDailyRow(row)!;
    expect(toPlatformAggregate("analytics", [metrics])).toMatchObject({ kind: "ready" });
    expect(toPlatformAggregate("billing", [metrics])).toMatchObject({ kind: "unavailable" });
    expect(toPlatformAggregate("overview", [])).toMatchObject({ kind: "unavailable" });
  });
});

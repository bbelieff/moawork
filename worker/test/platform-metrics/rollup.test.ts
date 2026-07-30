import { describe, expect, it, vi } from "vitest";
import {
  PLATFORM_METRICS_QUEUE,
  rollupDays,
  runPlatformMetricsRollup,
} from "../../src/platform-metrics/rollup.js";

const NOW = new Date("2026-07-29T18:10:00.000Z"); // 2026-07-30 03:10 KST
const enabled = {
  cronEnabled: "true",
  posthogQueryApiKey: "test-query-key",
  serviceRoleKey: "test-service-key",
  now: () => NOW,
};

describe("platform metrics rollup", () => {
  it("uses KST calendar days and excludes the in-progress KST day", () => {
    expect(PLATFORM_METRICS_QUEUE).toBe("platform.metrics.rollup");
    expect(rollupDays(NOW)).toEqual(["2026-07-29", "2026-07-28", "2026-07-27"]);
    expect(() => rollupDays(NOW, 0)).toThrow(/between 1 and 31/i);
  });

  it.each([
    ["cron disabled", { ...enabled, cronEnabled: "false" }, "cron_disabled"],
    ["Query API absent", { ...enabled, posthogQueryApiKey: "" }, "missing_posthog_query_api"],
    ["service role absent", { ...enabled, serviceRoleKey: "" }, "missing_service_role"],
    ["executor absent", enabled, "missing_executor"],
  ] as const)("fails closed when %s", async (_label, config, reason) => {
    await expect(runPlatformMetricsRollup(config)).resolves.toMatchObject({
      status: "unavailable",
      reason,
      rows: 0,
      days: ["2026-07-29", "2026-07-28", "2026-07-27"],
    });
  });

  it("executes each day once and accepts only matching aggregate receipts", async () => {
    const executeDay = vi.fn(async (day: string) => ({ day, upsertedRows: 1 }));
    const result = await runPlatformMetricsRollup({ ...enabled, executeDay });
    expect(executeDay).toHaveBeenCalledTimes(3);
    expect(executeDay.mock.calls.map(([day]) => day)).toEqual(result.days);
    expect(result).toEqual({
      status: "completed",
      days: ["2026-07-29", "2026-07-28", "2026-07-27"],
      rows: 3,
      failedDays: [],
    });
  });

  it("does not fabricate a successful row for failed or malformed receipts", async () => {
    const executeDay = vi
      .fn()
      .mockResolvedValueOnce({ day: "2026-07-29", upsertedRows: 2 })
      .mockResolvedValueOnce({ day: "wrong-day", upsertedRows: 9 })
      .mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(runPlatformMetricsRollup({ ...enabled, executeDay })).resolves.toEqual({
      status: "completed",
      days: ["2026-07-29", "2026-07-28", "2026-07-27"],
      rows: 2,
      failedDays: ["2026-07-28", "2026-07-27"],
    });
  });
});

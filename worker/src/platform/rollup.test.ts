import { describe, it, expect, vi } from "vitest";
import {
  RECOMPUTE_DAYS,
  createPlatformRollupHandler,
  dateNDaysAgo,
  pendingRollupRunner,
  rollupTargets,
} from "./rollup.js";

const NOW = new Date("2026-07-29T18:10:00.000Z");

describe("dateNDaysAgo / rollupTargets", () => {
  it("n일 전 날짜를 YYYY-MM-DD 로 낸다", () => {
    expect(dateNDaysAgo(1, NOW)).toBe("2026-07-28");
    expect(dateNDaysAgo(3, NOW)).toBe("2026-07-26");
  });

  it("어제부터 과거로 재계산 창을 만든다 — 오늘은 넣지 않는다", () => {
    const targets = rollupTargets(NOW);
    expect(targets).toEqual(["2026-07-28", "2026-07-27", "2026-07-26"]);
    expect(targets).toHaveLength(RECOMPUTE_DAYS);
    expect(targets).not.toContain("2026-07-29");
  });

  it("창 크기를 조정할 수 있다", () => {
    expect(rollupTargets(NOW, 1)).toEqual(["2026-07-28"]);
  });
});

describe("createPlatformRollupHandler", () => {
  it("재계산 창의 모든 날짜를 돌리고 행 수를 합산한다", async () => {
    const runner = vi.fn().mockResolvedValue(5);
    const result = await createPlatformRollupHandler({ runner, now: () => NOW })();

    expect(runner).toHaveBeenCalledTimes(RECOMPUTE_DAYS);
    expect(result.dates).toEqual(["2026-07-28", "2026-07-27", "2026-07-26"]);
    expect(result.rows).toBe(15);
    expect(result.failed).toEqual([]);
  });

  it("하루가 실패해도 나머지 날짜는 계속 진행한다", async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce(4)
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(6);

    const result = await createPlatformRollupHandler({ runner, now: () => NOW })();

    expect(runner).toHaveBeenCalledTimes(3);
    expect(result.rows).toBe(10);
    expect(result.failed).toEqual(["2026-07-27"]);
  });

  it("전부 실패해도 던지지 않는다 — 배치가 죽으면 지표가 통째로 빈다", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await createPlatformRollupHandler({ runner, now: () => NOW })();
    expect(result.rows).toBe(0);
    expect(result.failed).toHaveLength(RECOMPUTE_DAYS);
  });
});

describe("pendingRollupRunner (스텁)", () => {
  it("service_role 미주입 구간에서는 0행을 반환하고 가짜 데이터를 만들지 않는다", async () => {
    await expect(pendingRollupRunner("2026-07-28")).resolves.toBe(0);
  });
});

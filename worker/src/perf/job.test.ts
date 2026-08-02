import { describe, expect, it } from "vitest";
import {
  isPerfMonthlyCloseJobData,
  previousMonthKst,
  processPerfMonthlyCloseJob,
  type PerfMonthlyCloseDeps,
} from "./job.js";
import type { OrgLister, RecomputeRunner, RecomputeTarget } from "./recompute.js";

function orgs(ids: string[]): OrgLister {
  return { async listOrgIds() { return ids; } };
}

/** 호출을 기록하는 러너. `failFor` 에 든 조직은 던진다. */
function recordingRunner(failFor: string[] = []) {
  const calls: Array<{ orgId: string; period: string }> = [];
  const runner: RecomputeRunner = {
    async recompute(target: RecomputeTarget, period: string) {
      calls.push({ orgId: target.orgId, period });
      if (failFor.includes(target.orgId)) {
        throw new Error(`규칙 설정 오류 (${target.orgId})`);
      }
      return { orgId: target.orgId, period, rowCount: 2 };
    },
  };
  return { runner, calls };
}

function deps(over: Partial<PerfMonthlyCloseDeps> = {}): PerfMonthlyCloseDeps {
  return {
    orgs: orgs([]),
    runner: recordingRunner().runner,
    now: () => new Date("2026-08-01T00:00:00.000Z"),
    log: () => {},
    ...over,
  };
}

describe("previousMonthKst", () => {
  it("KST 전월을 돌려준다", () => {
    expect(previousMonthKst(new Date("2026-08-01T00:00:00.000Z"))).toBe("2026-07");
  });

  it("연 경계를 넘긴다", () => {
    expect(previousMonthKst(new Date("2026-01-01T00:00:00.000Z"))).toBe("2025-12");
  });

  it("배치가 도는 새벽 시간대 경계 — UTC 로는 전월 말일이어도 KST 1일이면 전월 확정", () => {
    // 2026-07-31T19:00Z = KST 2026-08-01 04:00 (실제 배치 실행 시각)
    expect(previousMonthKst(new Date("2026-07-31T19:00:00.000Z"))).toBe("2026-07");
  });

  it("KST 로 아직 전월 말일이면 그 전 달", () => {
    // 2026-07-31T14:00Z = KST 2026-07-31 23:00
    expect(previousMonthKst(new Date("2026-07-31T14:00:00.000Z"))).toBe("2026-06");
  });
});

describe("isPerfMonthlyCloseJobData", () => {
  it("빈 페이로드는 정기 실행으로 허용", () => {
    expect(isPerfMonthlyCloseJobData(undefined)).toBe(true);
    expect(isPerfMonthlyCloseJobData(null)).toBe(true);
    expect(isPerfMonthlyCloseJobData({})).toBe(true);
  });

  it("올바른 period 는 허용", () => {
    expect(isPerfMonthlyCloseJobData({ period: "2026-07" })).toBe(true);
  });

  it("형식이 틀린 period 는 거부", () => {
    expect(isPerfMonthlyCloseJobData({ period: "2026-13" })).toBe(false);
    expect(isPerfMonthlyCloseJobData({ period: "2026-7" })).toBe(false);
    expect(isPerfMonthlyCloseJobData({ period: 202607 })).toBe(false);
    expect(isPerfMonthlyCloseJobData("2026-07")).toBe(false);
  });
});

describe("processPerfMonthlyCloseJob", () => {
  it("페이로드가 비면 실행 시점의 KST 전월을 확정한다", async () => {
    const { runner, calls } = recordingRunner();
    const result = await processPerfMonthlyCloseJob(
      deps({ orgs: orgs(["o1", "o2"]), runner }),
      undefined,
    );

    expect(result).toEqual({ status: "done", period: "2026-07", orgCount: 2, failed: [] });
    expect(calls).toEqual([
      { orgId: "o1", period: "2026-07" },
      { orgId: "o2", period: "2026-07" },
    ]);
  });

  it("period 를 주면 그 달을 백필한다", async () => {
    const { runner, calls } = recordingRunner();
    const result = await processPerfMonthlyCloseJob(
      deps({ orgs: orgs(["o1"]), runner }),
      { period: "2026-03" },
    );

    expect(result).toEqual({ status: "done", period: "2026-03", orgCount: 1, failed: [] });
    expect(calls[0].period).toBe("2026-03");
  });

  it("대상 조직이 없으면 아무것도 하지 않고 완료", async () => {
    const { runner, calls } = recordingRunner();
    const result = await processPerfMonthlyCloseJob(deps({ orgs: orgs([]), runner }), {});
    expect(result).toEqual({ status: "done", period: "2026-07", orgCount: 0, failed: [] });
    expect(calls).toEqual([]);
  });

  it("깨진 페이로드는 재시도 없이 invalid 로 종결", async () => {
    const { runner, calls } = recordingRunner();
    const result = await processPerfMonthlyCloseJob(
      deps({ orgs: orgs(["o1"]), runner }),
      { period: "2026-99" },
    );
    expect(result.status).toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("한 조직이 실패해도 나머지는 계속 처리한다", async () => {
    const { runner, calls } = recordingRunner(["o2"]);
    await expect(
      processPerfMonthlyCloseJob(deps({ orgs: orgs(["o1", "o2", "o3"]), runner }), {}),
    ).rejects.toThrow(/일부 실패/);

    // o2 에서 멈추지 않고 o3 까지 시도했다.
    expect(calls.map((c) => c.orgId)).toEqual(["o1", "o2", "o3"]);
  });

  it("전부 성공하면 던지지 않는다", async () => {
    const { runner } = recordingRunner();
    await expect(
      processPerfMonthlyCloseJob(deps({ orgs: orgs(["o1", "o2"]), runner }), {}),
    ).resolves.toMatchObject({ status: "done", failed: [] });
  });
});

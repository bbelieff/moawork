import { describe, expect, it } from "vitest";
import {
  buildCoverage,
  resolveFreshness,
  toMetricsDailyRow,
  toPlatformAggregate,
  unavailableReasonFromRpcError,
  PLATFORM_METRICS_STALE_AFTER_HOURS,
  type PlatformAggregateOptions,
} from "./server";
import type { PlatformMetricsDailyRow } from "./contracts";

const row = { day: "2026-07-30", workspace_count: 3, dau: 8, mau: 20, stickiness: 0.4, active_users: 8, dormant_users: 2, new_deals: 5, computed_at: "2026-07-30T01:00:00Z" };

const ASOF = new Date("2026-07-30T03:00:00Z");

function options(overrides: Partial<PlatformAggregateOptions> = {}): PlatformAggregateOptions {
  return { asOf: ASOF, requestedDays: 30, receivedRows: 1, ...overrides };
}

function metrics(overrides: Partial<PlatformMetricsDailyRow> = {}): PlatformMetricsDailyRow {
  return { ...toMetricsDailyRow(row)!, ...overrides };
}

describe("platform aggregate adapter", () => {
  it("accepts aggregate-only RPC rows and rejects malformed metric values", () => {
    expect(toMetricsDailyRow(row)).toMatchObject({ day: "2026-07-30", workspace_count: 3, active_users: 8 });
    expect(toMetricsDailyRow({ ...row, dau: "8" })).toBeNull();
  });

  it("renders only contracted aggregates and never fabricates an empty zero", () => {
    expect(toPlatformAggregate("analytics", [metrics()], options())).toMatchObject({ kind: "ready" });
    expect(toPlatformAggregate("billing", [metrics()], options())).toMatchObject({ kind: "not-contracted" });
    expect(toPlatformAggregate("overview", [], options({ receivedRows: 0 }))).toMatchObject({ kind: "empty" });
  });
});

describe("상태 구분 — 실제 인프라 상태가 아닌 것을 시스템 상태로 말하지 않는다 (BBE-12)", () => {
  it("집계 행 0건은 empty 다 — 장애(unavailable)로 표기하지 않는다", () => {
    const state = toPlatformAggregate("overview", [], options({ receivedRows: 0 }));
    expect(state.kind).toBe("empty");
    if (state.kind !== "empty") throw new Error("empty expected");
    expect(state.coverage).toMatchObject({ requestedDays: 30, receivedRows: 0, usableRows: 0, partial: false });
    expect(state.message).toContain("값이 0이라는 뜻으로 바꾸어 보여주지 않아요");
  });

  it("행은 왔는데 전부 형식 불일치면 empty 가 아니라 malformed 다", () => {
    // 0건으로 위장하면 "집계가 아직 없다"는 거짓말이 된다.
    const state = toPlatformAggregate("overview", [], options({ receivedRows: 4 }));
    expect(state).toMatchObject({ kind: "unavailable", reason: "malformed" });
  });

  it("일부 행만 쓸 수 있으면 partial 로 남긴다 — 조용히 버리지 않는다", () => {
    const state = toPlatformAggregate("analytics", [metrics()], options({ receivedRows: 30 }));
    if (state.kind !== "ready") throw new Error("ready expected");
    expect(state.coverage).toMatchObject({ receivedRows: 30, usableRows: 1, droppedRows: 29, partial: true });
  });

  it("오래된 스냅샷은 stale 로 표기한다 — 방금 계산된 값처럼 보이지 않게", () => {
    const stale = toPlatformAggregate(
      "overview",
      [metrics({ computed_at: "2026-07-27T01:00:00Z" })],
      options(),
    );
    if (stale.kind !== "ready") throw new Error("ready expected");
    expect(stale.freshness.kind).toBe("stale");
  });

  it("집계 시각을 모르면 신선하다고 단정하지 않는다", () => {
    const state = toPlatformAggregate("overview", [metrics({ computed_at: null })], options());
    if (state.kind !== "ready") throw new Error("ready expected");
    expect(state.freshness).toEqual({ kind: "unknown", computedAt: null });
    // computed_at 이 없으면 기준일로 대신 표기한다(값을 지어내지 않는다).
    expect(state.updatedAt).toBe("2026-07-30");
  });

  it("진짜 0 은 ready + allZero 다 — empty 와 다른 사건이다", () => {
    const zero = toPlatformAggregate(
      "overview",
      [metrics({ workspace_count: 0, active_users: 0, new_deals: 0 })],
      options(),
    );
    if (zero.kind !== "ready") throw new Error("ready expected");
    expect(zero.allZero).toBe(true);
    expect(zero.values.map((v) => v.value)).toEqual(["0", "0", "0"]);
  });

  it("값이 하나라도 0이 아니면 allZero 가 아니다", () => {
    const state = toPlatformAggregate("overview", [metrics({ active_users: 0, new_deals: 0 })], options());
    if (state.kind !== "ready") throw new Error("ready expected");
    expect(state.allZero).toBe(false);
  });

  it("수치가 없는 섹션(system)은 진짜 0 개념을 만들지 않는다", () => {
    const system = toPlatformAggregate("system", [metrics({ workspace_count: 0, dau: 0, mau: 0 })], options());
    if (system.kind !== "ready") throw new Error("ready expected");
    expect(system.allZero).toBe(false);
  });
});

describe("resolveFreshness", () => {
  it("기준 시간 안이면 fresh, 넘기면 stale", () => {
    const at = "2026-07-30T00:00:00Z";
    expect(resolveFreshness(at, new Date("2026-07-30T12:00:00Z")).kind).toBe("fresh");
    expect(resolveFreshness(at, new Date("2026-08-01T12:00:00Z")).kind).toBe("stale");
  });

  it("경계값(기준 시간 정각)은 아직 fresh 다", () => {
    const at = "2026-07-30T00:00:00Z";
    const boundary = new Date(Date.parse(at) + PLATFORM_METRICS_STALE_AFTER_HOURS * 3_600_000);
    expect(resolveFreshness(at, boundary).kind).toBe("fresh");
    expect(resolveFreshness(at, new Date(boundary.getTime() + 3_600_000)).kind).toBe("stale");
  });

  it("없거나 깨진 시각은 unknown — 신선하다고 단정하지 않는다", () => {
    expect(resolveFreshness(null, ASOF)).toEqual({ kind: "unknown", computedAt: null });
    expect(resolveFreshness("쓰레기값", ASOF)).toEqual({ kind: "unknown", computedAt: null });
  });

  it("미래 시각이어도 음수 경과를 만들지 않는다", () => {
    const future = resolveFreshness("2026-08-30T00:00:00Z", ASOF);
    if (future.kind === "unknown") throw new Error("known expected");
    expect(future.ageHours).toBe(0);
  });
});

describe("buildCoverage", () => {
  it("드롭된 행 수를 계산하고 partial 을 세운다", () => {
    expect(buildCoverage(30, 30, 30)).toMatchObject({ droppedRows: 0, partial: false });
    expect(buildCoverage(30, 30, 12)).toMatchObject({ droppedRows: 18, partial: true });
  });

  it("음수 드롭을 만들지 않는다", () => {
    expect(buildCoverage(30, 3, 5)).toMatchObject({ droppedRows: 0, partial: false });
  });
});

describe("unavailableReasonFromRpcError", () => {
  it("권한 거부·미배포·일시 실패를 섞지 않는다", () => {
    expect(unavailableReasonFromRpcError({ code: "42501" })).toBe("denied");
    expect(unavailableReasonFromRpcError({ code: "42883" })).toBe("not-configured");
    expect(unavailableReasonFromRpcError({ code: "PGRST202" })).toBe("not-configured");
    expect(unavailableReasonFromRpcError({ code: "08006" })).toBe("failed");
    expect(unavailableReasonFromRpcError(null)).toBe("failed");
  });
});

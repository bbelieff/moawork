import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformAggregatePanel } from "./PlatformShell";
import {
  emptyPlatformAggregate,
  notContractedPlatformAggregate,
  unavailablePlatformAggregate,
  type PlatformAggregateCoverage,
  type PlatformAggregateFreshness,
  type PlatformAggregateState,
} from "@/lib/platform/contracts";

const complete: PlatformAggregateCoverage = { requestedDays: 30, receivedRows: 30, usableRows: 30, droppedRows: 0, partial: false };
const fresh: PlatformAggregateFreshness = { kind: "fresh", computedAt: "2026-08-09T01:00:00Z", ageHours: 2, staleAfterHours: 36 };

function ready(overrides: Partial<Extract<PlatformAggregateState, { kind: "ready" }>> = {}): PlatformAggregateState {
  return {
    kind: "ready",
    updatedAt: "2026-08-09T01:00:00Z",
    values: [{ label: "워크스페이스", value: "3", description: "2026-08-09 기준 집계" }],
    freshness: fresh,
    coverage: complete,
    allZero: false,
    ...overrides,
  };
}

function render(state: PlatformAggregateState): string {
  return renderToStaticMarkup(<PlatformAggregatePanel section="overview" state={state} />);
}

describe("PlatformAggregatePanel — 다섯 가지 상태를 다르게 말한다 (BBE-12)", () => {
  it("empty: 스냅샷 없음을 장애나 0으로 말하지 않는다", () => {
    const html = render(emptyPlatformAggregate({ ...complete, receivedRows: 0, usableRows: 0 }));
    expect(html).toContain("집계 스냅샷이 아직 없어요");
    expect(html).toContain("연결은 살아 있고");
    expect(html).not.toContain("불러오지 못했어요");
  });

  it("unavailable: 사유별로 다른 문구를 쓰고, 0이 아님을 명시한다", () => {
    const denied = render(unavailablePlatformAggregate("denied"));
    expect(denied).toContain("불러오지 못했어요");
    expect(denied).toContain("권한이 없어요");
    expect(denied).toContain("0이라는 뜻이 아니에요");

    const notConfigured = render(unavailablePlatformAggregate("not-configured"));
    expect(notConfigured).toContain("아직 준비되지 않았어요");
    expect(notConfigured).not.toContain("권한이 없어요");
  });

  it("not-contracted: 계약 밖 섹션을 장애로 표기하지 않는다", () => {
    const html = render(notContractedPlatformAggregate());
    expect(html).toContain("아직 연결하지 않았어요");
    expect(html).not.toContain("불러오지 못했어요");
  });

  it("stale: 경과 시간을 드러낸다 — 방금 계산된 값처럼 보이지 않게", () => {
    const html = render(ready({ freshness: { kind: "stale", computedAt: "2026-08-05T01:00:00Z", ageHours: 96, staleAfterHours: 36 } }));
    expect(html).toContain("오래된 집계");
    expect(html).toContain("96시간 전 계산");
  });

  it("신선도 미상: 최신이라고 단정하지 않는다", () => {
    const html = render(ready({ freshness: { kind: "unknown", computedAt: null }, updatedAt: null }));
    expect(html).toContain("집계 시각 미상");
    expect(html).toContain("마지막 집계 시각을 확인할 수 없어요");
  });

  it("partial: 버린 행 수를 화면에 남긴다", () => {
    const html = render(ready({ coverage: { requestedDays: 30, receivedRows: 30, usableRows: 12, droppedRows: 18, partial: true } }));
    expect(html).toContain("일부만 표시");
    expect(html).toContain("30행 중 12행 사용");
    expect(html).toContain("18행 제외");
  });

  it("true zero: 집계는 돌았고 값이 진짜 0임을 밝힌다", () => {
    const html = render(ready({ allZero: true, values: [{ label: "워크스페이스", value: "0", description: "2026-08-09 기준 집계" }] }));
    expect(html).toContain("값이 실제로 0이에요");
    expect(html).not.toContain("스냅샷이 아직 없어요");
  });

  it("정상 상태에서는 경고 배지를 붙이지 않는다", () => {
    const html = render(ready());
    expect(html).not.toContain("오래된 집계");
    expect(html).not.toContain("일부만 표시");
    expect(html).not.toContain("값이 실제로 0이에요");
    expect(html).toContain("마지막 집계: 2026-08-09T01:00:00Z");
  });

  it("어떤 상태에서도 개인·고객 원본을 노출하지 않는다", () => {
    for (const state of [ready(), emptyPlatformAggregate(complete), unavailablePlatformAggregate("failed"), notContractedPlatformAggregate()]) {
      expect(render(state)).not.toContain("@");
    }
  });
});

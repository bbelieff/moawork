// useTrack / track 전송 계약.
// SDK 인스턴스를 가짜로 끼워 넣어 "무엇이 실제로 나가는가" 를 검증한다.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setAnalyticsInstance } from "./client";
import { track } from "./useTrack";
import type { PostHog } from "posthog-js";

type Sent = { event: string; properties?: Record<string, unknown> };

let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  setAnalyticsInstance({
    capture: (event: string, properties?: Record<string, unknown>) => {
      sent.push({ event, properties });
    },
  } as unknown as PostHog);
});

afterEach(() => {
  setAnalyticsInstance(null);
});

describe("커스텀 이벤트 전송", () => {
  it("deal_created 를 id 만 담아 보낸다", () => {
    track("deal_created", { deal_id: "d-1", pipeline_id: "p-1", stage_id: "s-1" });

    expect(sent).toHaveLength(1);
    expect(sent[0].event).toBe("deal_created");
    expect(sent[0].properties).toEqual({
      deal_id: "d-1",
      pipeline_id: "p-1",
      stage_id: "s-1",
    });
  });

  it("deal_moved 는 출발·도착 단계 id 를 싣는다", () => {
    track("deal_moved", { deal_id: "d-1", from_stage_id: "s-1", to_stage_id: "s-2" });

    expect(sent[0].properties).toEqual({
      deal_id: "d-1",
      from_stage_id: "s-1",
      to_stage_id: "s-2",
    });
  });

  it("meeting_logged 는 활동 id 와 종류 키만 싣는다", () => {
    track("meeting_logged", { activity_id: "a-1", deal_id: "d-1", kind: "call" });

    expect(sent[0].properties).toEqual({
      activity_id: "a-1",
      deal_id: "d-1",
      kind: "call",
    });
  });

  it("undefined 선택 필드는 페이로드에서 빠진다", () => {
    track("deal_created", { deal_id: "d-1", pipeline_id: undefined, source: undefined });

    expect(sent[0].properties).toEqual({ deal_id: "d-1" });
    expect(Object.keys(sent[0].properties!)).not.toContain("pipeline_id");
  });
});

describe("화이트리스트 방어 — 타입을 우회해도 막힌다", () => {
  it("정의되지 않은 이벤트 이름은 전송되지 않는다", () => {
    // 호출부가 any 로 캐스팅해 우회하는 상황을 재현한다.
    (track as unknown as (e: string, p: object) => void)("deal_deleted", { deal_id: "d-1" });
    (track as unknown as (e: string, p: object) => void)("$survey_shown", {});

    expect(sent).toHaveLength(0);
  });
});

describe("분석 비활성 상태", () => {
  it("인스턴스가 없으면 조용히 무시한다(예외 없음)", () => {
    setAnalyticsInstance(null);
    expect(() => track("deal_created", { deal_id: "d-1" })).not.toThrow();
  });
});

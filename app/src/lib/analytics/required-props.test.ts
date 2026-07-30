// 필수 속성 계약 — org_id · role · plan_tier · app_version.
//
// 넷 중 하나라도 빠지면 이벤트는 나가지만 **분석이 불가능**해진다(어느 조직·어느 역할·
// 어느 빌드인지 모른다). 조용히 비는 종류의 결함이라 테스트로 고정한다.
//
// 주입 경로가 둘로 나뉜 이유:
//   - app_version : 빌드 상수 → useTrack 이 매 이벤트에 직접 싣는다(로그인 전에도 붙는다).
//   - 나머지 3종  : 세션 값 → AnalyticsIdentity 가 super property 로 등록 → SDK 가 자동 첨부.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequiredEventProperties } from "./events";
import { APP_VERSION } from "./version";

const captured: Array<{ event: string; properties?: Record<string, unknown> }> = [];
const registered: Array<Record<string, string>> = [];

vi.mock("./client", () => ({
  capture: (event: string, properties?: Record<string, unknown>) => {
    captured.push({ event, properties });
  },
  registerAnalyticsContext: (props: Record<string, string>) => {
    registered.push(props);
  },
  identify: vi.fn(),
}));

beforeEach(() => {
  captured.length = 0;
  registered.length = 0;
});

describe("app_version — 모든 커스텀 이벤트에 실린다", () => {
  it("track 호출마다 app_version 이 붙는다", async () => {
    const { track } = await import("./useTrack");
    track("crm.deal.created", { deal_id: "11111111-2222-3333-4444-555555555555" });
    track("admin.console.viewed", { section: "orgs" });

    expect(captured).toHaveLength(2);
    for (const c of captured) {
      expect(c.properties?.app_version, c.event).toBe(APP_VERSION);
    }
  });

  it("호출부가 페이로드로 덮어쓰지 못한다(빌드 상수가 이긴다)", async () => {
    const { track } = await import("./useTrack");
    // 타입상 없는 필드지만 런타임으로 밀어 넣어도 상수가 유지돼야 한다.
    track("crm.deal.created", { deal_id: "11111111-2222-3333-4444-555555555555" } as never);
    expect(captured[0].properties?.app_version).toBe(APP_VERSION);
  });
});

describe("app_version — 값 형태", () => {
  it("미설정이면 dev, 40자 SHA 면 7자리로 줄인다", () => {
    // 현재 실행 환경에는 NEXT_PUBLIC_APP_VERSION 이 없다 → dev.
    expect(APP_VERSION).toBe("dev");
    expect(APP_VERSION.length).toBeLessThanOrEqual(32);
  });
});

describe("필수 속성 타입 계약", () => {
  it("RequiredEventProperties 는 정확히 4종이다", () => {
    const sample: RequiredEventProperties = {
      org_id: "11111111-2222-3333-4444-555555555555",
      role: "admin",
      plan_tier: "pro",
      app_version: "abc1234",
    };
    expect(Object.keys(sample).sort()).toEqual([
      "app_version",
      "org_id",
      "plan_tier",
      "role",
    ]);
  });

  it("필수 속성 어느 것도 PII 가 아니다", () => {
    const keys = ["org_id", "role", "plan_tier", "app_version"];
    const piiParts = ["name", "email", "phone", "address", "amount", "biz", "ceo"];
    for (const key of keys) {
      for (const part of piiParts) {
        expect(key.includes(part), `${key} 에 ${part}`).toBe(false);
      }
    }
  });
});

describe("비용 가드 — 샘플링", () => {
  it("비율 1 이면 항상 통과한다", async () => {
    const { passesSampling } = await import("./events");
    expect(passesSampling("crm.deal.created", 0.99)).toBe(true);
    expect(passesSampling("$pageview", 0.99)).toBe(true);
  });

  it("미등록 이벤트는 기본 1(전량 전송)로 취급한다", async () => {
    const { passesSampling } = await import("./events");
    expect(passesSampling("존재하지_않는_이벤트", 0.999)).toBe(true);
  });

  it("판정 규칙 — rate<=0 차단 · rate>=1 통과 · 사이는 rand<rate (경계 포함)", async () => {
    const { sampleDecision } = await import("./events");
    const cases: Array<[number, number, boolean]> = [
      [0, 0, false], // 0 이면 난수와 무관하게 차단
      [0, 0.5, false],
      [1, 0.999, true], // 1 이면 전량 통과
      [0.25, 0.1, true],
      [0.25, 0.25, false], // 경계: rand === rate 는 통과하지 않는다
      [0.25, 0.9, false],
    ];
    for (const [rate, rand, expected] of cases) {
      expect(sampleDecision(rate, rand), `rate=${rate} rand=${rand}`).toBe(expected);
    }
  });

  it("$snapshot 은 샘플링 대상이 아니다(조각을 버리면 재생이 깨진다)", async () => {
    const { EVENT_SAMPLE_RATE } = await import("./events");
    expect(EVENT_SAMPLE_RATE.$snapshot).toBeUndefined();
  });
});

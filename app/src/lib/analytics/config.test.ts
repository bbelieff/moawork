import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_PROXY_PATH,
  DEFAULT_POSTHOG_HOST,
  REPLAY_BLOCK_SELECTOR,
  applyReplayPathPolicy,
  buildIdentifyProperties,
  buildPostHogOptions,
  buildSessionRecordingConfig,
  resolveAnalyticsConfig,
  type AnalyticsConfig,
} from "./config";

// 테스트용 합성 키. 실제 프로젝트 키가 아니며 형태만 규격을 만족한다.
const FAKE_KEY = "phc_testtesttesttesttesttest0001";

function config(overrides: Partial<AnalyticsConfig> = {}): AnalyticsConfig {
  return {
    projectKey: FAKE_KEY,
    apiHost: ANALYTICS_PROXY_PATH,
    uiHost: DEFAULT_POSTHOG_HOST,
    ...overrides,
  };
}

describe("resolveAnalyticsConfig — fail-closed", () => {
  it("키가 없으면 비활성이다", () => {
    expect(resolveAnalyticsConfig({})).toBeNull();
    expect(resolveAnalyticsConfig({ key: "" })).toBeNull();
    expect(resolveAnalyticsConfig({ key: "   " })).toBeNull();
  });

  it.each([
    ["접두사 없음", "testtesttesttesttesttest"],
    ["너무 짧음", "phc_short"],
    ["개인 API 키 형태", "phx_testtesttesttesttesttest"],
    ["잘못된 문자", "phc_test-test-test-test-test0001"],
  ])("형태가 어긋난 키(%s)는 비활성이다", (_label, key) => {
    expect(resolveAnalyticsConfig({ key })).toBeNull();
  });

  it("형태가 맞으면 프록시 경로로 보내도록 설정한다", () => {
    const resolved = resolveAnalyticsConfig({ key: FAKE_KEY });
    expect(resolved).toEqual({
      projectKey: FAKE_KEY,
      apiHost: ANALYTICS_PROXY_PATH,
      uiHost: DEFAULT_POSTHOG_HOST,
    });
  });

  it("host 입력 표면이 없고 US 리전으로 고정된다", () => {
    expect(resolveAnalyticsConfig({ key: FAKE_KEY })?.uiHost).toBe(DEFAULT_POSTHOG_HOST);
  });
});

describe("buildSessionRecordingConfig — 리플레이 마스킹", () => {
  const recording = buildSessionRecordingConfig();

  it("입력과 텍스트를 전부 가린다", () => {
    expect(recording?.maskAllInputs).toBe(true);
    expect(recording?.maskTextSelector).toBe("*");
  });

  it("제외 영역 selector 를 노출한다", () => {
    expect(recording?.blockSelector).toBe(REPLAY_BLOCK_SELECTOR);
  });

  it("maskTextFn 은 새어 나온 텍스트의 PII 도 지운다", () => {
    expect(recording?.maskTextFn?.("연락 010-1234-5678")).toBe("연락 [redacted:phone]");
  });

  it("maskInputFn 은 원문 길이도 흘리지 않도록 상한을 둔다", () => {
    expect(recording?.maskInputFn?.("abc")).toBe("***");
    expect(recording?.maskInputFn?.("x".repeat(500))).toBe("*".repeat(32));
  });

  it("폰트·교차출처 iframe 은 수집하지 않는다", () => {
    expect(recording?.collectFonts).toBe(false);
    expect(recording?.recordCrossOriginIframes).toBe(false);
  });

  it("초기화 시 리플레이를 기본 비활성화한다", () => {
    expect(buildPostHogOptions(config()).disable_session_recording).toBe(true);
  });
});

describe("applyReplayPathPolicy", () => {
  it("지연된 SDK 준비 뒤에도 제외 초기 경로에서 녹화를 시작하지 않는다", async () => {
    const client = {
      startSessionRecording: vi.fn(),
      stopSessionRecording: vi.fn(),
    };

    await Promise.resolve(client).then((readyClient) =>
      applyReplayPathPolicy(readyClient, config(), "/settings/account"),
    );

    expect(client.startSessionRecording).not.toHaveBeenCalled();
    expect(client.stopSessionRecording).toHaveBeenCalledTimes(1);
  });
});

describe("buildPostHogOptions", () => {
  const options = buildPostHogOptions(config());

  it("전송은 항상 자기 도메인 프록시로 간다", () => {
    expect(options.api_host).toBe("/ingest");
    expect(options.ui_host).toBe(DEFAULT_POSTHOG_HOST);
  });

  it("최소 이벤트 원칙으로 자동수집과 pageleave를 끈다", () => {
    expect(options.autocapture).toBe(false);
    expect(options.capture_pageleave).toBe(false);
    expect(options.mask_all_text).toBe(true);
    expect(options.mask_all_element_attributes).toBe(true);
  });

  it("페이지뷰는 SDK 가 아니라 App Router 쪽에서 보낸다", () => {
    expect(options.capture_pageview).toBe(false);
  });

  it("익명 프로필을 만들지 않고 DNT 를 존중한다", () => {
    expect(options.person_profiles).toBe("identified_only");
    expect(options.respect_dnt).toBe(true);
  });

  it("before_send 가 전송 직전 스크러빙을 건다", () => {
    const send = options.before_send;
    expect(typeof send).toBe("function");
    const scrubbed = (send as (e: unknown) => { properties: Record<string, unknown> } | null)({
      uuid: "u-1",
      event: "login_result",
      properties: { email: "a@example.invalid", outcome: "failure" },
    });
    expect(scrubbed?.properties).toEqual({ email: "[redacted]", outcome: "failure" });
  });

  it("before_send 는 null 이벤트를 그대로 흘린다", () => {
    const send = options.before_send as (e: unknown) => unknown;
    expect(send(null)).toBeNull();
  });
});

describe("buildIdentifyProperties", () => {
  it("조직·역할·범위만 보낸다", () => {
    expect(
      buildIdentifyProperties({ orgId: "org-1", role: "admin", scope: "assigned" }),
    ).toEqual({ org_id: "org-1", role: "admin", scope: "assigned" });
  });

  it("빈 값은 키 자체를 만들지 않는다", () => {
    expect(buildIdentifyProperties({ orgId: null, role: undefined, scope: "" })).toEqual({});
  });
});

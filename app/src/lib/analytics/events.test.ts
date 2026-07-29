// 수용기준 검증 (C5 · P2)
//  1. 이벤트 10종 화이트리스트 외 발송 0
//  2. 커스텀 이벤트 페이로드에 PII 필드 부재
//  3. 리플레이 마스킹(maskAllInputs · data-pii · 회계/홈택스 경로 녹화 제외)

import { describe, it, expect } from "vitest";
import {
  ALLOWED_EVENTS,
  CUSTOM_EVENTS,
  SDK_EVENTS,
  isAllowedEvent,
  type AnalyticsEventPayloads,
} from "./events";
import {
  REPLAY_BLOCK_SELECTOR,
  REPLAY_EXCLUDED_PATH_PREFIXES,
  buildSessionRecordingConfig,
  gateAndScrub,
  isReplayExcludedPath,
} from "./config";
import { REDACTED } from "./scrub";

// ── 1. 화이트리스트 ────────────────────────────────────────

describe("이벤트 화이트리스트 — 10종", () => {
  it("정확히 10종이고 중복이 없다", () => {
    expect(ALLOWED_EVENTS).toHaveLength(10);
    expect(new Set(ALLOWED_EVENTS).size).toBe(10);
  });

  it("커스텀 3종 + SDK 7종으로 구성된다", () => {
    expect(CUSTOM_EVENTS).toEqual(["deal_created", "deal_moved", "meeting_logged"]);
    expect(SDK_EVENTS).toHaveLength(7);
  });

  it("허용 이벤트는 전부 통과한다", () => {
    for (const name of ALLOWED_EVENTS) {
      expect(isAllowedEvent(name), name).toBe(true);
      expect(gateAndScrub({ event: name }), name).not.toBeNull();
    }
  });
});

describe("화이트리스트 외 발송 0", () => {
  const rejected = [
    "deal_deleted", // 정의되지 않은 커스텀
    "$survey_shown", // disable_surveys:true 라 나오면 안 됨
    "$survey_sent",
    "$feature_flag_called",
    "$exception",
    "$web_vitals",
    "$groupidentify",
    "custom_untracked",
    "DEAL_CREATED", // 대소문자 변형
    " deal_created", // 공백 변형
    "deal_created ",
    "",
  ];

  it.each(rejected)("%o 는 버려진다(null)", (name) => {
    expect(isAllowedEvent(name)).toBe(false);
    expect(gateAndScrub({ event: name })).toBeNull();
  });

  it("목록 외 이벤트는 프로퍼티가 있어도 통째로 버려진다", () => {
    const out = gateAndScrub({
      event: "shadow_event",
      properties: { deal_id: "d1", note: "고객 김철수 010-1234-5678" },
    });
    expect(out).toBeNull();
  });

  it("null 입력은 null (체인 규약)", () => {
    expect(gateAndScrub(null)).toBeNull();
  });
});

// ── 2. PII 부재 ────────────────────────────────────────────

/** 페이로드에 절대 나타나면 안 되는 키 조각. */
const PII_KEY_PARTS = [
  "name",
  "company",
  "title",
  "phone",
  "tel",
  "mobile",
  "email",
  "memo",
  "note",
  "comment",
  "address",
  "birth",
  "ssn",
  "resident",
  "card",
  "account_no",
  "amount",
];

describe("커스텀 이벤트 페이로드 — PII 필드 부재", () => {
  // 타입에 정의된 필드 전부를 채운 대표 페이로드.
  const samples: { [E in keyof AnalyticsEventPayloads]: AnalyticsEventPayloads[E] } = {
    deal_created: {
      deal_id: "d-1",
      pipeline_id: "p-1",
      stage_id: "s-1",
      source: "board",
    },
    deal_moved: { deal_id: "d-1", from_stage_id: "s-1", to_stage_id: "s-2" },
    meeting_logged: { activity_id: "a-1", deal_id: "d-1", kind: "call" },
  };

  it("모든 커스텀 이벤트가 샘플을 갖는다(누락 방지)", () => {
    expect(Object.keys(samples).sort()).toEqual([...CUSTOM_EVENTS].sort());
  });

  it.each(Object.entries(samples))("%s 의 키에 PII 조각이 없다", (_event, payload) => {
    for (const key of Object.keys(payload)) {
      const k = key.toLowerCase();
      for (const part of PII_KEY_PARTS) {
        expect(k.includes(part), `${key} 에 '${part}' 포함`).toBe(false);
      }
    }
  });

  it.each(Object.entries(samples))("%s 의 값은 id·enum 스칼라뿐이다", (_event, payload) => {
    for (const value of Object.values(payload)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
      // 자유 텍스트가 들어오는 것을 막기 위한 길이 상한(uuid 36자 여유).
      if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(64);
    }
  });

  it("허용 이벤트라도 PII 가 섞이면 스크러빙된다(2차 방어선)", () => {
    const out = gateAndScrub({
      event: "deal_created",
      properties: {
        deal_id: "d-1",
        customer_name: "김철수",
        phone: "010-1234-5678",
        email: "a@b.com",
      },
    });
    expect(out).not.toBeNull();
    expect(out?.properties?.deal_id).toBe("d-1"); // id 는 보존
    expect(out?.properties?.customer_name).toBe(REDACTED);
    expect(out?.properties?.phone).toBe(REDACTED);
    expect(out?.properties?.email).toBe(REDACTED);
  });
});

// ── 3. 리플레이 마스킹 ─────────────────────────────────────

describe("세션 리플레이 마스킹", () => {
  const cfg = buildSessionRecordingConfig();

  it("maskAllInputs 가 켜져 있다", () => {
    expect(cfg?.maskAllInputs).toBe(true);
  });

  it("텍스트를 전면 마스킹한다", () => {
    expect(cfg?.maskTextSelector).toBe("*");
  });

  it("data-pii 요소는 녹화에서 제외된다", () => {
    expect(REPLAY_BLOCK_SELECTOR).toContain("[data-pii]");
    expect(cfg?.blockSelector).toContain("[data-pii]");
  });

  it("입력값은 원문 길이·내용을 남기지 않는다", () => {
    const masked = cfg?.maskInputFn?.("010-1234-5678", undefined);
    expect(masked).toMatch(/^\*+$/);
  });

  it("마스킹을 빠져나온 텍스트도 값 패턴이 지워진다(이중 방어)", () => {
    const out = cfg?.maskTextFn?.("연락처 010-1234-5678", undefined);
    expect(out).not.toContain("010-1234-5678");
  });

  it("폰트·교차출처 iframe 은 수집하지 않는다", () => {
    expect(cfg?.collectFonts).toBe(false);
    expect(cfg?.recordCrossOriginIframes).toBe(false);
  });
});

describe("홈택스·정산·개인정보 경로 녹화 제외", () => {
  // 경로 실측(2026-07-23): 회계 전용 화면은 아직 없다. `/account` 는 회계가 아니라
  // "내 정보"(→ /settings/account 리다이렉트)이며, 개인정보가 있어 같은 이유로 제외한다.
  it("홈택스·정산·내 정보가 목록에 있다", () => {
    expect(REPLAY_EXCLUDED_PATH_PREFIXES).toContain("/hometax");
    expect(REPLAY_EXCLUDED_PATH_PREFIXES).toContain("/settlements");
    expect(REPLAY_EXCLUDED_PATH_PREFIXES).toContain("/account");
    expect(REPLAY_EXCLUDED_PATH_PREFIXES).toContain("/settings/account");
  });

  it.each([
    "/account",
    "/account/",
    "/settings/account",
    "/settings/account/privacy",
    "/settings/account/sessions",
    "/hometax",
    "/hometax/invoices/123",
    "/settlements/9",
    "/account?tab=1",
    "/account#top",
  ])("%s 는 녹화 제외", (path) => {
    expect(isReplayExcludedPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/boards",
    "/work",
    "/accounts", // 접두사만 같고 경계가 다른 경로는 제외 대상이 아니다
    "/account-settings",
    "/policyfund",
    "/settings/members", // 같은 settings 아래여도 개인정보 화면이 아니면 녹화한다
  ])("%s 는 정상 녹화", (path) => {
    expect(isReplayExcludedPath(path)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  REDACTED,
  isSensitiveKey,
  scrubEvent,
  scrubProperties,
  scrubText,
  scrubUrl,
  scrubValue,
} from "./scrub";

// 테스트 fixture 의 이메일/도메인은 실제 값이 아니다.
// RFC 6761 예약 도메인(.invalid / example.com)과 합성 번호만 쓴다.

describe("scrubText — 값 패턴", () => {
  it("이메일을 지운다", () => {
    expect(scrubText("문의: member@example.invalid 로 연락")).toBe(
      "문의: [redacted:email] 로 연락",
    );
  });

  it("주민등록번호를 지운다(구분자 유무 무관)", () => {
    expect(scrubText("900101-1234567")).toBe("[redacted:rrn]");
    expect(scrubText("주민 900101 - 1234567 확인")).toBe("주민 [redacted:rrn] 확인");
  });

  it("사업자등록번호를 지운다", () => {
    expect(scrubText("사업자 123-45-67890")).toBe("사업자 [redacted:brn]");
  });

  it("카드번호를 지운다", () => {
    expect(scrubText("4111-1111-1111-1111")).toBe("[redacted:card]");
    expect(scrubText("4111 1111 1111 1111")).toBe("[redacted:card]");
    expect(scrubText("4111111111111111")).toBe("[redacted:card]");
  });

  it("휴대전화와 유선전화를 지운다", () => {
    expect(scrubText("010-1234-5678")).toBe("[redacted:phone]");
    expect(scrubText("01012345678")).toBe("[redacted:phone]");
    expect(scrubText("02-123-4567")).toBe("[redacted:phone]");
    expect(scrubText("031-123-4567")).toBe("[redacted:phone]");
  });

  it("JWT 와 Bearer 토큰을 지운다", () => {
    // 조각을 이어 붙인다. 완성형 JWT 리터럴은 비밀값 스캐너가 실제 토큰으로 오탐한다.
    // (내용은 합성이다 — 헤더 {"alg":"HS256"} · 페이로드 {"sub":"1"} · 서명 "signature")
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "c2lnbmF0dXJl"].join(".");
    expect(scrubText(`token=${jwt}`)).toBe("token=[redacted:token]");
    expect(scrubText("Authorization: Bearer abc.def-ghi")).toBe(
      "Authorization: [redacted:token]",
    );
  });

  it("IPv4 를 지운다", () => {
    expect(scrubText("from 203.0.113.42")).toBe("from [redacted:ip]");
  });

  it("한 문자열에 섞인 여러 종류를 모두 지운다", () => {
    const line = "홍길동 member@example.invalid 010-1234-5678 / 123-45-67890";
    const out = scrubText(line);
    expect(out).toContain("[redacted:email]");
    expect(out).toContain("[redacted:phone]");
    expect(out).toContain("[redacted:brn]");
    expect(out).not.toContain("example.invalid");
  });

  it("업무 데이터(내부 식별자·지표·이벤트명)는 건드리지 않는다", () => {
    const uuid = "3f2a9c1e-4b7d-4f0a-9c2e-8a1b5d6e7f30";
    expect(scrubText(uuid)).toBe(uuid);
    expect(scrubText("deal_stage_changed")).toBe("deal_stage_changed");
    expect(scrubText("정산 합계 1250000원")).toBe("정산 합계 1250000원");
  });

  it("과도하게 긴 문자열은 잘라 표식을 남긴다", () => {
    const out = scrubText("가".repeat(5000));
    expect(out.endsWith("…[truncated]")).toBe(true);
    expect(out.length).toBeLessThan(2100);
  });
});

describe("isSensitiveKey — 키 판정", () => {
  it.each([
    "email",
    "$email",
    "userEmail",
    "phone_number",
    "password",
    "apiKey",
    "authorization",
    "session_id",
    "주민등록번호",
    "고객 연락처",
    "name",
    "customer_name",
    "customer_query",
    "담당자",
  ])("민감 키 %s 를 잡는다", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    "board_name",
    "column_name",
    "event_name",
    "author",
    "stage",
    "deal_id",
    "amount",
    "org_id",
  ])("업무 키 %s 는 통과시킨다", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("scrubUrl", () => {
  it("쿼리 키와 값을 전부 제거한다", () => {
    expect(scrubUrl("https://moa-work.com/boards?tab=all&q=홍길동")).toBe(
      "https://moa-work.com/boards/:board",
    );
  });

  it("utm_* 와 error 도 원문을 남기지 않는다", () => {
    const out = scrubUrl("https://moa-work.com/login?error=routing&utm_source=mail");
    expect(out).toBe("https://moa-work.com/login");
  });

  it("파라미터 형태의 해시는 통째로 버린다(OAuth 토큰 방지)", () => {
    expect(scrubUrl("https://moa-work.com/auth/callback#access_token=abc&type=bearer")).toBe(
      "https://moa-work.com/auth/callback",
    );
  });

  it("앵커 해시도 제거한다", () => {
    expect(scrubUrl("https://moa-work.com/settings/account#workspace")).toBe(
      "https://moa-work.com/settings/account",
    );
  });

  it("경로에 박힌 PII 도 지운다", () => {
    expect(scrubUrl("https://moa-work.com/u/member@example.invalid")).toBe(
      "https://moa-work.com/other",
    );
  });

  it("URL 이 아니면 문자열 스크러빙으로 처리한다", () => {
    expect(scrubUrl("member@example.invalid")).toBe("[redacted:email]");
  });
});

describe("scrubValue — 재귀", () => {
  it("민감 키는 값 종류와 무관하게 통째로 지운다", () => {
    expect(
      scrubValue({ email: "a@example.invalid", password: 12345, phone: ["010-1234-5678"] }),
    ).toEqual({ email: REDACTED, password: REDACTED, phone: REDACTED });
  });

  it("중첩 객체·배열을 따라 내려간다", () => {
    expect(
      scrubValue({
        deal: { id: "d-1", contact: { email: "a@example.invalid", stage: "심사" } },
        notes: ["연락 010-1234-5678", "정상"],
      }),
    ).toEqual({
      deal: { id: "d-1", contact: { email: REDACTED, stage: "심사" } },
      notes: ["연락 [redacted:phone]", "정상"],
    });
  });

  it("깊이 상한을 넘으면 잘라낸다", () => {
    let deep: Record<string, unknown> = { leaf: "end" };
    for (let i = 0; i < 10; i += 1) deep = { nest: deep };
    expect(JSON.stringify(scrubValue(deep))).toContain("depth-limit");
  });

  it("배열 상한을 넘으면 개수 표식을 남긴다", () => {
    const out = scrubValue(Array.from({ length: 130 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(101);
    expect(out[100]).toBe("…[30 more]");
  });

  it("Date 는 ISO 로, 정체불명 객체는 마스킹한다(fail-closed)", () => {
    expect(scrubValue(new Date("2026-07-28T00:00:00.000Z"))).toBe(
      "2026-07-28T00:00:00.000Z",
    );
    expect(scrubValue(new Map([["a", 1]]))).toBe(REDACTED);
    expect(scrubValue(() => null)).toBe(REDACTED);
  });

  it("입력 객체를 변형하지 않는다", () => {
    const input = { email: "a@example.invalid", nested: { note: "010-1234-5678" } };
    scrubValue(input);
    expect(input.email).toBe("a@example.invalid");
    expect(input.nested.note).toBe("010-1234-5678");
  });
});

describe("scrubProperties / scrubEvent", () => {
  it("URL 예약 프로퍼티는 URL 규칙으로 처리한다", () => {
    const out = scrubProperties({
      $current_url: "https://moa-work.com/boards?q=홍길동",
      $referrer: "https://moa-work.com/login#access_token=abc&x=1",
      $pathname: "/w/private-customer-slug",
      $prev_pageview_pathname: "/deals/private-record-id",
    });
    expect(out.$current_url).toBe("https://moa-work.com/boards/:board");
    expect(out.$referrer).toBe("https://moa-work.com/login");
    expect(out.$pathname).toBe("/w/:workspace");
    expect(out.$prev_pageview_pathname).toBe("/deals/:deal");
  });

  it("$snapshot의 href·src·action slug/query/hash와 일반 속성 문자열을 지운다", () => {
    const out = scrubProperties({
      $snapshot: {
        attributes: {
          href: "/w/private-workspace?query=customer#section",
          src: "/w/another-workspace?token=private#asset",
          action: "/w/action-workspace?mode=save#form",
          "aria-label": "member@example.invalid",
          "data-note": "confidential customer name",
        },
      },
    });

    expect(out).toEqual({
      $snapshot: {
        attributes: {
          href: "/w/:workspace",
          src: "/w/:workspace",
          action: "/w/:workspace",
          "aria-label": REDACTED,
          "data-note": REDACTED,
        },
      },
    });
    expect(JSON.stringify(out)).not.toContain("private-workspace");
    expect(JSON.stringify(out)).not.toContain("another-workspace");
    expect(JSON.stringify(out)).not.toContain("member@example.invalid");
  });

  it("빈 입력은 빈 객체를 준다", () => {
    expect(scrubProperties(null)).toEqual({});
    expect(scrubProperties(undefined)).toEqual({});
  });

  it("이벤트의 properties·$set·$set_once 를 모두 통과시킨다", () => {
    const out = scrubEvent({
      event: "crm.deal.created",
      properties: { deal_id: "d-1", customer_name: "홍길동" },
      $set: { email: "a@example.invalid" },
      $set_once: { first_seen_phone: "010-1234-5678" },
    });

    expect(out?.event).toBe("crm.deal.created");
    expect(out?.properties).toEqual({ deal_id: "d-1", customer_name: REDACTED });
    expect(out?.$set).toEqual({ email: REDACTED });
    expect(out?.$set_once).toEqual({ first_seen_phone: REDACTED });
  });

  it("null 이벤트는 null 로 흘려보낸다(체인 규약)", () => {
    expect(scrubEvent(null)).toBeNull();
  });

  it("스크러빙 결과에는 원본 PII 가 남지 않는다", () => {
    const out = scrubEvent({
      event: "$exception",
      properties: {
        $exception_message: "저장 실패: member@example.invalid / 010-1234-5678",
        $current_url: "https://moa-work.com/newcust?email=member@example.invalid",
      },
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("member@example.invalid");
    expect(serialized).not.toContain("010-1234-5678");
  });
});

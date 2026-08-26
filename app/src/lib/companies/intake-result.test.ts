import { describe, expect, it } from "vitest";
import { describeIntakeFailure, EMPTY_INTAKE_RESULT } from "./intake-result";

/**
 * 검수가 지적한 실패 넷을 «각각 다른 말» 로 돌려주는지 본다.
 * 하나로 뭉치면 넷 다 같은 막다른 길이 된다 — 사용자가 다음에 무엇을 할지 정할 수 없다.
 */
describe("업체 추가 실패를 사람 말로 옮긴다", () => {
  it("파이프라인이 없으면 «먼저 설치하라» 고 말한다 — 첫 사용 경로다", () => {
    const message = describeIntakeFailure(new Error("deal pipeline unavailable"));
    expect(message).toContain("진행 단계");
    expect(message).toContain("온보딩");
  });

  it("권한이 없으면 «어디서 받는지» 를 말한다", () => {
    const message = describeIntakeFailure(new Error("company work start permission denied"));
    expect(message).toContain("권한");
    expect(message).toContain("조직관리");
  });

  it("회사를 쓸 수 없으면 «합쳐졌거나 범위 밖» 임을 말한다", () => {
    expect(describeIntakeFailure(new Error("company unavailable"))).toContain("합쳐졌");
  });

  it("멱등 열쇠가 겹치면 «한 번만 누르라» 고 말한다", () => {
    expect(describeIntakeFailure(new Error("company work start idempotency key reuse")))
      .toContain("한 번만");
  });

  it("모르는 실패도 «막다른 길» 로 두지 않는다 — 다음 행동을 준다", () => {
    const message = describeIntakeFailure(new Error("connection reset by peer"));
    expect(message).toContain("다시 시도");
    // 저장소 원문을 화면에 흘리지 않는다 — 제약 이름·스키마가 새면 안 된다.
    expect(message).not.toContain("connection reset");
  });

  it("Error 가 아닌 것도 삼키지 않는다", () => {
    expect(describeIntakeFailure(null)).not.toBe("");
    expect(describeIntakeFailure(undefined)).not.toBe("");
  });

  it("처음 상태는 오류가 없다", () => {
    expect(EMPTY_INTAKE_RESULT.error).toBeNull();
  });

  it("실패 네 종류가 서로 다른 말이다 — 뭉치면 처방을 못 고른다", () => {
    const messages = [
      "deal pipeline unavailable",
      "company work start permission denied",
      "company unavailable",
      "company work start idempotency key reuse",
    ].map((raw) => describeIntakeFailure(new Error(raw)));
    expect(new Set(messages).size).toBe(4);
  });
});

import { describe, expect, it } from "vitest";
import { buildContactHandoffConditions } from "./contact-handoff";
import { evaluateLockGate } from "./evaluate";

describe("buildContactHandoffConditions — D36", () => {
  it("직인 완료 = 완료면 조건을 충족한다", () => {
    const [condition] = buildContactHandoffConditions({
      sealApprovalStatus: "완료",
    });
    expect(condition.satisfied).toBe(true);
    expect(condition.currentValueLabel).toBe("완료");
  });

  it("직인 완료 = 대기면 미충족이고 현재값을 그대로 보여준다", () => {
    const [condition] = buildContactHandoffConditions({
      sealApprovalStatus: "대기",
    });
    expect(condition.satisfied).toBe(false);
    expect(condition.label).toBe("대표 직인 승인");
    expect(condition.currentValueLabel).toBe("대기");
  });

  it("값이 비어 있으면 «미입력»으로 표시한다", () => {
    const [condition] = buildContactHandoffConditions({
      sealApprovalStatus: null,
    });
    expect(condition.satisfied).toBe(false);
    expect(condition.currentValueLabel).toBe("미입력");
  });
});

describe("리드컨택 → 업무관리 이관 — 목업 시나리오 대조", () => {
  it("직인 승인 전: 착수 시도가 막히고 사유가 뜬다(qa-mockup «이중잠금 차단»과 동일 조건)", () => {
    const conditions = buildContactHandoffConditions({ sealApprovalStatus: "대기" });
    const result = evaluateLockGate({ enabled: true, conditions });
    expect(result.passed).toBe(false);
    expect(result.unmet).toHaveLength(1);
    expect(result.unmet[0].label).toBe("대표 직인 승인");
  });

  it("직인 승인 후 재시도: 통과한다(qa-mockup «직인 후 통과»와 동일 조건)", () => {
    const conditions = buildContactHandoffConditions({ sealApprovalStatus: "완료" });
    const result = evaluateLockGate({ enabled: true, conditions });
    expect(result.passed).toBe(true);
    expect(result.unmet).toHaveLength(0);
  });

  it("회사가 이중 잠금을 꺼두면 직인 미승인이어도 통과하되 우회로 기록된다(D66)", () => {
    const conditions = buildContactHandoffConditions({ sealApprovalStatus: "대기" });
    const result = evaluateLockGate({ enabled: false, conditions });
    expect(result.passed).toBe(true);
    expect(result.bypassed).toBe(true);
  });
});

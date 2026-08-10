import { describe, expect, it } from "vitest";
import { evaluateLockGate } from "./evaluate";
import type { LockCondition } from "./types";

function condition(over: Partial<LockCondition> = {}): LockCondition {
  return {
    key: "seal_approval",
    label: "대표 직인 승인",
    satisfied: false,
    currentValueLabel: "대기",
    ...over,
  };
}

describe("evaluateLockGate — 스위치 켜짐(D36)", () => {
  it("조건이 전부 충족이면 통과한다", () => {
    const result = evaluateLockGate({
      enabled: true,
      conditions: [condition({ satisfied: true, currentValueLabel: "완료" })],
    });
    expect(result).toEqual({ passed: true, bypassed: false, unmet: [] });
  });

  it("조건 하나라도 미충족이면 막고, 그 조건을 unmet 에 담는다", () => {
    const c = condition({ satisfied: false });
    const result = evaluateLockGate({ enabled: true, conditions: [c] });
    expect(result.passed).toBe(false);
    expect(result.bypassed).toBe(false);
    expect(result.unmet).toEqual([c]);
  });

  it("AND — 조건 2개 중 1개만 미충족이어도 막힌다", () => {
    const ok = condition({ key: "a", satisfied: true });
    const bad = condition({ key: "b", satisfied: false });
    const result = evaluateLockGate({ enabled: true, conditions: [ok, bad] });
    expect(result.passed).toBe(false);
    expect(result.unmet).toEqual([bad]);
  });

  it("미충족 조건이 여럿이면 순서를 보존해 전부 담는다", () => {
    const a = condition({ key: "a", satisfied: false, label: "A" });
    const b = condition({ key: "b", satisfied: false, label: "B" });
    const result = evaluateLockGate({ enabled: true, conditions: [a, b] });
    expect(result.unmet.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("조건이 0개면 통과한다(막을 대상이 없음)", () => {
    expect(evaluateLockGate({ enabled: true, conditions: [] })).toEqual({
      passed: true,
      bypassed: false,
      unmet: [],
    });
  });
});

describe("evaluateLockGate — 스위치 꺼짐(D66 우회 통과)", () => {
  it("조건 미충족이어도 통과하지만 bypassed=true 로 표시한다", () => {
    const result = evaluateLockGate({
      enabled: false,
      conditions: [condition({ satisfied: false })],
    });
    expect(result).toEqual({ passed: true, bypassed: true, unmet: [] });
  });

  it("조건이 원래 다 충족이었으면 bypassed=false 다(우회한 적이 없으므로)", () => {
    const result = evaluateLockGate({
      enabled: false,
      conditions: [condition({ satisfied: true })],
    });
    expect(result).toEqual({ passed: true, bypassed: false, unmet: [] });
  });
});

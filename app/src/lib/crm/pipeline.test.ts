import { describe, it, expect } from "vitest";
import {
  DEFAULT_STAGES,
  COMPLETED_DATE_KEY,
  isKnownStageKey,
  computeStageMoveEffect,
} from "./pipeline";
import { INPUT_KEYS } from "./formulas";

const TODAY = "2026-07-21";

describe("DEFAULT_STAGES", () => {
  it("4단계, position 순서, done 만 종료 단계", () => {
    expect(DEFAULT_STAGES.map((s) => s.key)).toEqual([
      "consulting",
      "awaiting_contract",
      "in_progress",
      "done",
    ]);
    expect(DEFAULT_STAGES.filter((s) => s.isTerminal).map((s) => s.key)).toEqual(["done"]);
  });
});

describe("isKnownStageKey", () => {
  it("기본 키 판별", () => {
    expect(isKnownStageKey("in_progress")).toBe(true);
    expect(isKnownStageKey("nonsense")).toBe(false);
  });
});

describe("computeStageMoveEffect — 진행중 자동화", () => {
  it("계약일이 비어 있으면 오늘로 채운다", () => {
    const effect = computeStageMoveEffect("in_progress", false, {}, TODAY);
    expect(effect.columnPatches[INPUT_KEYS.contractDate]).toBe(TODAY);
    expect(effect.completedAt).toBeUndefined();
  });
  it("계약일이 이미 있으면 건드리지 않는다", () => {
    const effect = computeStageMoveEffect(
      "in_progress",
      false,
      { [INPUT_KEYS.contractDate]: "2026-01-01" },
      TODAY,
    );
    expect(effect.columnPatches[INPUT_KEYS.contractDate]).toBeUndefined();
  });
});

describe("computeStageMoveEffect — 완료 자동화", () => {
  it("완료 진입 시 completed_at 스탬프 + 완료일 세팅", () => {
    const effect = computeStageMoveEffect("done", false, {}, TODAY);
    expect(effect.completedAt).toBe("2026-07-21T00:00:00.000Z");
    expect(effect.columnPatches[COMPLETED_DATE_KEY]).toBe(TODAY);
  });
  it("완료(종료)에서 이탈하면 completed_at 해제", () => {
    const effect = computeStageMoveEffect("in_progress", true, {}, TODAY);
    expect(effect.completedAt).toBeNull();
  });
  it("비종료 → 비종료 이동은 completed_at 변화 없음", () => {
    const effect = computeStageMoveEffect("awaiting_contract", false, {}, TODAY);
    expect(effect.completedAt).toBeUndefined();
    expect(effect.columnPatches).toEqual({});
  });
});

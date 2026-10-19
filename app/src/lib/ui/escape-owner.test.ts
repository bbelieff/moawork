// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { escapeOwnedByOpenList } from "./escape-owner";

function escapeFrom(target: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "Escape" });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("Esc 는 열린 목록이 먼저 쓴다 (2026-10-19)", () => {
  it("추천 목록이 열린 콤보박스에서 누른 Esc 는 바깥 창을 닫지 않는다", () => {
    const input = document.createElement("input");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "true");
    expect(escapeOwnedByOpenList(escapeFrom(input))).toBe(true);
  });
  it("목록이 닫혀 있거나 일반 칸이면 바깥 창이 닫힌다", () => {
    const closed = document.createElement("input");
    closed.setAttribute("role", "combobox");
    closed.setAttribute("aria-expanded", "false");
    expect(escapeOwnedByOpenList(escapeFrom(closed))).toBe(false);
    expect(escapeOwnedByOpenList(escapeFrom(document.createElement("input")))).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { ACTIVITY_TYPES, stageMoveContent } from "./activity";

describe("stageMoveContent", () => {
  it("from 이 있으면 'from → to'", () => {
    expect(stageMoveContent("마케팅", "계약")).toBe("마케팅 → 계약");
  });
  it("from 이 없으면(최초 배치) '→ to'", () => {
    expect(stageMoveContent(null, "마케팅")).toBe("→ 마케팅");
  });
});

describe("ACTIVITY_TYPES", () => {
  it("status/call/meeting/memo 를 포함", () => {
    expect(ACTIVITY_TYPES.status).toBe("status");
    expect(Object.values(ACTIVITY_TYPES)).toEqual(["status", "call", "meeting", "memo"]);
  });
});

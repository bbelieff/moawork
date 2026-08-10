import { describe, it, expect } from "vitest";
import { ACTIVITY_TYPES, assignmentChangeContent, stageMoveContent } from "./activity";

describe("stageMoveContent", () => {
  it("from 이 있으면 'from → to'", () => {
    expect(stageMoveContent("마케팅", "계약")).toBe("마케팅 → 계약");
  });
  it("from 이 없으면(최초 배치) '→ to'", () => {
    expect(stageMoveContent(null, "마케팅")).toBe("→ 마케팅");
  });
});

describe("ACTIVITY_TYPES", () => {
  it("status/call/meeting/memo/assignment 를 포함", () => {
    expect(ACTIVITY_TYPES.status).toBe("status");
    expect(Object.values(ACTIVITY_TYPES)).toEqual([
      "status",
      "call",
      "meeting",
      "memo",
      "assignment",
    ]);
  });
});

describe("assignmentChangeContent (BBE-16)", () => {
  it("양쪽 다 있으면 'from → to'", () => {
    expect(assignmentChangeContent("김철수", "이영희")).toBe("담당자: 김철수 → 이영희");
  });
  it("이전 담당자가 없으면(최초 배정) '미배정 → to'", () => {
    expect(assignmentChangeContent(null, "이영희")).toBe("담당자: 미배정 → 이영희");
  });
  it("새 담당자가 없으면(배정 해제) 'from → 미배정'", () => {
    expect(assignmentChangeContent("김철수", null)).toBe("담당자: 김철수 → 미배정");
  });
});

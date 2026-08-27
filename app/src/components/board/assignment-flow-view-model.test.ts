import { describe, expect, it } from "vitest";
import { formatAssignmentMoment, orderAssignmentHistory } from "./assignment-flow-view-model";

describe("assignment flow view model", () => {
  it("orders immutable history by sequence without mutating its input", () => {
    const input = [
      { id: "later", sequence: 2, member: { id: "b", label: "두번째" } },
      { id: "first", sequence: 1, member: { id: "a", label: "첫번째" } },
    ] as const;
    expect(orderAssignmentHistory(input).map((entry) => entry.id)).toEqual(["first", "later"]);
    expect(input.map((entry) => entry.id)).toEqual(["later", "first"]);
  });

  it("returns no display value for absent or invalid timestamps", () => {
    expect(formatAssignmentMoment(null)).toBeNull();
    expect(formatAssignmentMoment("not-a-date")).toBeNull();
    expect(formatAssignmentMoment("2026-08-27T01:00:00.000Z")).toContain("2026");
  });
});

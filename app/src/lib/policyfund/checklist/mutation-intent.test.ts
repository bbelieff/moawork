import { describe, expect, it } from "vitest";
import {
  beginChecklistMutation,
  failChecklistMutation,
  isTerminalChecklistError,
  settleChecklistMutation,
  type ChecklistMutationIntent,
} from "./mutation-intent";

const first: ChecklistMutationIntent = {
  key: "toggle:a",
  requestId: "request-a",
  expectedVersion: 2,
  previous: { dealId: "case-1", productId: null, items: [], version: 2 },
  next: { dealId: "case-1", productId: null, items: [], version: 2 },
};

const second: ChecklistMutationIntent = {
  key: "product:fund-b",
  requestId: "request-b",
  expectedVersion: 2,
  previous: { dealId: "case-1", productId: null, items: [], version: 2 },
  next: { dealId: "case-1", productId: "fund-b", items: [], version: 2 },
};

describe("checklist mutation intent fence", () => {
  it("rejects overlapping distinct actions and every action while one is pending", () => {
    expect(beginChecklistMutation(first, false, second)).toBeNull();
    expect(beginChecklistMutation(first, true, first)).toBeNull();
  });

  it("does not let an out-of-order result clear or apply over the current intent", () => {
    expect(settleChecklistMutation(second, first.requestId)).toEqual({ applies: false, next: second });
    expect(failChecklistMutation(second, first.requestId, "terminal")).toBe(second);
  });

  it("retains the frozen request and state after transport failure for exact retry", () => {
    const retained = failChecklistMutation(first, first.requestId, "retryable");
    expect(retained).toBe(first);
    expect(beginChecklistMutation(retained, false, { ...first, requestId: "replacement" })).toBe(first);
  });

  it("clears only the matching terminal conflict", () => {
    expect(failChecklistMutation(first, first.requestId, "terminal")).toBeNull();
    expect(settleChecklistMutation(first, first.requestId)).toEqual({ applies: true, next: null });
  });

  it("classifies canonical authorization/schema failures as terminal and transport loss as retryable", () => {
    expect(isTerminalChecklistError("[case/mutate_case_checklist] case unavailable")).toBe(true);
    expect(isTerminalChecklistError("case checklist schema invalid")).toBe(true);
    expect(isTerminalChecklistError("case checklist version conflict")).toBe(true);
    expect(isTerminalChecklistError("connection closed after commit")).toBe(false);
  });
});

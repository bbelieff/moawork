import { describe, expect, it } from "vitest";
import {
  CaseTaskMutationError,
  shouldRetryCaseTaskMutation,
  toCaseTaskMutationError,
} from "./source";

describe("case task mutation outcome", () => {
  it("keeps raw transport and malformed response failures retryable", () => {
    expect(shouldRetryCaseTaskMutation(new Error("response lost"))).toBe(true);
    expect(shouldRetryCaseTaskMutation(new Error("task mutation result unavailable"))).toBe(true);
  });

  it.each(["22023", "40001", "42501"])("treats reviewed code %s as terminal", (code) => {
    const error = Object.assign(new Error("authoritative failure"), {
      cause: { code, message: "authoritative failure" },
    });
    expect(toCaseTaskMutationError(error)).toMatchObject({ outcome: "terminal", code });
    expect(shouldRetryCaseTaskMutation(error)).toBe(false);
  });

  it("preserves an already typed result", () => {
    const error = new CaseTaskMutationError("invalid input", "terminal", "22023");
    expect(toCaseTaskMutationError(error)).toBe(error);
  });
});

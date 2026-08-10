import { describe, expect, it } from "vitest";
import { canMutateField, commandKey, parseWorkCommand } from "./index";

describe("work command contract", () => {
  it("canonicalizes payload keys for replay identity", () => {
    const first = { operation: "save_personal_view" as const, orgId: "o", boardId: "b", expectedVersion: 2, requestId: "00000000-0000-4000-8000-000000000001", payload: { name: "A", kind: "table" as const, shared: false as const, predicate: { due: "2026-08-04", nested: { b: 2, a: 1 } } } };
    const second = { ...first, payload: { ...first.payload, predicate: { nested: { a: 1, b: 2 }, due: "2026-08-04" } } };
    expect(commandKey(first)).toBe(commandKey(second));
  });

  it("enforces the assignee whitelist", () => {
    expect(canMutateField("assignee", "due_date")).toBe(true);
    expect(canMutateField("assignee", "fee_amount")).toBe(false);
    expect(canMutateField("viewer", "title")).toBe(false);
    expect(canMutateField("manager", "fee_amount")).toBe(true);
  });

  it("routes due dates exclusively and blocks gated column kinds", () => {
    const base = { orgId: "o", boardId: "b", expectedVersion: 0, requestId: "00000000-0000-4000-8000-000000000001" };
    expect(() => parseWorkCommand({ ...base, operation: "set_field", itemId: "i", payload: { field: "due_date", value: "2026-08-04" } })).toThrow();
    expect(() => parseWorkCommand({ ...base, operation: "create_column", payload: { name: "Files", kind: "file" } })).toThrow();
  });
});

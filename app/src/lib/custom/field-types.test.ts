import { describe, it, expect } from "vitest";
import type { FieldOption } from "./domain-types";
import {
  getFieldTypeSpec,
  normalizeValue,
  isFieldType,
  operatorAllowed,
  ValidationError,
} from "./field-types";

const opts: FieldOption[] = [
  { id: "opt-a", label: "A", order: 0 },
  { id: "opt-b", label: "B", order: 1 },
  { id: "opt-x", label: "X", order: 2, archived: true },
];

describe("field-types: text/longtext", () => {
  it("trims and returns string; blank → null", () => {
    expect(normalizeValue("text", "  hi ")).toBe("hi");
    expect(normalizeValue("text", "")).toBeNull();
    expect(normalizeValue("text", "   ")).toBeNull();
  });
  it("rejects over-length and non-string", () => {
    expect(() => normalizeValue("text", "a".repeat(501))).toThrow(ValidationError);
    expect(() => normalizeValue("text", 5)).toThrow(ValidationError);
    expect(normalizeValue("longtext", "a".repeat(501))).toBe("a".repeat(501));
  });
});

describe("field-types: number", () => {
  it("coerces numeric strings, rejects NaN", () => {
    expect(normalizeValue("number", "42")).toBe(42);
    expect(normalizeValue("number", 3.5)).toBe(3.5);
    expect(normalizeValue("number", "")).toBeNull();
    expect(() => normalizeValue("number", "abc")).toThrow(ValidationError);
    expect(() => normalizeValue("number", {})).toThrow(ValidationError);
  });
});

describe("field-types: date/datetime", () => {
  it("validates calendar dates", () => {
    expect(normalizeValue("date", "2026-07-21")).toBe("2026-07-21");
    expect(() => normalizeValue("date", "2026-13-01")).toThrow(ValidationError);
    expect(() => normalizeValue("date", "2026-02-30")).toThrow(ValidationError);
    expect(() => normalizeValue("date", "07/21/2026")).toThrow(ValidationError);
  });
  it("normalizes datetime to ISO", () => {
    expect(normalizeValue("datetime", "2026-07-21T00:00:00Z")).toBe("2026-07-21T00:00:00.000Z");
    expect(() => normalizeValue("datetime", "not-a-date")).toThrow(ValidationError);
  });
});

describe("field-types: select/multiselect (option id membership)", () => {
  it("select accepts known non-archived id, rejects unknown/archived", () => {
    expect(normalizeValue("select", "opt-a", { options: opts })).toBe("opt-a");
    expect(() => normalizeValue("select", "opt-x", { options: opts })).toThrow(ValidationError);
    expect(() => normalizeValue("select", "nope", { options: opts })).toThrow(ValidationError);
  });
  it("select without options list is lenient (service supplies options)", () => {
    expect(normalizeValue("select", "whatever")).toBe("whatever");
  });
  it("multiselect dedupes and validates each id", () => {
    expect(normalizeValue("multiselect", ["opt-a", "opt-b", "opt-a"], { options: opts })).toEqual([
      "opt-a",
      "opt-b",
    ]);
    expect(normalizeValue("multiselect", [], { options: opts })).toBeNull();
    expect(() => normalizeValue("multiselect", ["opt-a", "bad"], { options: opts })).toThrow(
      ValidationError,
    );
    expect(() => normalizeValue("multiselect", "opt-a", { options: opts })).toThrow(ValidationError);
  });
});

describe("field-types: phone/email/url", () => {
  it("email lowercases + validates", () => {
    expect(normalizeValue("email", "Foo@Bar.com")).toBe("foo@bar.com");
    expect(() => normalizeValue("email", "nope")).toThrow(ValidationError);
  });
  it("url requires http(s)", () => {
    expect(normalizeValue("url", "https://x.io/a")).toBe("https://x.io/a");
    expect(() => normalizeValue("url", "ftp://x")).toThrow(ValidationError);
  });
  it("phone allows digits/symbols only", () => {
    expect(normalizeValue("phone", "010-1234-5678")).toBe("010-1234-5678");
    expect(() => normalizeValue("phone", "call me")).toThrow(ValidationError);
  });
});

describe("field-types: checkbox/person/file", () => {
  it("checkbox coerces boolean strings", () => {
    expect(normalizeValue("checkbox", true)).toBe(true);
    expect(normalizeValue("checkbox", "false")).toBe(false);
    expect(normalizeValue("checkbox", "")).toBeNull();
    expect(() => normalizeValue("checkbox", "maybe")).toThrow(ValidationError);
  });
  it("person accepts id string or id array", () => {
    expect(normalizeValue("person", "u1")).toBe("u1");
    expect(normalizeValue("person", ["u1", "u2"])).toEqual(["u1", "u2"]);
    expect(normalizeValue("person", "")).toBeNull();
  });
  it("file validates attachment shape", () => {
    expect(normalizeValue("file", [{ path: "p/a.pdf", name: "a.pdf", size: 10, mime: "x" }])).toEqual([
      { path: "p/a.pdf", name: "a.pdf", size: 10, mime: "x" },
    ]);
    expect(() => normalizeValue("file", [{ name: "no-path" }])).toThrow(ValidationError);
    expect(() => normalizeValue("file", "notarray")).toThrow(ValidationError);
  });
});

describe("field-types: isEmpty/comparable/operators", () => {
  it("isEmpty for various", () => {
    expect(getFieldTypeSpec("text").isEmpty(null)).toBe(true);
    expect(getFieldTypeSpec("text").isEmpty("")).toBe(true);
    expect(getFieldTypeSpec("multiselect").isEmpty([])).toBe(true);
    expect(getFieldTypeSpec("number").isEmpty(0)).toBe(false);
  });
  it("comparable projects for sort", () => {
    expect(getFieldTypeSpec("number").comparable(5)).toBe(5);
    expect(getFieldTypeSpec("text").comparable("10")).toBe(10); // numeric string
    expect(getFieldTypeSpec("text").comparable("abc")).toBe("abc");
    expect(getFieldTypeSpec("checkbox").comparable(true)).toBe(1);
  });
  it("operator allow-list is type-aware", () => {
    expect(operatorAllowed("number", "gt")).toBe(true);
    expect(operatorAllowed("select", "gt")).toBe(false);
    expect(operatorAllowed("multiselect", "contains")).toBe(true);
  });
  it("isFieldType guard", () => {
    expect(isFieldType("select")).toBe(true);
    expect(isFieldType("nope")).toBe(false);
    expect(() => getFieldTypeSpec("nope" as never)).toThrow(ValidationError);
  });
});

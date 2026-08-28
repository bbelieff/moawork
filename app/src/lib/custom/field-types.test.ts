import { describe, it, expect } from "vitest";
import type { FieldOption } from "./domain-types";
import {
  getFieldTypeSpec,
  normalizeValue,
  isFieldType,
  operatorAllowed,
  validateValue,
  isIntegrityField,
  ValidationError,
} from "./field-types";
import { emptyOtherInfoValue, updateOtherInfoEntry } from "@/lib/boards/structured-field";

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

describe("field-types: strict other_info", () => {
  it("preserves the exact structured object instead of coercing it to a string", () => {
    const value = updateOtherInfoEntry(emptyOtherInfoValue(), "certifications", {
      checked: true,
      text: "벤처기업",
    });
    expect(normalizeValue("other_info", value)).toEqual(value);
    expect(normalizeValue("other_info", value)).not.toBe("[object Object]");
  });

  it("rejects partial, future, and scalar values", () => {
    const value = emptyOtherInfoValue();
    expect(() => normalizeValue("other_info", { version: 1 })).toThrow(ValidationError);
    expect(() => normalizeValue("other_info", { ...value, future: true })).toThrow(ValidationError);
    expect(() => normalizeValue("other_info", "[object Object]")).toThrow(ValidationError);
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

describe("field-types: validateValue (비-throw 계약)", () => {
  it("성공 시 {ok:true, normalized}", () => {
    expect(validateValue("number", "42")).toEqual({ ok: true, normalized: 42 });
  });
  it("실패해도 던지지 않고 {ok:false, error} 반환", () => {
    const r = validateValue("number", "abc");
    expect(r.ok).toBe(false);
    expect(r.normalized).toBeNull();
    expect(typeof r.error).toBe("string");
  });
  it("옵션 검증 실패도 결과로 반환", () => {
    const r = validateValue("select", "nope", { options: opts });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
  it("무결성 필드 key 집합", () => {
    expect(isIntegrityField("fee_pct")).toBe(true);
    expect(isIntegrityField("exec_amount")).toBe(true);
    expect(isIntegrityField("fee_paid_at")).toBe(true);
    expect(isIntegrityField("memo")).toBe(false);
  });
});

// BBE-123 — 001 enum 밖 신규 4종(status/people/money/calc).
describe("field-types: status (범주와 저장은 같지만 옵션 검증 동일 적용)", () => {
  it("옵션 id 문자열을 받고 빈 값은 null", () => {
    expect(normalizeValue("status", "opt-a", { options: opts })).toBe("opt-a");
    expect(normalizeValue("status", "")).toBeNull();
  });
  it("주어진 옵션 목록에 없는 id 는 거부", () => {
    expect(() => normalizeValue("status", "opt-z", { options: opts })).toThrow(ValidationError);
  });
});

describe("field-types: people (person 과 달리 배열만 허용)", () => {
  it("user id 배열을 정규화하고 중복이 아닌 것만 남긴다", () => {
    expect(normalizeValue("people", ["u1", "u2", "u1"])).toEqual(["u1", "u2"]);
    expect(normalizeValue("people", [])).toBeNull();
    expect(normalizeValue("people", null)).toBeNull();
  });
  it("배열이 아니면 거부(person 과의 차이)", () => {
    expect(() => normalizeValue("people", "u1")).toThrow(ValidationError);
  });
});

describe("field-types: money (number 와 저장 규칙 동일 · 표시만 다름)", () => {
  it("콤마·원화기호 섞인 입력을 숫자로", () => {
    expect(normalizeValue("money", "1,200,000")).toBe(1200000);
    expect(normalizeValue("money", "₩500")).toBe(500);
  });
  it("숫자가 아니면 거부", () => {
    expect(() => normalizeValue("money", "abc")).toThrow(ValidationError);
  });
});

describe("field-types: calc (읽기 전용 — 폼 입력 경로로 절대 쓰지 않는다)", () => {
  it("빈 값은 통과하지만 실제 값을 넣으려 하면 항상 거부", () => {
    expect(normalizeValue("calc", "")).toBeNull();
    expect(normalizeValue("calc", null)).toBeNull();
    expect(() => normalizeValue("calc", "D-51")).toThrow(ValidationError);
    expect(() => normalizeValue("calc", 12345)).toThrow(ValidationError);
  });
});

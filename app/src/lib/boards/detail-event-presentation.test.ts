import { describe, expect, it } from "vitest";
import { presentDetailHistoryEvent, type DetailHistoryContext, type DetailHistoryEvent } from "./detail-event-presentation";

const created = "2026-01-01T00:00:00.123456+00:00";
const later = "2026-01-02T00:00:00.000000+00:00";
const context: DetailHistoryContext = {
  itemCreatedAt: created,
  columns: [
    { key: "progress", label: "진행 현황", type: "status", options_jsonb: { options: [{ id: "a", label: "상담 전", color: "#aaa" }, { id: "b", label: "상담 완료", color: "#bbb" }] } },
    { key: "amount", label: "계약금", type: "number", options_jsonb: null },
    { key: "person", label: "담당자", type: "person", options_jsonb: null },
    { key: "calc", label: "계산 결과", type: "calc", options_jsonb: null },
  ],
  members: [{ id: "person-a", name: "담당 A" }, { id: "person-b", name: "담당 B" }],
};
const change = (before: unknown, after: unknown, key = "progress", at = later): DetailHistoryEvent => ({ kind: "field_change", body: `${key} 항목이 변경되었습니다.`, created_at: at, metadata: { column_key: key, before, after } });

describe("meaningful detail history", () => {
  it.each(["memo", "call", "admin", "meeting"])("preserves %s even in the creation transaction", (kind) => {
    expect(presentDetailHistoryEvent({ kind, body: "담당자 대화", created_at: created }, context)).toEqual({ important: true, body: "담당자 대화" });
  });
  it("hides only the initial transaction's empty-before changes and keeps them readable for full history", () => {
    expect(presentDetailHistoryEvent(change(null, "a", "progress", created), context)).toEqual({ important: false, body: "진행 현황: 미입력 → 상담 전 (최초 입력)" });
    expect(presentDetailHistoryEvent(change(null, "b"), context)).toEqual({ important: true, body: "진행 현황: 미입력 → 상담 완료" });
  });
  it("does not round distinct microsecond transactions into creation", () => {
    expect(presentDetailHistoryEvent(change(null, "b", "progress", "2026-01-01T00:00:00.123457Z"), context).important).toBe(true);
  });
  it("formats real changes with the board label and option labels", () => {
    expect(presentDetailHistoryEvent(change("a", "b"), context)).toEqual({ important: true, body: "진행 현황: 상담 전 → 상담 완료" });
    expect(presentDetailHistoryEvent(change(1000, 2000, "amount"), context).body).toBe("계약금: 1,000 → 2,000");
    expect(presentDetailHistoryEvent(change("b", null), context).body).toBe("진행 현황: 상담 완료 → 미입력");
  });
  it("filters no-op and calculated noise without confusing zero with empty", () => {
    expect(presentDetailHistoryEvent(change("a", "a"), context).important).toBe(false);
    expect(presentDetailHistoryEvent(change(null, ""), context).important).toBe(false);
    expect(presentDetailHistoryEvent(change(null, 0, "amount"), context).important).toBe(true);
    expect(presentDetailHistoryEvent(change(1, 2, "calc"), context).important).toBe(false);
  });
  it("does not expose raw keys, UUIDs or arbitrary metadata for unknown fields", () => {
    const result = presentDetailHistoryEvent(change("secret-old", "secret-new", "hidden_internal_key"), context);
    expect(result).toEqual({ important: false, body: "항목 변경 · 상세 내용 확인 불가" });
    expect(presentDetailHistoryEvent({ kind: "field_change", body: "raw_key", created_at: later }, context)).toEqual(result);
  });
  it("resolves permitted member names and never leaks unresolved identifiers", () => {
    expect(presentDetailHistoryEvent(change("person-a", "person-b", "person"), context).body).toBe("담당자: 담당 A → 담당 B");
    expect(presentDetailHistoryEvent(change("person-a", "unknown-private-id", "person"), context).body).toBe("담당자: 담당 A → 이름 확인 불가");
  });
  it("does not alter source records when hiding or formatting them", () => {
    const event = change(null, "a", "progress", created), before = structuredClone(event);
    presentDetailHistoryEvent(event, context);
    expect(event).toEqual(before);
  });
});


it("does not expose serialized objects or raw identifier arrays as meaningful changes", () => {
  const field = { ...context.columns[1], key: "structured", label: "추가 정보", type: "text" as const };
  const ctx = { ...context, columns: [field] };
  const event = change('{"secret":"old"}', '{"secret":"new"}', "structured");
  const result = presentDetailHistoryEvent(event, ctx);
  expect(result.important).toBe(false);
  expect(result.body).toBe("추가 정보: 복합 정보 → 복합 정보");
  const array = presentDetailHistoryEvent(change([], ["00000000-0000-4000-8000-000000000001"], "structured"), ctx);
  expect(array.body).not.toContain("00000000");
});

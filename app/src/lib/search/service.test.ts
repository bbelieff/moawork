import { describe, expect, it } from "vitest";
import { jsonOk } from "@/lib/crm";
import { unwrapCreatedSearchResult, unwrapSearchResponse } from "@/components/shell/GlobalSearch";
import { buildSearchResponse, normalizeQuery } from "./service";

const data = {
  boards: [{ id: "b1", name: "영업 보드", description: "이번 달" }],
  deals: [{ id: "d-visible", title: "보이는 업무", status_note: "진행" }],
  companies: [{ id: "c1", name: "샘플 회사", biz_type: "제조", region: "서울" }],
  notices: [{ id: "n1", title: "휴무 안내", body: "월요일", categoryLabel: "운영" }],
};

describe("workspace search", () => {
  it("normalizes and limits user input", () => {
    expect(normalizeQuery("  샘플   회사  ")).toBe("샘플 회사");
    expect(normalizeQuery("가".repeat(100))).toHaveLength(80);
  });

  it("matches every query term across the visible collections", () => {
    const result = buildSearchResponse(data, "샘플 서울");
    expect(result.results).toEqual([
      expect.objectContaining({ kind: "company", id: "c1", href: "/companies/c1" }),
    ]);
  });

  it("reauthorizes recent refs against the current visible collection", () => {
    const result = buildSearchResponse(data, "", [
      { kind: "deal", id: "d-hidden" },
      { kind: "deal", id: "d-visible" },
    ]);
    expect(result.recent.map((item) => item.id)).toEqual(["d-visible"]);
  });

  it("does not return a full data dump for an empty query", () => {
    expect(buildSearchResponse(data, "  ").results).toEqual([]);
  });

  it("uses jsonOk data for displayed GET search results", async () => {
    const response = buildSearchResponse(data, "샘플");
    const payload = await jsonOk(response).json();

    expect(unwrapSearchResponse(payload).results).toEqual([
      expect.objectContaining({ kind: "company", id: "c1", href: "/companies/c1" }),
    ]);
  });

  it("uses jsonOk data for POST navigation and rejects malformed envelopes", async () => {
    const result = { kind: "company" as const, id: "c1", title: "샘플 회사", description: "새 회사", href: "/companies/c1" };

    expect(unwrapCreatedSearchResult(await jsonOk(result, 201).json()).href).toBe("/companies/c1");
    expect(() => unwrapSearchResponse({ results: [], recent: [], query: "샘플" })).toThrow("검색 결과 형식");
    expect(() => unwrapCreatedSearchResult({ data: { ...result, href: "https://outside.invalid" } })).toThrow("만든 항목");
    expect(() => unwrapCreatedSearchResult({ data: { ...result, href: "//outside.invalid" } })).toThrow("만든 항목");
    expect(() => unwrapCreatedSearchResult({ data: { ...result, href: "/\\outside.invalid" } })).toThrow("만든 항목");
  });
});

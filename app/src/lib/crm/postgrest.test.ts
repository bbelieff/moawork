import { describe, it, expect } from "vitest";
import { buildFilterQuery, restPath, inList } from "./postgrest";

describe("buildFilterQuery", () => {
  it("필터 맵을 PostgREST 쿼리로 인코딩", () => {
    expect(buildFilterQuery({ org_id: "eq.org1", archived: "eq.false" })).toBe(
      "org_id=eq.org1&archived=eq.false",
    );
  });
  it("extra(order 등) 를 뒤에 붙인다", () => {
    expect(buildFilterQuery({ org_id: "eq.o" }, { order: "position.asc" })).toBe(
      "org_id=eq.o&order=position.asc",
    );
  });
  it("특수문자를 URL 인코딩", () => {
    expect(buildFilterQuery({ id: "eq.a b" })).toBe("id=eq.a%20b");
  });
});

describe("restPath", () => {
  it("base 끝 슬래시를 정규화하고 경로 조립", () => {
    expect(restPath("https://x.supabase.co/", "boards", "org_id=eq.o")).toBe(
      "https://x.supabase.co/rest/v1/boards?org_id=eq.o",
    );
  });
  it("쿼리 없으면 물음표 없음", () => {
    expect(restPath("https://x.supabase.co", "items", "")).toBe(
      "https://x.supabase.co/rest/v1/items",
    );
  });
});

describe("inList", () => {
  it("in.(...) 조립 + 따옴표 이스케이프", () => {
    expect(inList(["a", "b"])).toBe('in.("a","b")');
    expect(inList(['x"y'])).toBe('in.("x""y")');
  });
});

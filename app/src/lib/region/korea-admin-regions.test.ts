import { describe, expect, it } from "vitest";
import { KOREA_SIGUNGU } from "./korea-admin-regions";
import { canonicalSigungu, searchSigungu, sigunguSuggestions } from "@/lib/new-lead/region-search";
import { joinCanonicalRegion } from "@/lib/companies/intake-mapping";

describe("행정구역 전수 목록 (2026-10-17 belie)", () => {
  it("17개 시도 · 230 시군구(기초 226 + 제주 행정시 2 + 세종 1 + 인천 2026 개편 +1)", () => {
    expect(Object.keys(KOREA_SIGUNGU)).toHaveLength(17);
    const total = Object.values(KOREA_SIGUNGU).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(230);
    expect(KOREA_SIGUNGU.서울).toHaveLength(25);
    expect(KOREA_SIGUNGU.경기).toHaveLength(31);
  });

  it("아카이브에 없던 지역도 고를 수 있다", () => {
    expect(sigunguSuggestions("제주").map((entry) => entry.value)).toEqual(["서귀포시", "제주시"]);
    expect(sigunguSuggestions("세종").map((entry) => entry.value)).toEqual(["세종시"]);
    expect(sigunguSuggestions("경북").map((entry) => entry.value)).toContain("울릉군");
    expect(sigunguSuggestions("대구").map((entry) => entry.value)).toContain("군위군");
    expect(searchSigungu("경남", "통영").map((entry) => entry.value)).toEqual(["통영시"]);
  });

  it("이미 저장된 옛 이름은 다시 저장해도 막지 않는다", () => {
    expect(canonicalSigungu("인천", "중구")).toBe("중구");
    expect(canonicalSigungu("부산", "진구")).toBe("진구");
    expect(sigunguSuggestions("인천").map((entry) => entry.value)).not.toContain("중구");
  });

  it("회사 저장값은 아카이브 표기를 우선하고, 없으면 시도_시군구", () => {
    expect(joinCanonicalRegion("강원", "원주시")).toBe("강원도_원주시");
    expect(joinCanonicalRegion("제주", "제주시")).toBe("제주_제주시");
    expect(() => joinCanonicalRegion("서울", "없는구")).toThrow();
  });
});

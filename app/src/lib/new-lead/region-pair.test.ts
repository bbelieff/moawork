import { describe, expect, it } from "vitest";

import { regionPairForSidoChange, validateRegionPair } from "./region-pair";

describe("region pair 원자 검증", () => {
  it("둘 다 비어 있으면 지우기 허용", () => {
    expect(validateRegionPair({ sido: "", sigungu: "" })).toEqual({ ok: true, sido: null, sigungu: null });
  });

  it("시도 없이 시군구만 있으면 거부하고 입력 보존", () => {
    const result = validateRegionPair({ sido: "", sigungu: "강남구" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/시도를 먼저/);
  });

  it("잘못된 시도·시군구 쌍을 서버 거부 규칙으로 막는다", () => {
    expect(validateRegionPair({ sido: "없는시도", sigungu: "" }).ok).toBe(false);
    expect(validateRegionPair({ sido: "서울", sigungu: "없는구" }).ok).toBe(false);
    // 서울 시도에 부산 시군구는 잘못된 조합이다.
    expect(validateRegionPair({ sido: "서울", sigungu: "해운대구" }).ok).toBe(false);
  });

  it("올바른 쌍은 정본 값으로 닫는다", () => {
    expect(validateRegionPair({ sido: "서울", sigungu: "강남구" })).toEqual({
      ok: true,
      sido: "서울",
      sigungu: "강남구",
    });
    expect(validateRegionPair({ sido: "서울", sigungu: "" })).toEqual({
      ok: true,
      sido: "서울",
      sigungu: null,
    });
  });

  it("시도 변경 때는 시군구를 같은 요청에 초기화한다", () => {
    // 서울 강남구에서 부산으로 바꾸면 시군구는 빈값으로 초기화된다.
    expect(regionPairForSidoChange("부산", "강남구")).toEqual({ sido: "부산", sigungu: "" });
    // 같은 시도 안에서는 유지된다.
    expect(regionPairForSidoChange("서울", "강남구")).toEqual({ sido: "서울", sigungu: "강남구" });
    // 시도를 지우면 둘 다 지운다.
    expect(regionPairForSidoChange("", "강남구")).toEqual({ sido: "", sigungu: "" });
  });
});

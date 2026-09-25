import { describe, expect, it } from "vitest";

import {
  BULK_MAX_ITEMS,
  intersectVisibleSelection,
  normalizeBoardPhoneDigits,
  pruneSelection,
  selectionToCsv,
  selectionTriState,
  toggleGroupSelection,
  toggleSelection,
} from "./bulk-selection";

describe("bulk-selection 선택 범위", () => {
  it("토글은 같은 집합을 같은 상태로 — 중복 추가 없음", () => {
    const once = toggleSelection(new Set(["a"]), "b", true);
    expect([...once].sort()).toEqual(["a", "b"]);
    expect(toggleSelection(once, "b", true).size).toBe(2);
    expect(toggleSelection(once, "a", false).has("a")).toBe(false);
  });

  it("그룹 토글은 보이는 행만 건드리고 다른 선택은 유지", () => {
    const next = toggleGroupSelection(new Set(["keep", "x"]), ["x", "y"], true);
    expect([...next].sort()).toEqual(["keep", "x", "y"]);
    const cleared = toggleGroupSelection(next, ["x", "y"], false);
    expect([...cleared]).toEqual(["keep"]);
  });

  it("마스터·그룹 3상태 — 비어 있음·부분·전체", () => {
    expect(selectionTriState(new Set(), ["a"])).toBe("empty");
    expect(selectionTriState(new Set(["a"]), [])).toBe("empty");
    expect(selectionTriState(new Set(["a"]), ["a", "b"])).toBe("partial");
    expect(selectionTriState(new Set(["a", "b"]), ["a", "b"])).toBe("full");
  });

  it("일괄 대상은 선택 ∩ 보이는 행 — 숨겨진 행은 절대 포함하지 않음", () => {
    expect(intersectVisibleSelection(new Set(["a", "hidden"]), ["a", "b"])).toEqual(["a"]);
    expect(intersectVisibleSelection(new Set(["hidden"]), ["a", "b"])).toEqual([]);
  });

  it("사라진 id 는 prune 으로 털어냄", () => {
    expect([...pruneSelection(new Set(["a", "gone"]), new Set(["a"]))]).toEqual(["a"]);
  });

  it("상한 100 — UI 는 그 이상을 한 번에 보내지 않음", () => {
    expect(BULK_MAX_ITEMS).toBe(100);
  });
});

describe("bulk-selection 전화 정규화", () => {
  it("+82·하이픈·공백 표기가 같은 숫자로 수렴", () => {
    expect(normalizeBoardPhoneDigits("010-1234-5678")).toBe("01012345678");
    expect(normalizeBoardPhoneDigits("01012345678")).toBe("01012345678");
    expect(normalizeBoardPhoneDigits("+82 10-1234-5678")).toBe("01012345678");
    expect(normalizeBoardPhoneDigits("+821012345678")).toBe("01012345678");
    expect(normalizeBoardPhoneDigits("010 1234 5678")).toBe("01012345678");
  });

  it("빈값·null 은 빈 문자열", () => {
    expect(normalizeBoardPhoneDigits("")).toBe("");
    expect(normalizeBoardPhoneDigits(null)).toBe("");
  });
});

describe("bulk-selection CSV", () => {
  it("수식 주입 방지 — = + - @ 앞에 작은따옴표", () => {
    const csv = selectionToCsv(["이름"], [["=cmd"], ["+8210"], ["-5"], ["@x"], ["정상"]]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+8210");
    expect(csv).toContain("정상");
  });

  it("쉼표·따옴표·개행은 감싸기", () => {
    expect(selectionToCsv(["a,b"], [['q"q']])).toBe('"a,b"\r\n"q""q"');
  });
});

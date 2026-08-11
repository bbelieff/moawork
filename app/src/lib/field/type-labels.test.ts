import { describe, expect, it } from "vitest";
import { FIELD_TYPES } from "@/lib/types";
import {
  PRODUCT_FIELD_TYPES,
  PRODUCT_FIELD_TYPE_TO_STORAGE,
  fieldTypeLabel,
} from "./type-labels";

describe("field/type-labels — 타입 15종+ 표시 이름 완전성(D09 미정의 0)", () => {
  it("목업 제품 타입 15종을 저장 타입에 빠짐없이 연결한다", () => {
    expect(PRODUCT_FIELD_TYPES).toHaveLength(15);
    expect(Object.keys(PRODUCT_FIELD_TYPE_TO_STORAGE)).toEqual([...PRODUCT_FIELD_TYPES]);
    for (const type of PRODUCT_FIELD_TYPES) {
      expect(fieldTypeLabel(PRODUCT_FIELD_TYPE_TO_STORAGE[type])).toBeTruthy();
    }
  });
  it("001 enum(13종)+BBE-123 신규 4종 전부 라벨이 있다", () => {
    for (const t of FIELD_TYPES) {
      expect(fieldTypeLabel(t).length).toBeGreaterThan(0);
    }
  });

  it("V6 목업 정본 15종 이름과 일치", () => {
    expect(fieldTypeLabel("status")).toBe("상태");
    expect(fieldTypeLabel("people")).toBe("사람 여럿");
    expect(fieldTypeLabel("money")).toBe("금액");
    expect(fieldTypeLabel("calc")).toBe("수식");
  });
});

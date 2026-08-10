import { describe, expect, it } from "vitest";
import { FIELD_TYPES } from "@/lib/types";
import { fieldTypeLabel } from "./type-labels";

describe("field/type-labels — 타입 15종+ 표시 이름 완전성(D09 미정의 0)", () => {
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

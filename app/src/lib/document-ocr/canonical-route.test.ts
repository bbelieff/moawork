import { describe, expect, it } from "vitest";
import { NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import {
  OCR_SAVABLE_BOARD_KEYS,
  routeOcrBoardField,
} from "./canonical-route";

function input(over: Partial<Parameters<typeof routeOcrBoardField>[0]> = {}) {
  return {
    boardSource: "custom",
    ocrKey: "representative" as const,
    fieldKey: "rep_name",
    dealId: null,
    linkedCompany: false,
    columnKeys: [...OCR_SAVABLE_BOARD_KEYS],
    detailKeys: [] as string[],
    ...over,
  };
}

describe("routeOcrBoardField", () => {
  it("정본 보드 + deal 일치 → 대표자/업종/사업자유형은 canonical-update", () => {
    for (const [fieldKey, patchKey] of [
      ["rep_name", "representative_name"],
      ["industry", "industry"],
      ["biz_reg_type", "business_registration_type"],
    ] as const) {
      const route = routeOcrBoardField(
        input({ boardSource: NEW_LEAD_TAB_SOURCE, dealId: "deal-1", fieldKey }),
      );
      expect(route).toEqual({ route: "canonical-update", patchKey });
    }
  });

  it("정본 보드 + deal 일치 → 주소는 canonical-meta", () => {
    expect(
      routeOcrBoardField(
        input({ boardSource: NEW_LEAD_TAB_SOURCE, dealId: "deal-1", fieldKey: "address_detail" }),
      ),
    ).toEqual({ route: "canonical-meta" });
  });

  it("정본 보드라도 deal이 없으면 정본 RPC로 보내지 않음", () => {
    const route = routeOcrBoardField(
      input({ boardSource: NEW_LEAD_TAB_SOURCE, dealId: null, fieldKey: "rep_name" }),
    );
    expect(route).toEqual({ route: "generic" });
  });

  it("일반 보드는 기존 세부필드 저장 경로(generic)", () => {
    expect(
      routeOcrBoardField(input({ fieldKey: "rep_name" })).route,
    ).toBe("generic");
    expect(
      routeOcrBoardField(
        input({
          boardSource: NEW_LEAD_TAB_SOURCE,
          dealId: "deal-1",
          fieldKey: "founded_month",
        }),
      ).route,
    ).toBe("generic");
  });

  it("없어진 컬럼은 명시 거부 (무음 저장 금지)", () => {
    const route = routeOcrBoardField(
      input({ fieldKey: "rep_name", columnKeys: ["other"], detailKeys: ["other-detail"] }),
    );
    expect(route.route).toBe("reject");
    if (route.route === "reject") {
      expect(route.reason).toContain("rep_name");
      expect(route.reason).toContain("저장하지 않았습니다");
    }
  });

  it("OCR 저장 대상이 아닌 키는 거부", () => {
    for (const fieldKey of ["owner", "phone", "email"]) {
      const route = routeOcrBoardField(input({ fieldKey }));
      expect(route.route).toBe("reject");
    }
  });

  it("상호(title)는 deal 있을 때 canonical-title, 없으면 거부", () => {
    expect(
      routeOcrBoardField(
        input({ ocrKey: "companyName", fieldKey: "title", dealId: "deal-1" }),
      ),
    ).toEqual({ route: "canonical-title" });
    expect(
      routeOcrBoardField(input({ ocrKey: "companyName", fieldKey: "title", dealId: null }))
        .route,
    ).toBe("reject");
  });

  it("생년월일·종목은 ocr-meta (정본 deal 필요)", () => {
    expect(
      routeOcrBoardField(
        input({ ocrKey: "birthdate", fieldKey: "birthdate", dealId: "deal-1" }),
      ),
    ).toEqual({ route: "ocr-meta", metaKey: "birthdate" });
    expect(
      routeOcrBoardField(
        input({ ocrKey: "businessItem", fieldKey: "business_item", dealId: "deal-1" }),
      ),
    ).toEqual({ route: "ocr-meta", metaKey: "business_item" });
    expect(
      routeOcrBoardField(input({ ocrKey: "birthdate", fieldKey: "birthdate", dealId: null }))
        .route,
    ).toBe("reject");
  });

  it("사업자번호는 연계 있으면 company-bizno, 없으면 ocr-meta", () => {
    expect(
      routeOcrBoardField(
        input({ ocrKey: "bizNo", fieldKey: "biz_no", dealId: "deal-1", linkedCompany: true }),
      ).route,
    ).toBe("company-bizno");
    expect(
      routeOcrBoardField(
        input({ ocrKey: "bizNo", fieldKey: "biz_no", dealId: "deal-1", linkedCompany: false }),
      ),
    ).toEqual({ route: "ocr-meta", metaKey: "biz_no" });
  });

  it("정본 대상에 다른 OCR 키가 오면 거부 (위장 저장 방지)", () => {
    const route = routeOcrBoardField(
      input({ ocrKey: "representative", fieldKey: "title", dealId: "deal-1" }),
    );
    expect(route.route).toBe("reject");
  });
});

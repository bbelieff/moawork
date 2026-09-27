import { describe, expect, it } from "vitest";
import {
  OCR_BOARD_KEY_CANDIDATES,
  OCR_UNSUPPORTED_REASON,
  ocrCellText,
  ocrReadonlyReason,
  ocrRequireConfirm,
  resolveOcrBoardTargets,
} from "./ItemDetailOcr";
import { OCR_FIELD_KEYS } from "@/lib/document-ocr/types";
import type { BoardColumn } from "@/lib/boards/types";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";

function column(key: string, over: Partial<BoardColumn> = {}): BoardColumn {
  return {
    id: `col-${key}`,
    org_id: "org-a",
    board_id: "board-a",
    key,
    label: key,
    type: "text",
    source: "in",
    rightPinned: false,
    options_jsonb: null,
    sort_order: 0,
    width: null,
    ...over,
  };
}

describe("ItemDetailOcr 매핑", () => {
  it("상세 배치가 있으면 detail 소스로 잡는다", () => {
    const targets = resolveOcrBoardTargets(
      [[{ key: "rep_name", source: "detail" } as DetailLayoutEntry]],
      [column("rep_name")],
    );
    expect(targets.representative).toEqual({ boardKey: "rep_name", source: "detail" });
  });

  it("상세 배치가 없으면 컬럼으로 떨어진다", () => {
    const targets = resolveOcrBoardTargets(
      [[{ key: "other", source: "detail" } as DetailLayoutEntry]],
      [column("address_detail")],
    );
    expect(targets.businessAddress).toEqual({ boardKey: "address_detail", source: "column" });
  });

  it("정본 대상 4종은 보드 배치 없이 canonical으로 매핑된다", () => {
    const targets = resolveOcrBoardTargets(
      [[{ key: "rep_name", source: "detail" } as DetailLayoutEntry]],
      [column("rep_name")],
    );
    expect(targets.companyName).toEqual({ boardKey: "title", source: "canonical" });
    expect(targets.birthdate).toEqual({ boardKey: "birthdate", source: "canonical" });
    expect(targets.businessItem).toEqual({ boardKey: "business_item", source: "canonical" });
    expect(targets.bizNo).toEqual({ boardKey: "biz_no", source: "canonical" });
    // 법인 형태는 정본 키가 없어 미매핑으로 남는다.
    expect(targets.legalForm).toBeUndefined();
  });

  it("어휘가 다른 과세·개업연월도 diff 확인 대상으로 매핑한다", () => {
    const targets = resolveOcrBoardTargets(
      [[
        { key: "biz_reg_type", source: "detail" },
        { key: "founded_month", source: "detail" },
      ] as DetailLayoutEntry[]],
      [],
    );
    expect(targets.taxation).toEqual({ boardKey: "biz_reg_type", source: "detail" });
    expect(targets.openedOn).toEqual({ boardKey: "founded_month", source: "detail" });
  });
});

describe("지원/미지원 완전성 (조용히 제외 금지)", () => {
  it("모든 OCR 키는 저장 후보 아니면 미지원 사유 둘 중 하나에 정확히 속한다", () => {
    for (const key of OCR_FIELD_KEYS) {
      const mapped = key in OCR_BOARD_KEY_CANDIDATES;
      const reasoned = key in OCR_UNSUPPORTED_REASON;
      expect(
        mapped !== reasoned,
        `${key}: 후보·사유 둘 중 정확히 하나`,
      ).toBe(true);
      if (reasoned) {
        expect(OCR_UNSUPPORTED_REASON[key]?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("고객 요청 필드의 지원 판정이 정확하다", () => {
    // 지원 9종: 과세·대표자·개업연월·소재지·업태 + 상호·생년월일·종목·등록번호
    for (const key of [
      "taxation",
      "representative",
      "openedOn",
      "businessAddress",
      "businessCategory",
      "companyName",
      "birthdate",
      "businessItem",
      "bizNo",
    ] as const) {
      expect(OCR_BOARD_KEY_CANDIDATES[key]).toBeTruthy();
      expect(OCR_UNSUPPORTED_REASON[key]).toBeUndefined();
    }
    // 미지원: 법인형태(참고 정보, 정본 키 없음)
    expect(OCR_BOARD_KEY_CANDIDATES["legalForm"]).toBeUndefined();
    expect(OCR_UNSUPPORTED_REASON["legalForm"]).toBeTruthy();
  });
});

describe("ocrReadonlyReason — UI도 읽기전용 칸을 잠근다", () => {
  it("읽기전용 칸은 사유를 돌린다", () => {
    expect(
      ocrReadonlyReason([column("rep_name", { is_readonly: true })], "rep_name"),
    ).toContain("자동 계산");
  });

  it("자동계산 source 칸은 사유를 돌린다", () => {
    expect(
      ocrReadonlyReason([column("rep_name", { source: "calc" })], "rep_name"),
    ).toContain("자동으로 채워지는 칸");
  });

  it("일반 입력 칸·정의 없음은 잠그지 않는다", () => {
    expect(ocrReadonlyReason([column("rep_name")], "rep_name")).toBeUndefined();
    expect(ocrReadonlyReason([column("rep_name")], "other")).toBeUndefined();
  });
});

describe("ocrCellText", () => {
  it("문자·숫자는 그대로, 객체·없음은 빈값으로 둔다", () => {
    expect(ocrCellText("홍길동")).toBe("홍길동");
    expect(ocrCellText(12)).toBe("12");
    expect(ocrCellText(undefined)).toBe("");
    expect(ocrCellText(null)).toBe("");
    expect(ocrCellText({} as never)).toBe("");
  });
});

describe("ocrRequireConfirm — 정정 저장은 확정 체크가 있어야 한다", () => {
  it("사업자등록번호는 항상 확정 대상이다", () => {
    expect(ocrRequireConfirm("bizNo", false)).toBe(true);
    expect(ocrRequireConfirm("bizNo", true)).toBe(true);
  });

  it("연계 회사명은 확정 대상, 미연계 title은 아니다", () => {
    expect(ocrRequireConfirm("companyName", true)).toBe(true);
    expect(ocrRequireConfirm("companyName", false)).toBe(false);
  });

  it("그 외 키는 확정 없이 저장된다", () => {
    expect(ocrRequireConfirm("representative", true)).toBe(false);
    expect(ocrRequireConfirm("birthdate", true)).toBe(false);
    expect(ocrRequireConfirm("businessItem", true)).toBe(false);
  });
});

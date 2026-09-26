import { describe, expect, it } from "vitest";

import {
  DEAL_BULK_EDITABLE_FIELDS,
  describeCompaniesBulkTargets,
  parseCompaniesBulkId,
  splitCompaniesBulkIds,
  toCompanyBulkId,
  toDealBulkId,
  validateCompanyBulkPatch,
  validateDealBulkPatch,
  visibleCompaniesBulkIds,
} from "./bulk";
import { intersectVisibleSelection, selectionToCsv } from "@/components/board/bulk-selection";

describe("companies bulk id 구분", () => {
  it("company:/deal:을 구분하고 업체 선택이 하위 딜을 암묵 선택하지 않음", () => {
    expect(parseCompaniesBulkId(toCompanyBulkId("c1"))).toEqual({ kind: "company", id: "c1" });
    expect(parseCompaniesBulkId(toDealBulkId("d1"))).toEqual({ kind: "deal", id: "d1" });
    expect(parseCompaniesBulkId("c1")).toBeNull();
    const split = splitCompaniesBulkIds([toCompanyBulkId("c1"), toDealBulkId("d1"), toDealBulkId("d2")]);
    expect(split).toEqual({ companyIds: ["c1"], dealIds: ["d1", "d2"] });
  });

  it("대상 종류와 수를 분명히 보인다", () => {
    expect(describeCompaniesBulkTargets([toCompanyBulkId("c1"), toDealBulkId("d1")]).label).toBe(
      "회사 1개 · 자금 건 1개",
    );
    expect(describeCompaniesBulkTargets([]).label).toBe("선택 없음");
  });
});

describe("companies bulk 가시 범위", () => {
  const views = [
    { companyId: "c1", dealIds: ["d1", "d2"] },
    { companyId: "c2", dealIds: ["d3"] },
  ];

  it("펼쳐진 행만 실제 대상 — 접힌 하위는 제외", () => {
    expect(visibleCompaniesBulkIds(views, {})).toEqual([toCompanyBulkId("c1"), toCompanyBulkId("c2")]);
    expect(visibleCompaniesBulkIds(views, { c1: true })).toEqual([
      toCompanyBulkId("c1"),
      toDealBulkId("d1"),
      toDealBulkId("d2"),
      toCompanyBulkId("c2"),
    ]);
  });

  it("선택 교집합 — 검색·필터에 보이고 펼쳐진 행만 대상", () => {
    const visible = visibleCompaniesBulkIds(views, { c1: true, c2: true });
    expect(intersectVisibleSelection(new Set([toCompanyBulkId("c1"), toDealBulkId("d2"), "deal:hidden"]), visible)).toEqual([
      toCompanyBulkId("c1"),
      toDealBulkId("d2"),
    ]);
  });
});

describe("companies bulk 필드 가드", () => {
  it("회사 집계 상태/금액/담당 직접 수정 금지", () => {
    for (const field of ["status", "amount", "assigned_to"]) {
      expect(() => validateCompanyBulkPatch(field, "x")).toThrow(/집계/);
    }
  });

  it("회사 일반 필드는 parseUpdateCompany를 통과한다", () => {
    expect(validateCompanyBulkPatch("biz_type", "제조업")).toEqual({ biz_type: "제조업" });
  });

  it("딜 단계·담당은 일반 필드로 받지 않는다", () => {
    expect(() => validateDealBulkPatch("stage_id", "s1")).toThrow(/일괄로 고칠 수 없는/);
    expect(() => validateDealBulkPatch("assigned_to", "u1")).toThrow(/일괄로 고칠 수 없는/);
    expect(validateDealBulkPatch("title", "새 자금")).toEqual({ title: "새 자금" });
  });

  it("파서가 지원하지 않는 계약조건(fee_terms)은 선택지로 노출하지 않는다", () => {
    expect(DEAL_BULK_EDITABLE_FIELDS.map((field) => field.key)).not.toContain("fee_terms");
    expect(() => validateDealBulkPatch("fee_terms", "조건")).toThrow(/일괄로 고칠 수 없는/);
  });

  it("없는 필드는 작동하는 것처럼 두지 않는다", () => {
    expect(() => validateCompanyBulkPatch("no_such_field", "x")).toThrow(/일괄로 고칠 수 없는/);
    expect(() => validateDealBulkPatch("no_such_field", "x")).toThrow(/일괄로 고칠 수 없는/);
  });
});

describe("companies bulk CSV 수식 방어", () => {
  it("= + - @ 앞에 작은따옴표", () => {
    const csv = selectionToCsv(["종류", "이름"], [["회사", "=cmd"], ["자금 건", "@x"]]);
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'@x");
  });
});

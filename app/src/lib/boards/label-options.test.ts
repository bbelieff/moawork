import { describe, expect, it } from "vitest";
import type { FieldOption } from "@/lib/types";
import {
  canCreateLabelForColumn,
  filterLabelOptions,
  mergeLabelOption,
  normalizeLabelDisplay,
  normalizeLabelKey,
} from "./label-options";

function option(id: string, order = 0, color?: string): FieldOption {
  return color ? { id, label: id, order, color } : { id, label: id, order };
}

describe("라벨 정규화·중복 판정", () => {
  it("공백·대소문자를 같은 라벨로 읽는다", () => {
    expect(normalizeLabelKey("  혁신 성장 자금 ")).toBe("혁신 성장 자금");
    expect(normalizeLabelDisplay("  혁신  성장자금 ")).toBe("혁신 성장자금");
  });

  it("id 또는 라벨(대소문자 무시)이 겹치면 만들지 않고 기존 id 를 돌려준다", () => {
    const existing = [option("진행중", 0, "#fdab3d"), option("심사 중", 1)];
    const duplicate = mergeLabelOption(existing, "  진행중 ");
    expect(duplicate?.created).toBe(false);
    expect(duplicate?.optionId).toBe("진행중");
    // 기존 배열은 그대로 — 순서·색을 손대지 않는다.
    expect(duplicate?.options).toEqual(existing);
  });

  it("새 라벨은 맨 뒤에 붙고 기존 항목을 그대로 둔다", () => {
    const existing = [option("진행중", 0, "#fdab3d")];
    const merged = mergeLabelOption(existing, "새 라벨");
    expect(merged?.created).toBe(true);
    expect(merged?.optionId).toBe("새 라벨");
    expect(merged?.options).toEqual([option("진행중", 0, "#fdab3d"), { id: "새 라벨", label: "새 라벨", order: 1 }]);
  });

  it("빈 라벨은 null — 호출부가 막는다", () => {
    expect(mergeLabelOption([option("a")], "   ")).toBeNull();
  });

  it("동시 추가는 같은 입력에서 같은 결과로 수렴한다", () => {
    const existing = [option("a", 0)];
    const first = mergeLabelOption(existing, "새 라벨");
    const second = mergeLabelOption(existing, "새  라벨");
    expect(first?.options).toEqual(second?.options);
    expect(first?.optionId).toBe(second?.optionId);
  });
});

describe("생성 가드 — 보호 컬럼에서는 만들 수 없다", () => {
  const editable = { type: "select", source: "in" };

  it("일반 select/in 컬럼은 만들 수 있다", () => {
    expect(canCreateLabelForColumn({ ...editable, key: "fund_name" })).toEqual({ allowed: true });
    expect(canCreateLabelForColumn({ key: "institution", type: "status", source: "act" })).toEqual({ allowed: true });
    expect(canCreateLabelForColumn({ key: "product", type: "multiselect", source: "in" })).toEqual({ allowed: true });
  });

  it("전이·승인 게이트·단계·이동규칙 컬럼은 막는다", () => {
    for (const key of ["contact_move", "work_move", "seal_status", "seal_approval", "consult_status", "contract_status", "progress_status"]) {
      expect(canCreateLabelForColumn({ ...editable, key }).allowed, key).toBe(false);
    }
    // 이동 규칙이 있는 일반 컬럼도 막는다 — 규칙 없는 값은 카드를 안 움직인다.
    expect(
      canCreateLabelForColumn({ ...editable, key: "custom_move", move_rule_jsonb: { a: "g1" } }).allowed,
    ).toBe(false);
  });

  it("지역 카탈로그·읽기전용·수식·연동 컬럼은 막는다", () => {
    for (const column of [
      { ...editable, key: "sido" },
      { ...editable, key: "sigungu" },
      { ...editable, key: "fund_name", is_readonly: true },
      { key: "d180", type: "calc", source: "calc" },
      { key: "review_dday", type: "text", source: "calc" },
      { ...editable, key: "business_type", source: "lk" },
      { key: "owner", type: "person", source: "act" },
    ]) {
      expect(canCreateLabelForColumn(column).allowed, column.key).toBe(false);
    }
  });
});

describe("라벨 검색", () => {
  const options = [option("혁신성장자금"), option("신용취약소상공인자금"), option("재도전특별자금")];

  it("부분 일치(대소문자 무시)로 좁힌다", () => {
    expect(filterLabelOptions(options, "혁신").map((o) => o.id)).toEqual(["혁신성장자금"]);
    expect(filterLabelOptions(options, "자금").map((o) => o.id)).toHaveLength(3);
  });

  it("빈 쿼리면 전체, 없으면 빈 배열이다", () => {
    expect(filterLabelOptions(options, "")).toHaveLength(3);
    expect(filterLabelOptions(options, "없는라벨")).toEqual([]);
    expect(filterLabelOptions(null, "자금")).toEqual([]);
  });
});

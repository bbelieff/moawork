import { describe, expect, it } from "vitest";
import { ChecklistService, NoProductSelectedError } from "./service";

// store.ts 는 globalThis 인메모리라 테스트 리셋 훅이 없다 — 대신 테스트마다 서로 다른
// dealId/productId 를 써서 격리한다(org 격리 자체를 검증하는 마지막 describe 는 예외).
const ORG_A = "org-a";
const ORG_B = "org-b";

describe("ChecklistService — 상품 선택 → 프리셋 적용", () => {
  it("프리셋이 없는 상품은 productId 만 기록하고 항목은 비운다(직접 추가 가능)", () => {
    const svc = new ChecklistService(ORG_A);
    const state = svc.applyProduct("deal-1", "상품X");
    expect(state.productId).toBe("상품X");
    expect(state.items).toEqual([]);
  });

  it("관리자가 설정한 프리셋이 있으면 그대로 적용된다", () => {
    const svc = new ChecklistService(ORG_A);
    svc.setPreset("벤처인증", [{ label: "사업계획서" }, { label: "기술설명서" }]);
    const state = svc.applyProduct("deal-2", "벤처인증");
    expect(state.items.map((it) => it.label)).toEqual(["사업계획서", "기술설명서"]);
    expect(state.items.every((it) => !it.checked)).toBe(true);
  });

  it("상품을 다시 바꾸면 이전 항목이 통째로 새 상품 프리셋으로 교체된다", () => {
    const svc = new ChecklistService(ORG_A);
    svc.setPreset("상품A", [{ label: "서류1" }]);
    svc.setPreset("상품B", [{ label: "서류2" }, { label: "서류3" }]);
    svc.applyProduct("deal-3", "상품A");
    const switched = svc.applyProduct("deal-3", "상품B");
    expect(switched.items.map((it) => it.label)).toEqual(["서류2", "서류3"]);
  });
});

describe("ChecklistService — 체크·추가·삭제 및 완료율", () => {
  it("체크할 때마다 완료율이 즉시 바뀐다(수용 기준 2)", () => {
    const svc = new ChecklistService(ORG_A);
    svc.setPreset("상품C", [{ label: "a" }, { label: "b" }]);
    const applied = svc.applyProduct("deal-4", "상품C");
    expect(svc.completion("deal-4")).toEqual({ checked: 0, total: 2, percent: 0 });

    svc.toggleItem("deal-4", applied.items[0].id);
    expect(svc.completion("deal-4")).toEqual({ checked: 1, total: 2, percent: 50 });
  });

  it("추가한 항목도 완료율 분모에 들어간다", () => {
    const svc = new ChecklistService(ORG_A);
    svc.applyProduct("deal-5", "상품D"); // 프리셋 없음 → 빈 목록
    svc.addItem("deal-5", "직접 추가한 서류");
    expect(svc.completion("deal-5").total).toBe(1);
  });

  it("삭제하면 완료율 분모에서 빠진다", () => {
    const svc = new ChecklistService(ORG_A);
    svc.setPreset("상품E", [{ label: "a" }, { label: "b" }]);
    const applied = svc.applyProduct("deal-6", "상품E");
    svc.removeItem("deal-6", applied.items[1].id);
    expect(svc.completion("deal-6")).toEqual({ checked: 0, total: 1, percent: 0 });
  });

  it("저장된 적 없는 딜은 던지지 않고 빈 상태로 수렴한다", () => {
    const svc = new ChecklistService(ORG_A);
    expect(svc.getDealChecklist("never-touched")).toEqual({
      dealId: "never-touched",
      productId: null,
      items: [],
    });
    expect(svc.completion("never-touched")).toEqual({ checked: 0, total: 0, percent: 0 });
  });
});

describe("ChecklistService — 프리셋으로 저장(수용 기준 3)", () => {
  it("상품 미선택 상태에서 저장을 시도하면 거부한다(무엇의 프리셋인지 모름)", () => {
    const svc = new ChecklistService(ORG_A);
    svc.addItem("deal-7", "항목"); // applyProduct 없이 바로 추가 — productId 는 여전히 null
    expect(() => svc.saveAsPreset("deal-7")).toThrow(NoProductSelectedError);
  });

  it("딜에서 항목을 추가/삭제한 뒤 프리셋으로 저장하면 다음 딜에 그대로 적용된다", () => {
    const svc = new ChecklistService(ORG_A);
    svc.setPreset("상품F", [{ label: "기본서류" }]);
    const applied = svc.applyProduct("deal-8", "상품F");
    svc.removeItem("deal-8", applied.items[0].id);
    svc.addItem("deal-8", "새기본서류");
    svc.saveAsPreset("deal-8");

    const nextDeal = svc.applyProduct("deal-9", "상품F");
    expect(nextDeal.items.map((it) => it.label)).toEqual(["새기본서류"]);
  });

  it("프리셋 저장은 checked 상태를 담지 않는다(항상 미완료 템플릿)", () => {
    const svc = new ChecklistService(ORG_A);
    svc.setPreset("상품G", [{ label: "x" }]);
    const applied = svc.applyProduct("deal-10", "상품G");
    svc.toggleItem("deal-10", applied.items[0].id); // 체크함
    svc.saveAsPreset("deal-10");

    const reapplied = svc.applyProduct("deal-11", "상품G");
    expect(reapplied.items[0].checked).toBe(false);
  });
});

describe("ChecklistService — org 격리", () => {
  it("한 조직의 프리셋·딜 상태가 다른 조직에 새지 않는다", () => {
    const a = new ChecklistService(ORG_A);
    const b = new ChecklistService(ORG_B);
    a.setPreset("공용상품명", [{ label: "A조직서류" }]);

    const stateInB = b.applyProduct("deal-in-b", "공용상품명");
    expect(stateInB.items).toEqual([]); // B 조직엔 이 프리셋이 없다
  });
});

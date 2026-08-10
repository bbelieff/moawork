import { describe, expect, it } from "vitest";
import {
  addItem,
  applyPreset,
  completionOf,
  removeItem,
  toPresetItems,
  toggleItem,
} from "./engine";
import type { ChecklistItem, ChecklistPresetItem } from "./types";

const PRESET: ChecklistPresetItem[] = [
  { id: "doc-1-사업자등록증", label: "사업자등록증", order: 0 },
  { id: "doc-2-재무제표", label: "재무제표", order: 1 },
];

describe("applyPreset", () => {
  it("프리셋이 없으면 빈 목록(사용자가 직접 채운다)", () => {
    expect(applyPreset(null)).toEqual([]);
  });

  it("프리셋을 적용하면 전부 미완료로 시작한다", () => {
    const items = applyPreset(PRESET);
    expect(items).toHaveLength(2);
    expect(items.every((it) => it.checked === false)).toBe(true);
    expect(items.map((it) => it.label)).toEqual(["사업자등록증", "재무제표"]);
  });

  it("order 가 뒤섞인 프리셋도 order 순으로 정렬해 적용한다", () => {
    const shuffled: ChecklistPresetItem[] = [
      { id: "b", label: "B", order: 1 },
      { id: "a", label: "A", order: 0 },
    ];
    expect(applyPreset(shuffled).map((it) => it.label)).toEqual(["A", "B"]);
  });
});

describe("toggleItem / addItem / removeItem", () => {
  const base = applyPreset(PRESET);

  it("toggle 은 대상 항목만 뒤집고 나머지는 그대로", () => {
    const next = toggleItem(base, base[0].id);
    expect(next[0].checked).toBe(true);
    expect(next[1].checked).toBe(false);
    // 원본은 불변
    expect(base[0].checked).toBe(false);
  });

  it("없는 id 를 toggle 해도 조용히 원본과 동일한 배열을 돌려준다", () => {
    const next = toggleItem(base, "no-such-id");
    expect(next).toEqual(base);
  });

  it("addItem 은 끝에 미완료 상태로 추가한다", () => {
    const next = addItem(base, "부가세과세표준증명원");
    expect(next).toHaveLength(3);
    expect(next[2]).toMatchObject({ label: "부가세과세표준증명원", checked: false, order: 2 });
  });

  it("빈 라벨(공백만)은 추가되지 않는다", () => {
    expect(addItem(base, "   ")).toHaveLength(2);
  });

  it("removeItem 은 대상만 지우고 남은 항목의 order 를 재정렬한다", () => {
    const withThird = addItem(base, "계산서목록");
    const next = removeItem(withThird, withThird[0].id);
    expect(next.map((it) => it.label)).toEqual(["재무제표", "계산서목록"]);
    expect(next.map((it) => it.order)).toEqual([0, 1]);
  });
});

describe("completionOf — 표의 셀과 상세가 공유하는 유일한 계산 지점", () => {
  it("항목이 없으면 0/0/0%(다 함이 아니라 아직 없음)", () => {
    expect(completionOf([])).toEqual({ checked: 0, total: 0, percent: 0 });
  });

  it("일부 완료", () => {
    const items = toggleItem(applyPreset(PRESET), PRESET[0].id);
    expect(completionOf(items)).toEqual({ checked: 1, total: 2, percent: 50 });
  });

  it("반올림 — 1/3 은 33%", () => {
    const three: ChecklistItem[] = [
      { id: "1", label: "a", order: 0, checked: true },
      { id: "2", label: "b", order: 1, checked: false },
      { id: "3", label: "c", order: 2, checked: false },
    ];
    expect(completionOf(three).percent).toBe(33);
  });

  it("전부 완료면 100%", () => {
    let items = applyPreset(PRESET);
    for (const it of items) items = toggleItem(items, it.id);
    expect(completionOf(items)).toEqual({ checked: 2, total: 2, percent: 100 });
  });
});

describe("toPresetItems — checked 상태를 버리고 템플릿으로 변환", () => {
  it("checked 필드가 결과에 없다", () => {
    const items = toggleItem(applyPreset(PRESET), PRESET[0].id);
    const preset = toPresetItems(items);
    expect(preset).toEqual([
      { id: "doc-1-사업자등록증", label: "사업자등록증", order: 0 },
      { id: "doc-2-재무제표", label: "재무제표", order: 1 },
    ]);
    expect(preset.some((p) => "checked" in p)).toBe(false);
  });

  it("딜에서 자유롭게 추가한 항목도 그대로 프리셋에 포함된다", () => {
    const withExtra = addItem(applyPreset(PRESET), "신규 서류");
    const preset = toPresetItems(withExtra);
    expect(preset.map((p) => p.label)).toEqual(["사업자등록증", "재무제표", "신규 서류"]);
  });
});

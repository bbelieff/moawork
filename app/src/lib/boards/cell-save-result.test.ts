import { describe, expect, it } from "vitest";
import { cellSaveMessage, mergeSavedItem, patchCellValue } from "./cell-save-result";
import type { CellError } from "@/lib/boards/service";
import type { ItemWithValues } from "@/lib/boards/types";

// 합성 행은 필요한 칸만 채운다 — 나머지는 이 로직과 무관하다.
function row(over: Partial<ItemWithValues> = {}): ItemWithValues {
  return {
    id: "i1",
    title: "행",
    group_id: "g1",
    sort_order: 0,
    values: {},
    ...over,
  } as ItemWithValues;
}

function cellError(key: string, message: string): CellError {
  return { key, label: key, message };
}

describe("cellSaveMessage", () => {
  it("이 칸의 오류를 먼저 고른다", () => {
    const result = {
      ok: true as const,
      item: row(),
      errors: [cellError("other", "다른 칸"), cellError("memo", "메모 오류")],
      notices: [],
    };
    expect(cellSaveMessage(result, "memo")).toBe("메모 오류");
  });

  it("이 칸 오류가 없으면 첫 오류를 보여준다", () => {
    const result = {
      ok: true as const,
      item: row(),
      errors: [cellError("other", "다른 칸")],
      notices: [],
    };
    expect(cellSaveMessage(result, "memo")).toBe("다른 칸");
  });

  it("오류가 없고 저장이 됐으면 알림 문구를 보여준다", () => {
    const result = {
      ok: true as const,
      item: row(),
      errors: [],
      notices: [cellError("memo", "값만 저장했어요")],
    };
    expect(cellSaveMessage(result, "memo")).toBe("값만 저장했어요");
  });

  it("보여줄 게 없으면 null을 돌려준다", () => {
    const result = { ok: true as const, item: row(), errors: [], notices: [] };
    expect(cellSaveMessage(result, "memo")).toBeNull();
  });

  it("실패인데 오류가 없으면 null을 돌려준다", () => {
    expect(cellSaveMessage({ ok: false, errors: [] }, "memo")).toBeNull();
  });
});

describe("mergeSavedItem", () => {
  it("그룹·순서·상태는 서버 값을 따르고 제목은 화면 값을 둔다", () => {
    const view = row({
      title: "화면 제목",
      group_id: "g-view",
      sort_order: 1,
      value_statuses: { memo: "needs_review" },
    });
    const saved = row({
      title: "서버 제목",
      group_id: "g-server",
      sort_order: 5,
      value_statuses: { memo: "normalized" },
    });
    const merged = mergeSavedItem(view, saved);
    expect(merged.group_id).toBe("g-server");
    expect(merged.sort_order).toBe(5);
    expect(merged.title).toBe("화면 제목");
    expect(merged.value_statuses).toEqual({ memo: "normalized" });
  });

  it("칸 값은 화면 값 위에 서버 값을 덮어 합친다", () => {
    const view = row({ values: { memo: "화면", status: "화면 상태" } });
    const saved = row({ values: { memo: "서버" } });
    expect(mergeSavedItem(view, saved).values).toEqual({ memo: "서버", status: "화면 상태" });
  });

  it("서버에 상태가 없으면 화면 상태를 둔다", () => {
    const view = row({ value_statuses: { memo: "needs_review" } });
    expect(mergeSavedItem(view, row()).value_statuses).toEqual({ memo: "needs_review" });
  });
});

describe("patchCellValue", () => {
  it("지정한 행의 그 칸만 바꾼다", () => {
    const first = row({ id: "i1", values: { memo: "이전", status: "진행중" } });
    const second = row({ id: "i2", values: { memo: "그대로" } });
    const next = patchCellValue([first, second], { itemId: "i1", key: "memo", value: "다음" });
    expect(next[0]?.values).toEqual({ memo: "다음", status: "진행중" });
    expect(next[1]).toBe(second);
  });

  it("해당 행이 없으면 모든 행을 같은 참조로 둔다", () => {
    const first = row({ id: "i1", values: { memo: "이전" } });
    const second = row({ id: "i2", values: { memo: "그대로" } });
    const next = patchCellValue([first, second], { itemId: "nope", key: "memo", value: "다음" });
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(first);
    expect(next[1]).toBe(second);
  });
});

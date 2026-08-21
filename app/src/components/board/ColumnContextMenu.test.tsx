import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ColumnContextMenu.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./BoardWorkspace.tsx", import.meta.url), "utf8");

describe("ColumnContextMenu structure contract", () => {
  it("keeps all six operations in the product discovery order", () => {
    const labels = ["컬럼 복제", "오른쪽에 컬럼 추가", "컬럼 유형 변경", "컬럼 확장", "이름 바꾸기", "삭제"];
    const positions = labels.map((label) => source.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("shares context click, Shift+F10/Menu, Escape and roving focus paths", () => {
    for (const token of ["onContextMenu", 'event.shiftKey && event.key === "F10"', 'event.key === "ContextMenu"', 'event.key === "Escape"', 'event.key !== "ArrowDown"', 'role="menuitem"']) {
      expect(source).toContain(token);
    }
  });

  it("exposes settings/template slots and keeps value-copy opt-in", () => {
    expect(source).toContain("data-column-settings-slot");
    expect(source).toContain("data-column-template-slot");
    expect(source).toContain('submit("duplicate", { copyValues: data.copyValues ?? "false" })');
    expect(source).not.toContain('copyValues: "true"');
  });

  it("hands archive undo to the persistent board shell and moves focus into dialogs", () => {
    expect(source).toContain("onArchived?.(state.archivedColumnId)");
    expect(source).toContain('querySelector<HTMLElement>("input,select,button")?.focus()');
    expect(workspace).toContain("archivedColumnIds");
    expect(workspace).toContain("컬럼을 휴지통으로 옮겼습니다. 값과 설정은 보존됩니다.");
    expect(workspace).toContain('data.set("operation", "restore")');
    expect(workspace).toContain("next.delete(columnId)");
    expect(workspace).toContain("applyFilters(optimisticRows, activeColumns, filters)");
  });
});

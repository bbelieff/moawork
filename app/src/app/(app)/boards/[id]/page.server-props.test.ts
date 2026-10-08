import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8").replace(/\r\n/gu, "\n");

// page.tsx is a Server Component. A function created here cannot be serialized to a
// Client Component prop; the kanban switch failed to load this way (#747).
describe("board page server-to-client props", () => {
  it("stays a Server Component", () => {
    expect(source).not.toMatch(/^\s*["']use client["']/mu);
  });

  it("never passes an inline function as a JSX prop", () => {
    const inline = source.match(/\b[A-Za-z][\w]*=\{\s*(?:async\s+)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>/gu) ?? [];
    const functions = source.match(/\b[A-Za-z][\w]*=\{\s*(?:async\s+)?function\b/gu) ?? [];
    expect([...inline, ...functions]).toEqual([]);
  });

  // #845 — 칸반 레인 기준은 보기 줄 「나눠 보기」 하나로 고른다. 서버가 그린 「그룹 기준」 줄은 주소가
  // 그려질 때의 조건(mwFilters)을 박아 두어, 조건을 바꾼 뒤 누르면 예전 조건으로 돌아갔다.
  it("has no separate kanban 「그룹 기준」 strip — grouping lives in the view bar", () => {
    expect(source).not.toContain("그룹 기준");
    expect(source).not.toContain("boardViewSwitchUrl");
    const kanban = source.match(/<KanbanViewWorkspace\b[\s\S]*?\/>/u)?.[0] ?? "";
    expect(kanban).toContain("groupBy={groupBy}");
    expect(kanban).toContain("groupByOptions={groupByOptions}");
  });
});

import { describe, expect, it, vi } from "vitest";

/**
 * BBE-177 — 삭제 확인 폼이 서버 관문과 같은 말을 쓰는지 고정한다.
 *
 * 서버 테스트(column-delete-actions.test.ts)는 액션을 직접 부르므로 «화면이 무엇을
 * 보내는가» 는 재지 못한다. 그래서 확인 문자열을 서버에서만 바꾸면 서버 테스트는
 * 통과하는데 실제 버튼은 죽는다. 그 구멍을 이 파일이 막는다.
 *
 * 무엇을 깨뜨리면 빨개지는가:
 *  ① hidden 값을 상수가 아닌 리터럴로 바꿔치면                → 2번이 실패한다
 *     (상수 COLUMN_DELETE_CONFIRM 자체를 고치면 양쪽이 같이 움직이므로 통과한다 —
 *      이 테스트가 지키는 것은 특정 문자열이 아니라 «두 곳이 한 출처를 본다» 는 성질이다)
 *  ② 확인 없이 바로 제출하는 삭제 폼을 다시 넣으면              → 3번이 실패한다
 *  ③ 무엇이 사라지는지 알리는 문구를 지우면                     → 1번이 실패한다
 */

vi.mock("@/app/(app)/boards/actions", () => ({
  addColumnAction: vi.fn(),
  deleteColumnAction: vi.fn(),
}));

import { deleteColumnAction } from "@/app/(app)/boards/actions";
import { ColumnEditor } from "./ColumnEditor";
import { COLUMN_DELETE_CONFIRM } from "@/lib/boards/validation";
import type { BoardColumn } from "@/lib/boards/types";

const column: BoardColumn = {
  id: "col-a",
  org_id: "org-a",
  board_id: "board-a",
  key: "memo",
  label: "메모",
  type: "text",
  source: "in",
  rightPinned: false,
  options_jsonb: null,
  sort_order: 0,
  width: null,
};

/** 렌더 트리를 훑어 조건에 맞는 엘리먼트를 모은다(DOM 없이 구조만 본다). */
function collect(node: unknown, keep: (el: { type: unknown; props: Record<string, unknown> }) => boolean): Array<{ type: unknown; props: Record<string, unknown> }> {
  const out: Array<{ type: unknown; props: Record<string, unknown> }> = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== "object") return;
    const el = n as { type: unknown; props?: Record<string, unknown> };
    if (!("props" in el)) return;
    const props = el.props ?? {};
    if (keep({ type: el.type, props })) out.push({ type: el.type, props });
    walk(props.children);
  };
  walk(node);
  return out;
}

function text(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const el = node as { props?: Record<string, unknown> };
  return el.props ? text(el.props.children) : "";
}

describe("BBE-177 컬럼 삭제 확인 폼", () => {
  const tree = ColumnEditor({ boardId: "board-a", columns: [column] });

  it("무엇이 사라지고 무엇이 남는지 먼저 말한다", () => {
    const rendered = text(tree);
    expect(rendered).toContain("컬럼을 삭제할까요?");
    expect(rendered).toContain("이미 입력한 값 자체는 지워지지 않습니다");
  });

  it("삭제 폼은 서버가 요구하는 확인 값을 그대로 싣는다", () => {
    const forms = collect(tree, (el) => el.type === "form" && el.props.action === deleteColumnAction);
    expect(forms).toHaveLength(1);
    const inputs = collect(forms[0].props.children, (el) => el.type === "input");
    const byName = Object.fromEntries(inputs.map((i) => [String(i.props.name), i.props.value] as [string, unknown]));
    expect(byName.confirm).toBe(COLUMN_DELETE_CONFIRM);
    expect(byName.boardId).toBe("board-a");
    expect(byName.columnId).toBe("col-a");
  });

  it("확인을 건너뛰는 삭제 폼은 없다", () => {
    const forms = collect(tree, (el) => el.type === "form" && el.props.action === deleteColumnAction);
    for (const form of forms) {
      const confirms = collect(form.props.children, (el) => el.type === "input" && el.props.name === "confirm");
      expect(confirms).toHaveLength(1);
    }
  });
});

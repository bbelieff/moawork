/**
 * #845 7단계 — 나눠 보기 묶음 만들기: 선택지·구성원 순서, 모르는 값은 그 뒤, 「(없음)」 은 맨 끝,
 * 묶음 안은 보드 순서 → 보드 안 순서. 보드별(기본) 블록은 그대로다.
 */
import { describe, expect, it } from "vitest";
import type { BoardColumn, BoardGroup, ItemWithValues } from "@/lib/boards/types";
import { buildBlocks, buildValueBlocks, valueBlockKey } from "./blocks";

const groups = [
  { id: "g2", org_id: "o", board_id: "b", name: "진행중", color: null, sort_order: 1 },
  { id: "g1", org_id: "o", board_id: "b", name: "준비단계", color: null, sort_order: 0 },
] as BoardGroup[];

const institution = {
  id: "c-inst", org_id: "o", board_id: "b", key: "institution", label: "진행기관", type: "select", source: "act",
  rightPinned: false, sort_order: 0, width: null, move_rule_jsonb: null,
  options_jsonb: { options: [
    { id: "kodit", label: "신용보증기금", color: "#579bfc" },
    { id: "kibo", label: "기술보증기금", color: "#00c875" },
    { id: "semas", label: "소진공" },
  ] },
} as BoardColumn;
const owner = { ...institution, id: "c-owner", key: "owner", label: "담당자", type: "person", options_jsonb: null } as BoardColumn;

const row = (id: string, groupId: string | null, sort: number, values: ItemWithValues["values"], assigned: string | null = null): ItemWithValues => ({
  id, org_id: "o", board_id: "b", group_id: groupId, title: id, assigned_to: assigned, deal_id: null,
  sort_order: sort, created_at: "", updated_at: "", values,
});

describe("buildValueBlocks — 목록·상태 칸", () => {
  const rows = [
    row("a", "g2", 0, { institution: "kibo" }),
    row("b", "g1", 1, { institution: "kibo" }),
    row("c", "g1", 0, { institution: "kibo" }),
    row("d", "g1", 2, {}),
    row("e", null, 0, { institution: "legacy-id" }),
    row("f", "g2", 1, { institution: "kodit" }),
  ];
  const blocks = buildValueBlocks({ column: institution, groups, rows });

  it("선택지 순서 → 모르는 값 → 「(없음)」 맨 끝. 빈 선택지도 묶음으로 남긴다(놓을 자리)", () => {
    expect(blocks.map((block) => [block.name, block.rows.length])).toEqual([
      ["신용보증기금", 1],
      ["기술보증기금", 3],
      ["소진공", 0],
      ["legacy-id", 1],
      ["(없음)", 1],
    ]);
    expect(blocks.at(-1)!.groupValue).toEqual({ columnKey: "institution", id: null, accent: null });
    expect(blocks.at(-1)!.key).toBe(valueBlockKey("institution", null));
  });

  it("묶음 안의 행은 보드 순서(sort_order 0 인 준비단계 먼저) → 보드 안 순서", () => {
    expect(blocks[1].rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("묶음은 보드가 아니다 — group 은 null, 띠 색은 선택지 색", () => {
    expect(blocks.every((block) => block.group === null)).toBe(true);
    expect(blocks[0].groupValue?.accent).toBeTruthy();
    expect(blocks[3].groupValue?.accent).toBeNull();
  });
});

describe("buildValueBlocks — 사람 칸", () => {
  it("구성원 순서 → 목록에 없는 사람(이름은 아는 대로) → 「(없음)」", () => {
    const rows = [
      row("a", "g1", 0, { owner: "u2" }),
      row("b", "g1", 1, { owner: "gone" }),
      row("c", "g1", 2, {}),
    ];
    const blocks = buildValueBlocks({
      column: owner,
      groups,
      rows,
      members: [{ id: "u1", label: "가나" }, { id: "u2", label: "다라" }],
      memberLabels: { gone: "나간 사람" },
    });
    expect(blocks.map((block) => [block.name, block.rows.map((r) => r.id)])).toEqual([
      ["가나", []],
      ["다라", ["a"]],
      ["나간 사람", ["b"]],
      ["(없음)", ["c"]],
    ]);
    expect(blocks.every((block) => block.groupValue?.accent === null)).toBe(true);
  });

  it("배정 담당(신규리드)은 assigned_to 로 묶는다", () => {
    const blocks = buildValueBlocks({
      column: owner,
      groups,
      rows: [row("a", "g1", 0, { owner: "stale" }, "u1")],
      members: [{ id: "u1", label: "가나" }],
      ownerMode: "always",
    });
    expect(blocks[0].rows.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("보드별(기본)은 그대로", () => {
  it("buildBlocks 는 보드 순서 그대로 · 값 묶음 표시가 없다", () => {
    const blocks = buildBlocks(groups, [row("a", "g2", 0, {}), row("b", "g1", 0, {})]);
    expect(blocks.map((block) => block.name)).toEqual(["준비단계", "진행중"]);
    expect(blocks.every((block) => block.groupValue === undefined)).toBe(true);
  });
});

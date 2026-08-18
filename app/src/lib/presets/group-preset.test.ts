import { describe, expect, it } from "vitest";
import type { BoardColumn, BoardGroup } from "@/lib/boards/types";
import type { SectionPresetColumn } from "./section-presets";
import {
  appliedColumnOrder,
  groupPresetName,
  groupPresetRequestSource,
  isGroupPresetChanged,
  previewGroupPresetApply,
  snapshotGroupPreset,
} from "./group-preset";

function column(key: string, patch: Partial<BoardColumn> = {}): BoardColumn {
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
    move_rule_jsonb: null,
    is_readonly: false,
    ...patch,
  };
}

function presetColumn(key: string, patch: Partial<SectionPresetColumn> = {}): SectionPresetColumn {
  return {
    key,
    label: key,
    type: "text",
    source: "in",
    rightPinned: false,
    options: [],
    width: null,
    move_rule_jsonb: null,
    is_readonly: false,
    ...patch,
  };
}

const group: Pick<BoardGroup, "name" | "color"> = { name: "1차 부재", color: "#4f46e5" };

describe("groupPresetName", () => {
  it("칩과 저장 기본값이 같은 `탭-그룹` 이름을 쓴다", () => {
    expect(groupPresetName("신규리드 관리", "1차 부재")).toBe("신규리드 관리-1차 부재");
  });
});

describe("snapshotGroupPreset", () => {
  it("그룹 하나만 담고, 컬럼 메타데이터 7종을 그대로 보존한다", () => {
    const columns = [
      column("consult_status", {
        type: "select",
        source: "act",
        options_jsonb: { options: [{ id: "before", label: "상담 전" }] },
        move_rule_jsonb: { before: "group-new" },
      }),
      column("contact_move", { rightPinned: true, type: "status", width: 120, is_readonly: true }),
    ];

    const snapshot = snapshotGroupPreset("신규리드 관리-1차 부재", group, columns);

    expect(snapshot.name).toBe("신규리드 관리-1차 부재");
    expect(snapshot.groups).toEqual([{ name: "1차 부재", color: "#4f46e5" }]);
    // key · type · options · source · order · rightPinned · move rule (수용기준)
    expect(snapshot.columns.map((c) => c.key)).toEqual(["consult_status", "contact_move"]);
    expect(snapshot.columns[0].type).toBe("select");
    expect(snapshot.columns[0].source).toBe("act");
    expect(snapshot.columns[0].options).toEqual([{ id: "before", label: "상담 전" }]);
    expect(snapshot.columns[0].move_rule_jsonb).toEqual({ before: "group-new" });
    expect(snapshot.columns[1].rightPinned).toBe(true);
    expect(snapshot.columns[1].width).toBe(120);
    expect(snapshot.columns[1].is_readonly).toBe(true);
  });

  it("보드 기본 순서가 아니라 넘겨받은 «보이는 순서» 를 담는다", () => {
    const boardOrder = [column("a"), column("b"), column("c")];
    const groupOrder = [boardOrder[2], boardOrder[0], boardOrder[1]];

    expect(snapshotGroupPreset("p", group, groupOrder).columns.map((c) => c.key)).toEqual(["c", "a", "b"]);
  });
});

describe("previewGroupPresetApply — 값 유실 0", () => {
  it("보드에만 있는 컬럼은 지우지 않고 배치 뒤쪽에 남긴다", () => {
    const target = [column("keep_me"), column("shared")];
    const preview = previewGroupPresetApply([presetColumn("shared"), presetColumn("brand_new")], target, undefined);

    expect(preview.kept.map((c) => c.key)).toEqual(["keep_me"]);
    expect(preview.nextOrder).toContain("keep_me");
    // 적용 후 배치에는 기존 컬럼이 하나도 빠지지 않는다 → item_values 가 고아가 되지 않는다.
    for (const existing of target) expect(preview.nextOrder).toContain(existing.key);
  });

  it("배치 길이는 «기존 컬럼 + 새 컬럼» 이라 절대 줄지 않는다 (§9.3 구조 축소 금지)", () => {
    const target = [column("a"), column("b"), column("c")];
    const preview = previewGroupPresetApply([presetColumn("b"), presetColumn("d")], target, undefined);

    expect(preview.nextOrder).toHaveLength(target.length + preview.added.length);
    expect(preview.nextOrder.length).toBeGreaterThanOrEqual(target.length);
    expect(new Set(preview.nextOrder).size).toBe(preview.nextOrder.length);
  });

  it("같은 key 가 이미 있으면 다시 만들지 않는다 — 중복 컬럼도, 덮어쓰기도 없다", () => {
    const target = [column("phone", { type: "phone", label: "연락처" })];
    const preview = previewGroupPresetApply([presetColumn("phone", { type: "text", label: "전화" })], target, undefined);

    expect(preview.added).toEqual([]);
    expect(preview.reused).toEqual([{ key: "phone", label: "연락처", differs: true }]);
  });

  it("타입·선택지·이동규칙이 달라도 differs 로 «알리기만» 하고 구조는 건드리지 않는다", () => {
    const target = [
      column("status", {
        type: "select",
        options_jsonb: { options: [{ id: "a", label: "A" }] },
        move_rule_jsonb: { a: "g1" },
      }),
    ];

    const same = previewGroupPresetApply(
      [presetColumn("status", { type: "select", options: [{ id: "a", label: "다른 이름" }], move_rule_jsonb: { a: "g1" } })],
      target,
      undefined,
    );
    expect(same.reused[0].differs).toBe(false);

    const movedRule = previewGroupPresetApply(
      [presetColumn("status", { type: "select", options: [{ id: "a", label: "A" }], move_rule_jsonb: { a: "g2" } })],
      target,
      undefined,
    );
    expect(movedRule.reused[0].differs).toBe(true);
    expect(movedRule.added).toEqual([]);

    const pinned = previewGroupPresetApply(
      [presetColumn("status", { type: "select", options: [{ id: "a", label: "A" }], move_rule_jsonb: { a: "g1" }, rightPinned: true })],
      target,
      undefined,
    );
    expect(pinned.reused[0].differs).toBe(true);
  });

  it("새 컬럼은 프리셋 순서대로 앞에, 남은 컬럼은 보드 기본 순서대로 뒤에 놓는다", () => {
    const target = [column("a"), column("b"), column("c")];
    const preview = previewGroupPresetApply([presetColumn("c"), presetColumn("new")], target, undefined);

    expect(preview.nextOrder).toEqual(["c", "new", "a", "b"]);
    expect(preview.added.map((c) => c.key)).toEqual(["new"]);
  });

  it("프리셋 안에 같은 key 가 두 번 있어도 배치에 한 번만 들어간다", () => {
    const target = [column("a")];
    const preview = previewGroupPresetApply([presetColumn("dup"), presetColumn("dup"), presetColumn("a")], target, undefined);

    expect(preview.nextOrder).toEqual(["dup", "a"]);
    expect(preview.added.map((c) => c.key)).toEqual(["dup"]);
  });

  it("프리셋이 보드와 완전히 같으면 추가도 없고 배치도 그대로다", () => {
    const target = [column("a")];
    const preview = previewGroupPresetApply([presetColumn("a")], target, undefined);
    expect(preview.added).toEqual([]);
    expect(preview.nextOrder).toEqual(["a"]);
  });

  it("바뀌는 게 없으면 noop 이다", () => {
    const target = [column("a"), column("b")];
    expect(previewGroupPresetApply([presetColumn("a"), presetColumn("b")], target, undefined).noop).toBe(true);
    expect(previewGroupPresetApply([presetColumn("b"), presetColumn("a")], target, undefined).noop).toBe(false);
    // 이미 그 순서로 오버라이드가 저장돼 있으면 다시 적용해도 noop.
    expect(previewGroupPresetApply([presetColumn("b"), presetColumn("a")], target, ["b", "a"]).noop).toBe(true);
  });

  it("오버라이드에 남은 삭제된 컬럼의 잔재는 현재 순서 판정에서 무시한다", () => {
    const target = [column("a"), column("b")];
    expect(previewGroupPresetApply([presetColumn("a"), presetColumn("b")], target, ["gone", "a", "b"]).noop).toBe(true);
  });
});

describe("appliedColumnOrder — 실행 후 저장할 배치", () => {
  it("프리셋이 잡은 순서 뒤에 남은 보드 컬럼을 붙인다", () => {
    const target = [column("a"), column("b"), column("c")];
    expect(appliedColumnOrder(["c"], target)).toEqual(["c", "a", "b"]);
  });

  it("보드 컬럼은 하나도 빠지지 않는다 — 구조 축소의 마지막 잠금", () => {
    const target = [column("a"), column("b"), column("c")];
    const order = appliedColumnOrder(["z_2"], target);

    expect(order).toEqual(["z_2", "a", "b", "c"]);
    for (const existing of target) expect(order).toContain(existing.key);
  });

  it("중복 key 를 배치에 두 번 넣지 않는다", () => {
    const target = [column("a")];
    expect(appliedColumnOrder(["a", "a"], target)).toEqual(["a"]);
  });

  it("프리셋이 잡은 것이 없으면 보드 기본 순서 그대로다", () => {
    const target = [column("a"), column("b")];
    expect(appliedColumnOrder([], target)).toEqual(["a", "b"]);
  });
});

describe("isGroupPresetChanged", () => {
  it("오버라이드가 있으면 «변경됨», 비우면 기본으로 돌아온다", () => {
    expect(isGroupPresetChanged(undefined)).toBe(false);
    expect(isGroupPresetChanged([])).toBe(false);
    expect(isGroupPresetChanged(["a"])).toBe(true);
  });
});

describe("groupPresetRequestSource — replay 중복 0", () => {
  it("같은 요청이면 같은 source, 다른 요청이면 다른 source", () => {
    const a = groupPresetRequestSource("org-a", "board-a", "group-a", "req-1");
    expect(groupPresetRequestSource("org-a", "board-a", "group-a", "req-1")).toBe(a);
    expect(groupPresetRequestSource("org-a", "board-a", "group-a", "req-2")).not.toBe(a);
    expect(groupPresetRequestSource("org-b", "board-a", "group-a", "req-1")).not.toBe(a);
    expect(groupPresetRequestSource("org-a", "board-b", "group-a", "req-1")).not.toBe(a);
    expect(groupPresetRequestSource("org-a", "board-a", "group-b", "req-1")).not.toBe(a);
  });

  it("프리셋 보드로 인식되는 source 접두사를 유지한다", () => {
    expect(groupPresetRequestSource("org-a", "board-a", "group-a", "req-1")).toMatch(/^user\.section-preset\//);
  });

  it("구분자가 값에 섞여도 경계가 흐려지지 않는다", () => {
    const a = groupPresetRequestSource("org", "board", "group:x", "req");
    const b = groupPresetRequestSource("org", "board", "group", "x:req");
    expect(a).not.toBe(b);
  });
});

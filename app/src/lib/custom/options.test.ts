import { describe, it, expect } from "vitest";
import type { FieldOption } from "./domain-types";
import {
  addOption,
  renameOption,
  recolorOption,
  reorderOptions,
  archiveOption,
  unarchiveOption,
  activeOptions,
  findOrphanOptionIds,
} from "./options";
import { ValidationError } from "./field-types";

function seqGen() {
  let n = 0;
  return () => `opt-${++n}`;
}

describe("options: add", () => {
  it("issues opaque id and appends with next order", () => {
    const gen = seqGen();
    let o: FieldOption[] = [];
    o = addOption(o, { label: "상담중" }, gen);
    o = addOption(o, { label: "계약대기", color: "#f00" }, gen);
    expect(o).toEqual([
      { id: "opt-1", label: "상담중", order: 1 },
      { id: "opt-2", label: "계약대기", order: 2, color: "#f00" },
    ]);
  });
  it("rejects blank label", () => {
    expect(() => addOption([], { label: "  " }, seqGen())).toThrow(ValidationError);
  });
});

describe("options: id stability (핵심 불변식)", () => {
  it("rename/recolor/reorder never change ids — 저장값 안전", () => {
    const gen = seqGen();
    let o = addOption(addOption([], { label: "A" }, gen), { label: "B" }, gen);
    const idsBefore = o.map((x) => x.id);

    o = renameOption(o, "opt-1", "가나다");
    o = recolorOption(o, "opt-2", "#0f0");
    o = reorderOptions(o, ["opt-2", "opt-1"]);

    expect(o.map((x) => x.id).sort()).toEqual(idsBefore.sort());
    expect(o.find((x) => x.id === "opt-1")?.label).toBe("가나다");
    expect(o.find((x) => x.id === "opt-2")?.color).toBe("#0f0");
    // reorder 반영
    expect(o[0].id).toBe("opt-2");
    expect(o[0].order).toBe(0);
  });
  it("rename/archive on unknown id throws", () => {
    expect(() => renameOption([], "nope", "x")).toThrow(ValidationError);
    expect(() => archiveOption([], "nope")).toThrow(ValidationError);
  });
});

describe("options: reorder partial", () => {
  it("puts unlisted options after, keeping relative order", () => {
    const gen = seqGen();
    let o = [1, 2, 3].reduce((acc) => addOption(acc, { label: "x" }, gen), [] as FieldOption[]);
    o = reorderOptions(o, ["opt-3"]);
    expect(o.map((x) => x.id)).toEqual(["opt-3", "opt-1", "opt-2"]);
    expect(o.map((x) => x.order)).toEqual([0, 1, 2]);
  });
});

describe("options: archive/active", () => {
  it("archive hides from active list but keeps entry", () => {
    const gen = seqGen();
    let o = addOption(addOption([], { label: "A" }, gen), { label: "B" }, gen);
    o = archiveOption(o, "opt-2");
    expect(activeOptions(o).map((x) => x.id)).toEqual(["opt-1"]);
    expect(o).toHaveLength(2);
    o = unarchiveOption(o, "opt-2");
    expect(activeOptions(o).map((x) => x.id)).toEqual(["opt-1", "opt-2"]);
  });
});

describe("options: orphan detection", () => {
  it("finds used ids not in the option set", () => {
    const o: FieldOption[] = [{ id: "opt-1", label: "A", order: 0 }];
    expect(findOrphanOptionIds(o, ["opt-1", "gone", "gone"])).toEqual(["gone"]);
    expect(findOrphanOptionIds(o, ["opt-1"])).toEqual([]);
  });
});

/**
 * #845 7단계 — 나눠 보기 규칙: 어떤 칸으로 나누나 · 행이 어느 묶음에 드나 · 다른 묶음으로 옮기면 값이 무엇이 되나.
 */
import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  groupByChoiceLabel,
  groupValueEditBlock,
  groupValueOf,
  isTableGroupColumn,
  isTransitionGroupValue,
  movedGroupValue,
  ownerModeForSource,
  parseGroupCellValue,
  prefillGroupValue,
} from "./group-by";
import { CONTRACT_WORK_TAB_SOURCE } from "@/lib/default-tabs/contract-work";
import { CONTACT_TAB_SOURCE, NEW_LEAD_TAB_SOURCE } from "@/lib/default-tabs/types";
import { WORKFLOW_PROGRESS_KEY } from "@/lib/workflow/progress";

const column = (key: string, type: string, extra: Partial<BoardColumn> = {}): BoardColumn => ({
  id: `c-${key}`, org_id: "o", board_id: "b", key, label: key, type, source: "act", rightPinned: false,
  sort_order: 0, width: null, options_jsonb: null, move_rule_jsonb: null, ...extra,
} as BoardColumn);
const row = (values: ItemWithValues["values"], over: Partial<ItemWithValues> = {}) =>
  ({ values, assigned_to: null, deal_id: null, ...over }) as Pick<ItemWithValues, "values" | "assigned_to" | "deal_id">;

describe("나눌 수 있는 칸", () => {
  it("사람·사람 여럿·목록·상태 칸만 — 가상 진행현황·글자·날짜·여러 선택은 아니다", () => {
    expect(["person", "people", "select", "status"].map((type) => isTableGroupColumn(column("x", type)))).toEqual([true, true, true, true]);
    expect(["text", "date", "multiselect", "money"].map((type) => isTableGroupColumn(column("x", type)))).toEqual([false, false, false, false]);
    expect(isTableGroupColumn(column(WORKFLOW_PROGRESS_KEY, "status"))).toBe(false);
    expect(isTableGroupColumn(column("consultation_progress", "text"))).toBe(false);
    expect(groupByChoiceLabel("진행기관")).toBe("진행기관별로 나눠 보기");
  });
});

describe("행이 드는 묶음", () => {
  it("목록·사람은 값 그대로, 사람 여럿은 첫 사람, 빈 값은 null", () => {
    expect(groupValueOf(column("inst", "select"), row({ inst: "kodit" }))).toBe("kodit");
    expect(groupValueOf(column("inst", "select"), row({ inst: "" }))).toBeNull();
    expect(groupValueOf(column("inst", "select"), row({}))).toBeNull();
    expect(groupValueOf(column("team", "people"), row({ team: ["u2", "u1"] }))).toBe("u2");
    expect(groupValueOf(column("team", "people"), row({ team: [] }))).toBeNull();
  });

  it("배정으로 관리되는 담당은 assigned_to 를 읽는다 — 신규리드는 모든 행, 리드컨택·실무는 딜에 묶인 행", () => {
    const owner = column("owner", "person");
    expect(groupValueOf(owner, row({ owner: "eav" }, { assigned_to: "assigned" }), "always")).toBe("assigned");
    expect(groupValueOf(owner, row({ owner: "eav" }, { assigned_to: "assigned", deal_id: "d1" }), "deal")).toBe("assigned");
    expect(groupValueOf(owner, row({ owner: "eav" }, { assigned_to: "assigned" }), "deal")).toBe("eav");
    expect(groupValueOf(owner, row({ owner: "eav" }, { assigned_to: "assigned" }), "never")).toBe("eav");
    expect(ownerModeForSource(NEW_LEAD_TAB_SOURCE)).toBe("always");
    expect(ownerModeForSource(CONTACT_TAB_SOURCE)).toBe("deal");
    expect(ownerModeForSource(CONTRACT_WORK_TAB_SOURCE)).toBe("deal");
    expect(ownerModeForSource("user")).toBe("never");
  });
});

describe("다른 묶음으로 옮긴 값 · 미리 넣는 값", () => {
  it("목록·사람은 그 값, 「(없음)」 은 비운다", () => {
    expect(movedGroupValue(column("inst", "select"), "a", "b")).toBe("b");
    expect(movedGroupValue(column("owner", "person"), "u1", null)).toBeNull();
  });

  it("사람 여럿은 첫 사람만 바꾸고 나머지는 둔다(겹치면 하나로)", () => {
    expect(movedGroupValue(column("team", "people"), ["u1", "u2", "u3"], "u4")).toEqual(["u4", "u2", "u3"]);
    expect(movedGroupValue(column("team", "people"), ["u1", "u2"], "u2")).toEqual(["u2"]);
    expect(movedGroupValue(column("team", "people"), null, "u2")).toEqual(["u2"]);
    expect(prefillGroupValue(column("team", "people"), "u2")).toEqual(["u2"]);
    expect(prefillGroupValue(column("inst", "status"), "s1")).toBe("s1");
  });

  it("서버로 보낸 값(JSON)을 칸 종류에 맞게 읽고, 맞지 않으면 undefined", () => {
    expect(parseGroupCellValue("select", JSON.stringify("a"))).toBe("a");
    expect(parseGroupCellValue("person", "null")).toBeNull();
    expect(parseGroupCellValue("people", JSON.stringify(["u1", "u1", "u2"]))).toEqual(["u1", "u2"]);
    expect(parseGroupCellValue("people", JSON.stringify("u1"))).toBeUndefined();
    expect(parseGroupCellValue("select", JSON.stringify(["a"]))).toBeUndefined();
    expect(parseGroupCellValue("select", "{not json")).toBeUndefined();
  });
});

describe("끌기·미리 채우기로 바꿀 수 없는 칸", () => {
  it("고칠 수 없는 칸 · ✉ 발송 칸 · 신규리드 정본 · 배정 담당은 막고 까닭을 한 줄로 말한다", () => {
    expect(groupValueEditBlock(column("inst", "select"))).toBeNull();
    expect(groupValueEditBlock(column("calc", "status", { source: "calc" }))).toBe("고칠 수 없는 칸이에요.");
    expect(groupValueEditBlock(column("biz", "select", { is_readonly: true }))).toBe("고칠 수 없는 칸이에요.");
    expect(groupValueEditBlock(column("sms", "status", { source: "msg" }))).toBe("문자가 나가는 칸은 칸에서 바꿔요.");
    expect(groupValueEditBlock(column("inst", "select"), { canonicalNewLead: true })).toBe("이 탭에서는 칸에서 바꿔요.");
    expect(groupValueEditBlock(column("owner", "person"), { ownerMode: "deal" })).toBe("담당은 담당 칸에서 바꿔요.");
    expect(groupValueEditBlock(column("owner", "person"), { ownerMode: "never" })).toBeNull();
    expect(groupValueEditBlock(column("memo", "text"))).toBe("이 칸으로는 나눌 수 없어요.");
  });

  it("넘기기 값(컨택 이동·리드컨택으로 넘기기)은 칸의 확인 흐름으로만", () => {
    expect(isTransitionGroupValue("contact_move", "컨택 이동")).toBe(true);
    expect(isTransitionGroupValue("consult_status", "리드컨택으로 넘기기")).toBe(true);
    expect(isTransitionGroupValue("consult_status", "상담 전")).toBe(false);
  });
});

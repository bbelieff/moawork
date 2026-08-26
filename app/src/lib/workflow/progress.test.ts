import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { presentWorkflowProgressColumns, withWorkflowProgressValues, WORKFLOW_PROGRESS_KEY } from "./progress";

function column(key: string, rightPinned = false): BoardColumn {
  return {
    id: key,
    org_id: "org",
    board_id: "board",
    key,
    label: key,
    type: "status",
    source: "act",
    rightPinned,
    options_jsonb: { options: [{ id: "대기", label: "대기", color: "#999" }, { id: "리드컨택으로 넘기기", label: "리드컨택으로 넘기기", color: "#0a0" }] },
    sort_order: 0,
    width: 120,
  };
}

describe("workflow progress presentation", () => {
  it("collapses new-lead stage and transfer columns into one right-pinned progress column", () => {
    const shown = presentWorkflowProgressColumns("new-lead", [column("phone"), column("consult_status"), column("contact_move", true)]);
    expect(shown.map((entry) => entry.key)).toEqual(["phone", WORKFLOW_PROGRESS_KEY]);
    expect(shown.at(-1)).toMatchObject({ label: "진행현황", rightPinned: true });
    expect(shown.at(-1)?.options_jsonb?.options.map((option) => option.id)).toEqual(["대기"]);
  });

  it("keeps stored stage values while exposing the unified display value", () => {
    const row = {
      id: "item",
      org_id: "org",
      board_id: "board",
      group_id: null,
      title: "회사",
      assigned_to: null,
      deal_id: null,
      sort_order: 0,
      created_at: "",
      updated_at: "",
      values: { consult_status: "대기", contact_move: "컨택 대기" },
    } satisfies ItemWithValues;
    const [shown] = withWorkflowProgressValues("new-lead", [row]);
    expect(shown.values).toMatchObject({ consult_status: "대기", contact_move: "컨택 대기", workflow_progress: "대기" });
  });

  it("does not invent a column when the canonical stage column is absent", () => {
    expect(presentWorkflowProgressColumns("contact", [column("phone")]).map((entry) => entry.key)).toEqual(["phone"]);
  });
});

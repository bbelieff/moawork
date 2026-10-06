import { describe, expect, it } from "vitest";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import {
  presentWorkflowProgressColumns,
  withWorkflowProgressValues,
  workflowProgressSpec,
  workflowStageMoveTargets,
  WORKFLOW_PROGRESS_KEY,
} from "./progress";

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

  it("presents a neutral consultation destination without changing the stored transition value", () => {
    expect(workflowProgressSpec("new-lead")).toMatchObject({
      transitionValue: "리드컨택으로 넘기기",
      transitionLabel: "상담관리로 넘기기",
      targetLabel: "상담관리",
      targetHref: "/contract",
    });
  });

  it("reads move targets from the raw stage column even though the presented column drops the rule", () => {
    const raw = {
      ...column("progress_status"),
      move_rule_jsonb: { "심사 중": "g-review", "📂소진공 혁신성장 대기": "g-gone" },
    } satisfies BoardColumn;
    const presented = presentWorkflowProgressColumns("work", [raw]).at(-1);
    expect(presented?.move_rule_jsonb).toBeNull();

    const targets = workflowStageMoveTargets("work", [raw], [{ id: "g-review", name: "🔂 심사 중", accent: "var(--mw-tab-a-4)" }]);
    // 보드에 없는 그룹(g-gone)을 가리키는 규칙은 이동 대상이 아니다 — 서버도 값만 저장한다(#845).
    expect([...targets.entries()]).toEqual([
      ["심사 중", { groupId: "g-review", groupName: "🔂 심사 중", accent: "var(--mw-tab-a-4)" }],
    ]);
    expect(targets.has("📂소진공 혁신성장 대기")).toBe(false);
    // 톤을 모르면 accent 는 null(선택지 색은 상태 팔레트로 돌아간다).
    expect(workflowStageMoveTargets("work", [raw], [{ id: "g-review", name: "심사 중" }]).get("심사 중")?.accent).toBeNull();
    // 규칙이 없는 선택지(값만 바뀌는 단계)는 맵에 없다.
    expect(targets.has("관리중")).toBe(false);
    expect(workflowStageMoveTargets("work", [column("progress_status")], []).size).toBe(0);
    expect(workflowStageMoveTargets("contact", [raw], []).size).toBe(0);
  });
});

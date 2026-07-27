import { describe, expect, it } from "vitest";
import {
  addMatrix,
  addTab,
  createDynamicWorkspaceDraft,
  DynamicWorkspaceRuleError,
  DynamicWorkspaceStaleVersionError,
  removeMatrix,
  reorderTabs,
  publishDraft,
  rollbackToPublication,
} from "./domain";

describe("dynamic workspace draft", () => {
  it("uses stable IDs to place multiple source modes on one board tab", () => {
    let draft = createDynamicWorkspaceDraft({ orgId: "org-a", workspaceId: "workspace-a" });
    draft = addTab(draft, 0, { id: "tab-sales", boardId: "board-sales", label: "영업" });
    draft = addMatrix(draft, 1, "tab-sales", {
      id: "matrix-all", source: { mode: "same_source_view", sourceId: "source-deals", viewId: "view-all" },
    });
    draft = addMatrix(draft, 2, "tab-sales", {
      id: "matrix-related", source: {
        mode: "relational", sourceId: "source-deals", relatedSourceId: "source-companies", relationId: "relation-company-deal",
      },
    });
    draft = addMatrix(draft, 3, "tab-sales", {
      id: "matrix-independent", source: { mode: "independent", sourceId: "source-notes" },
    });

    expect(draft.tabs[0].boardId).toBe("board-sales");
    expect(draft.tabs[0].matrices.map((matrix) => matrix.id)).toEqual([
      "matrix-all", "matrix-related", "matrix-independent",
    ]);
    expect(draft.tabs[0].matrices.map((matrix) => matrix.source.mode)).toEqual([
      "same_source_view", "relational", "independent",
    ]);
  });

  it("rejects duplicate/replay, stale updates, invalid relation and cross-workspace reorder", () => {
    let draft = createDynamicWorkspaceDraft({ orgId: "org-a", workspaceId: "workspace-a" });
    draft = addTab(draft, 0, { id: "tab-a", boardId: "board-a", label: "첫 탭" });
    expect(() => addTab(draft, 1, { id: "tab-a", boardId: "board-a", label: "다른 이름" })).toThrow(DynamicWorkspaceRuleError);
    expect(() => addMatrix(draft, 1, "tab-a", {
      id: "matrix-bad", source: { mode: "relational", sourceId: "source-a", relatedSourceId: "source-a", relationId: "relation-a" },
    })).toThrow(DynamicWorkspaceRuleError);
    expect(() => addTab(draft, 0, { id: "tab-b", boardId: "board-b", label: "둘째 탭" })).toThrow(DynamicWorkspaceStaleVersionError);
    expect(() => reorderTabs(draft, 1, ["tab-a", "foreign-tab"])).toThrow(DynamicWorkspaceRuleError);
  });

  it("removing a matrix changes presentation only and preserves its source reference outside the draft", () => {
    let draft = createDynamicWorkspaceDraft({ orgId: "org-a", workspaceId: "workspace-a" });
    draft = addTab(draft, 0, { id: "tab-a", boardId: "board-a", label: "첫 탭" });
    draft = addMatrix(draft, 1, "tab-a", {
      id: "matrix-a", source: { mode: "independent", sourceId: "source-kept" },
    });
    draft = removeMatrix(draft, 2, "tab-a", "matrix-a");
    expect(draft.tabs[0].matrices).toEqual([]);
    expect(draft.audit.at(-1)).toMatchObject({ type: "matrix_removed", targetId: "matrix-a" });
  });

  it("publishes only for an owner and rolls back atomically within the same workspace", () => {
    let draft = createDynamicWorkspaceDraft({ orgId: "org-a", workspaceId: "workspace-a" });
    draft = addTab(draft, 0, { id: "tab-a", boardId: "board-a", label: "첫 탭" });
    const publication = publishDraft(draft, { userId: "owner-a", isOwner: true });
    const edited = addTab(draft, 1, { id: "tab-b", boardId: "board-b", label: "둘째 탭" });

    expect(() => publishDraft(draft, { userId: "member-a", isOwner: false })).toThrow(DynamicWorkspaceRuleError);
    expect(() => rollbackToPublication(edited, 2, { ...publication, orgId: "org-b" })).toThrow(DynamicWorkspaceRuleError);
    expect(edited.tabs).toHaveLength(2); // failed rollback does not partially change the current draft

    const restored = rollbackToPublication(edited, 2, publication);
    expect(restored.tabs.map((tab) => tab.id)).toEqual(["tab-a"]);
    expect(restored.version).toBe(3);
  });
});

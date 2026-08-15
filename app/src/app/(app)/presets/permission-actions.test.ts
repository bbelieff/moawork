import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  risky: vi.fn(),
  deleteBoard: vi.fn(),
  getPreset: vi.fn(),
  getBoardDetail: vi.fn(),
  addGroup: vi.fn(),
  addColumn: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" } })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: mocks.risky }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/repo/supabase/boardsRepo", () => ({ SupabaseBoardsRepo: class {} }));
vi.mock("@/lib/boards", () => ({
  BoardsService: class {
    deleteBoard = mocks.deleteBoard;
    getBoardDetail = mocks.getBoardDetail;
    addGroup = mocks.addGroup;
    addColumn = mocks.addColumn;
  },
}));
vi.mock("@/lib/presets/section-presets", () => ({
  SectionPresetRepo: class { get = mocks.getPreset; },
  snapshotSectionPreset: vi.fn(),
}));

import { applySectionPresetAction, deleteTabAction } from "./actions";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("preset action permission combinations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.risky.mockResolvedValue({ ok: true });
    mocks.getBoardDetail.mockResolvedValue({ columns: [] });
    mocks.getPreset.mockResolvedValue({ groups: [], columns: [] });
  });

  it("requires tab management and the audited bulk-delete boundary before deleting", async () => {
    await deleteTabAction(form({ boardId: "board-a" }));
    expect(mocks.guard.mock.calls.map((call) => call[1])).toEqual([
      "structure.tab_manage",
      "danger.bulk_edit_delete",
    ]);
    expect(mocks.risky).toHaveBeenCalledWith("org-a", "danger.bulk_edit_delete", {
      operation: "danger.bulk_edit_delete",
    });
    expect(mocks.deleteBoard).toHaveBeenCalled();
  });

  it("does not delete when either destructive permission or audit is denied", async () => {
    mocks.guard.mockImplementation(async (_org: string, key: string) =>
      key === "danger.bulk_edit_delete" ? { kind: "denied", reason: "permission" } : { kind: "allowed" },
    );
    await expect(deleteTabAction(form({ boardId: "board-a" }))).rejects.toThrow();
    expect(mocks.deleteBoard).not.toHaveBeenCalled();

    mocks.guard.mockResolvedValue({ kind: "allowed" });
    mocks.risky.mockResolvedValue({ ok: false });
    await expect(deleteTabAction(form({ boardId: "board-a" }))).rejects.toThrow("위험 작업 기록");
    expect(mocks.deleteBoard).not.toHaveBeenCalled();
  });

  it("requires preset edit and column management before applying a template", async () => {
    mocks.guard.mockImplementation(async (_org: string, key: string) =>
      key === "structure.column_manage" ? { kind: "denied", reason: "permission" } : { kind: "allowed" },
    );
    await expect(applySectionPresetAction(form({ boardId: "board-a", presetId: "preset-a" }))).rejects.toThrow();
    expect(mocks.guard.mock.calls.map((call) => call[1])).toEqual([
      "structure.preset_edit",
      "structure.column_manage",
    ]);
    expect(mocks.getPreset).not.toHaveBeenCalled();
    expect(mocks.addGroup).not.toHaveBeenCalled();
    expect(mocks.addColumn).not.toHaveBeenCalled();
  });
});

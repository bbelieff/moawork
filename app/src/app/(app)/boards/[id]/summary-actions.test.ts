import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), apply: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org" }, user: { id: "user" }, role: "owner", scope: "all" })) }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.guard }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn(async () => ({ service: { applyBoardSummarySettings: mocks.apply } })) }));

import { saveBoardSummarySettingsAction } from "./summary-actions";

const request = { requestId: "00000000-0000-4000-8000-000000000001", intent: { type: "add" as const, metric: { id: "status", kind: "distribution" as const, columnKey: "status" } } };

describe("Issue #605 summary action", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({ kind: "allowed" }); mocks.apply.mockResolvedValue({ config: [request.intent.metric], replayed: false }); });

  it("uses structure.tab_manage and returns only the canonical saved config", async () => {
    await expect(saveBoardSummarySettingsAction("board", request)).resolves.toEqual({ ok: true, requestId: request.requestId, config: [request.intent.metric], replayed: false });
    expect(mocks.guard).toHaveBeenCalledWith("org", "structure.tab_manage");
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({ org: { id: "org" } }), "board", request);
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board");
  });

  it("fails closed before the repository on denied or unavailable permission", async () => {
    mocks.guard.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    await expect(saveBoardSummarySettingsAction("board", request)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("권한") });
    mocks.guard.mockResolvedValueOnce({ kind: "denied", reason: "unavailable" });
    await expect(saveBoardSummarySettingsAction("board", request)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("확인하지 못했습니다") });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});

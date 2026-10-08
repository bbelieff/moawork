import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCtx: vi.fn(),
  loadPermGuard: vi.fn(),
  readBoardTrashImpact: vi.fn(),
}));

vi.mock("@/lib/boards/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/boards/http")>()),
  requireCtx: mocks.requireCtx,
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.loadPermGuard }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({ service: { readBoardTrashImpact: mocks.readBoardTrashImpact } }),
}));

import { GET } from "./route";
import { UnauthorizedError } from "@/lib/boards/http";
import { NotFoundError } from "@/lib/boards/service";

const ctx = { org: { id: "org-a" }, user: { id: "user-a" } };
const params = { params: Promise.resolve({ boardId: "board-a" }) };
const impact = { groups: 1, rows: 2, memos: 0, files: 0, views: 0, automations: 0, messaging: 0 };

beforeEach(() => {
  mocks.requireCtx.mockReset().mockResolvedValue(ctx);
  mocks.loadPermGuard.mockReset().mockResolvedValue({ kind: "allowed" });
  mocks.readBoardTrashImpact.mockReset().mockResolvedValue(impact);
});

describe("Issue 857 · GET /api/boards/[boardId]/trash-impact", () => {
  it("탭 삭제 권한이 있으면 그 보드의 개수를 돌려준다(캐시 금지)", async () => {
    const response = await GET(new Request("https://x.test"), params);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: impact });
    expect(mocks.loadPermGuard).toHaveBeenCalledWith("org-a", "danger.bulk_edit_delete");
    expect(mocks.readBoardTrashImpact).toHaveBeenCalledWith(ctx, "board-a");
  });

  it("권한이 없으면 403, 판정 불능이면 503 — 개수를 읽지 않는다", async () => {
    mocks.loadPermGuard.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    expect((await GET(new Request("https://x.test"), params)).status).toBe(403);
    mocks.loadPermGuard.mockResolvedValueOnce({ kind: "denied", reason: "unavailable" });
    expect((await GET(new Request("https://x.test"), params)).status).toBe(503);
    expect(mocks.readBoardTrashImpact).not.toHaveBeenCalled();
  });

  it("로그인이 없으면 401, 없는·시스템 보드는 404", async () => {
    mocks.requireCtx.mockRejectedValueOnce(new UnauthorizedError());
    expect((await GET(new Request("https://x.test"), params)).status).toBe(401);
    mocks.readBoardTrashImpact.mockRejectedValueOnce(new NotFoundError("보드를 찾을 수 없습니다"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
  });
});

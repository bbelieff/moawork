import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  advance: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "user-a" } })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: vi.fn() })) }));
vi.mock("@/lib/new-lead/mutations", () => ({
  canonicalAssignee: vi.fn(),
  createCanonicalNewLead: vi.fn(),
  updateCanonicalNewLead: vi.fn(),
  updateCanonicalNewLeadMeta: vi.fn(),
  updateCanonicalNewLeadTitle: vi.fn(),
  NewLeadMutationError: class NewLeadMutationError extends Error {},
}));
vi.mock("@/lib/new-lead/advance", () => ({
  advanceNewLeadToContact: mocks.advance,
  NewLeadAdvanceError: class NewLeadAdvanceError extends Error {},
}));

import { advanceNewLeadFromDetailAction } from "./new-lead-actions";

function form(requestId = "00000000-0000-4000-8000-000000000100") {
  const data = new FormData();
  data.set("boardId", "board-a");
  data.set("itemId", "item-a");
  data.set("requestId", requestId);
  return data;
}

describe("Issue #542 detail advance action", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.advance.mockReset();
    mocks.revalidate.mockReset();
  });

  it("committed만 성공으로 표시하고 같은 request id를 전달한다", async () => {
    mocks.advance.mockResolvedValue({ status: "committed", replayed: true });
    await expect(advanceNewLeadFromDetailAction({ ok: false, message: "" }, form())).resolves.toEqual({
      ok: true,
      message: "리드컨택으로 넘겼습니다.",
    });
    expect(mocks.advance).toHaveBeenCalledWith(expect.anything(), {
      itemId: "item-a",
      requestId: "00000000-0000-4000-8000-000000000100",
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/contract");
  });

  it.each([
    ["blocked", "필수 정보를 확인해 주세요."],
    ["rolled_back", "원래 상태로 되돌렸습니다."],
  ])("%s 결과를 성공으로 꾸미지 않는다", async (status, reason) => {
    mocks.advance.mockResolvedValue({ status, reason });
    const result = await advanceNewLeadFromDetailAction({ ok: false, message: "" }, form());
    expect(result).toEqual({ ok: false, message: reason });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("권한 확인 실패와 RPC 예외를 fail-closed 한다", async () => {
    mocks.permission.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    await expect(advanceNewLeadFromDetailAction({ ok: false, message: "" }, form())).resolves.toEqual({
      ok: false,
      message: "리드를 넘길 권한이 없습니다.",
    });
    mocks.permission.mockResolvedValueOnce({ kind: "allowed" });
    mocks.advance.mockRejectedValueOnce(new Error("network"));
    await expect(advanceNewLeadFromDetailAction({ ok: false, message: "" }, form())).resolves.toEqual({
      ok: false,
      message: "리드컨택으로 넘기지 못했습니다. 다시 시도해 주세요.",
    });
  });
});

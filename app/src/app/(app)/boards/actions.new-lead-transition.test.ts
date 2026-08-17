import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, setCells, redirect, cookieSet, revalidatePath } = vi.hoisted(() => ({
  rpc: vi.fn(),
  setCells: vi.fn(async () => ({ errors: [] })),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
  cookieSet: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({
    user: { id: "user-1", email: "qa@example.invalid" },
    org: { id: "org-1", name: "QA" },
    role: "member",
    scope: "assigned",
  }),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: async () => ({ kind: "allowed" }) }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: async () => ({ ok: true }) }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({
    client: { rpc },
    repo: {},
    service: { setCells },
  }),
}));

import { setCellAction } from "./actions";

function form(value: string, requestId = "00000000-0000-4000-8000-000000000172"): FormData {
  const data = new FormData();
  data.set("boardId", "board-new");
  data.set("itemId", "item-1");
  data.set("columnKey", "contact_move");
  data.set("value", value);
  data.set("requestId", requestId);
  return data;
}

describe("BBE-172 new-lead contact transition action", () => {
  beforeEach(() => {
    rpc.mockReset();
    setCells.mockClear();
    redirect.mockClear();
    cookieSet.mockClear();
    revalidatePath.mockClear();
  });

  it("uses the atomic item transition and redirects to the canonical contact URL", async () => {
    rpc.mockResolvedValue({
      data: [{ status: "committed", deal_id: "deal-1", company_id: null, reason: null }],
      error: null,
    });
    await expect(setCellAction(form("컨택 이동"))).rejects.toThrow("NEXT_REDIRECT");
    expect(rpc).toHaveBeenCalledWith("advance_new_lead_to_contact", {
      p_item_id: "item-1",
      p_request_id: "00000000-0000-4000-8000-000000000172",
    });
    expect(setCells).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/contract");
    expect(revalidatePath).toHaveBeenCalledWith("/contract");
  });

  it("keeps non-transition values on the ordinary cell path with RPC zero", async () => {
    await setCellAction(form("컨택 대기"));
    expect(rpc).not.toHaveBeenCalled();
    expect(setCells).toHaveBeenCalledWith(expect.anything(), "board-new", "item-1", {
      contact_move: "컨택 대기",
    });
  });

  it("shows a safe explicit reason and does not redirect when the RPC denies", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await setCellAction(form("컨택 이동"));
    expect(cookieSet).toHaveBeenCalledOnce();
    expect(String(cookieSet.mock.calls[0][1])).toContain(encodeURIComponent("컨택 이동 권한이 없습니다."));
    expect(redirect).not.toHaveBeenCalled();
    expect(setCells).not.toHaveBeenCalled();
  });
});

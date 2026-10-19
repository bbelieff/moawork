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
    service: { setCells, getBoardDetail: async () => ({ columns: [{ key: "contact_move", type: "select" }] }) },
  }),
}));

import { setCellAction } from "./actions";

function form(value: string, requestId = "00000000-0000-4000-8000-000000000172", columnKey = "contact_move"): FormData {
  const data = new FormData();
  data.set("boardId", "board-new");
  data.set("itemId", "item-1");
  data.set("columnKey", columnKey);
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
    // 2026-10-19 — 기본 넘길 곳은 비대면 상담 화면.
    expect(redirect).toHaveBeenCalledWith("/consult-remote");
    expect(revalidatePath).toHaveBeenCalledWith("/contract");
  });

  it("상담 상황에서 선택해도 상세 화면 없이 같은 atomic 전환을 실행한다", async () => {
    rpc.mockResolvedValue({
      data: [{ status: "committed", deal_id: "deal-1", company_id: null, reason: null }],
      error: null,
    });
    await expect(setCellAction(form("리드컨택으로 넘기기", undefined, "consult_status"))).rejects.toThrow("NEXT_REDIRECT");
    expect(rpc).toHaveBeenCalledWith("advance_new_lead_to_contact", expect.objectContaining({ p_item_id: "item-1" }));
    expect(setCells).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/consult-remote");
  });

  it("대면을 골랐는데 대면 시작 저장이 실패하면 넘기기는 유지하고 비대면 상담으로 안내한다", async () => {
    rpc
      .mockResolvedValueOnce({ data: [{ status: "committed", deal_id: "deal-1", company_id: null, reason: null }], error: null })
      .mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    const data = form("리드컨택으로 넘기기", undefined, "consult_status");
    data.set("consultTarget", "inperson");
    data.set("meetingAt", "2026-10-21T05:00:00.000Z");
    await expect(setCellAction(data)).rejects.toThrow("NEXT_REDIRECT");
    expect(rpc).toHaveBeenCalledWith("read_consultation_snapshot_v2", expect.objectContaining({ p_item_id: "item-1" }));
    expect(redirect).toHaveBeenCalledWith("/consult-remote");
  });

  it("대면을 골랐는데 미팅 일시가 없으면 대면 저장을 시도하지 않는다", async () => {
    rpc.mockResolvedValueOnce({ data: [{ status: "committed", deal_id: "deal-1", company_id: null, reason: null }], error: null });
    const data = form("리드컨택으로 넘기기", undefined, "consult_status");
    data.set("consultTarget", "inperson");
    await expect(setCellAction(data)).rejects.toThrow("NEXT_REDIRECT");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith("/consult-remote");
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

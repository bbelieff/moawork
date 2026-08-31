import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-1" } })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: vi.fn() })) }));
vi.mock("@/lib/companies/start-work", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/companies/start-work")>(),
  startCompanyWork: mocks.start,
}));

import { startCompanyWorkFromBoardAction } from "./company-intake-actions";

function form(overrides: Partial<Record<"companyId" | "requestId" | "boardId" | "groupId", string>> = {}) {
  const value = new FormData();
  value.set("companyId", overrides.companyId ?? "company-1");
  value.set("requestId", overrides.requestId ?? "request-1");
  value.set("boardId", overrides.boardId ?? "board-1");
  // groupId 는 «누른 그룹» 이다. 「그룹 없음」 블록에서는 폼이 아예 안 보낸다.
  if (overrides.groupId) value.set("groupId", overrides.groupId);
  return value;
}

describe("contract-work company intake action", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ dealId: "deal-1", itemId: "item-1", replayed: false });
    mocks.revalidate.mockReset();
  });

  it("성공을 화면 상태로 돌려주고 관련 화면을 다시 읽는다", async () => {
    await expect(startCompanyWorkFromBoardAction({ ok: null, message: "" }, form())).resolves.toEqual({
      ok: true,
      message: "업무를 시작했어요.",
    });
    expect(mocks.start).toHaveBeenCalledWith(expect.anything(), {
      // groupId — 누른 그룹을 그대로 넘긴다(#588). 폼이 안 보내면 null 이고,
      // 그때는 서버가 종전과 같이 첫 그룹을 고른다.
      orgId: "org-1", companyId: "company-1", requestId: "request-1", groupId: null,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-1");
  });

  it("★ 누른 그룹을 그대로 서버에 넘긴다 — 없으면 «맨 위» 그룹에 생긴다 (#588)", async () => {
    await startCompanyWorkFromBoardAction({ ok: null, message: "" }, form({ groupId: "group-2" }));
    expect(mocks.start).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groupId: "group-2" }),
    );
  });

  it("RPC 실패와 잘못된 입력을 성공으로 숨기지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.start.mockRejectedValueOnce(new Error("private database detail"));
    await expect(startCompanyWorkFromBoardAction({ ok: null, message: "" }, form())).resolves.toEqual({
      ok: false,
      message: "업무를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
      retry: { companyId: "company-1", groupId: null, requestId: "request-1" },
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();

    await expect(startCompanyWorkFromBoardAction(
      { ok: null, message: "" },
      form({ companyId: "" }),
    )).resolves.toEqual({ ok: false, message: "업체를 선택한 뒤 다시 시도해 주세요." });
    error.mockRestore();
  });

  it("actual unverifiable result만 exact retry intent를 보존하고 terminal conflict는 회전시킨다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const actual = await vi.importActual<typeof import("@/lib/companies/start-work")>("@/lib/companies/start-work");
    mocks.start.mockImplementationOnce((_client, input) => actual.startCompanyWork({
      rpc: async () => ({
        data: [{ case_id: "case-1", item_id: "item-1", version: null, replayed: false }],
        error: null,
      }),
    }, input));
    await expect(startCompanyWorkFromBoardAction({ ok: null, message: "" }, form({ groupId: "group-2" })))
      .resolves.toMatchObject({
        ok: false,
        retry: { companyId: "company-1", groupId: "group-2", requestId: "request-1" },
      });
    mocks.start.mockImplementationOnce((_client, input) => actual.startCompanyWork({
      rpc: async () => ({ data: null, error: { code: "42501", message: "permission denied" } }),
    }, input));
    const terminal = await startCompanyWorkFromBoardAction({ ok: null, message: "" }, form());
    expect(terminal.ok).toBe(false);
    expect(terminal.retry).toBeUndefined();
    error.mockRestore();
  });
});

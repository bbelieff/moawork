import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-1" } })) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: vi.fn() })) }));
vi.mock("@/lib/companies/start-work", () => ({ startCompanyWork: mocks.start }));

import { startCompanyWorkFromBoardAction } from "./company-intake-actions";

function form(overrides: Partial<Record<"companyId" | "requestId" | "boardId", string>> = {}) {
  const value = new FormData();
  value.set("companyId", overrides.companyId ?? "company-1");
  value.set("requestId", overrides.requestId ?? "request-1");
  value.set("boardId", overrides.boardId ?? "board-1");
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
      orgId: "org-1", companyId: "company-1", requestId: "request-1",
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-1");
  });

  it("RPC 실패와 잘못된 입력을 성공으로 숨기지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.start.mockRejectedValueOnce(new Error("private database detail"));
    await expect(startCompanyWorkFromBoardAction({ ok: null, message: "" }, form())).resolves.toEqual({
      ok: false,
      message: "업무를 시작하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();

    await expect(startCompanyWorkFromBoardAction(
      { ok: null, message: "" },
      form({ companyId: "" }),
    )).resolves.toEqual({ ok: false, message: "업체를 선택한 뒤 다시 시도해 주세요." });
    error.mockRestore();
  });
});

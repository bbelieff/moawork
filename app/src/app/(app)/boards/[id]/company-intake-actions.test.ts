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
      outcome: "uncertain",
      message: "저장 결과를 확인하지 못했어요. 같은 회사로 다시 시도해 결과를 확인해 주세요.",
    });
    expect(mocks.revalidate).not.toHaveBeenCalled();

    await expect(startCompanyWorkFromBoardAction(
      { ok: null, message: "" },
      form({ companyId: "" }),
    )).resolves.toEqual({ ok: false, outcome: "rejected", message: "업체를 선택한 뒤 다시 시도해 주세요." });
    error.mockRestore();
  });
});


it("explicit database denial is distinguished from an uncertain transport result", async () => {
  mocks.start.mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "42501" }));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await startCompanyWorkFromBoardAction({ ok: null, message: "" }, form())).toMatchObject({ ok: false, outcome: "rejected" });
  } finally { log.mockRestore(); }
});

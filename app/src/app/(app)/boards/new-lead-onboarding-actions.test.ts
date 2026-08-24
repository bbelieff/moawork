import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ org: { id: "org-a" } })) }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));

import { saveNewLeadOnboardingAction } from "./new-lead-onboarding-actions";

const id = "00000000-0000-4000-8000-000000000901";
function form(requestId = id) {
  const value = new FormData();
  value.set("boardId", "board-a");
  value.set("state", "completed");
  value.set("requestId", requestId);
  return value;
}

describe("Issue #542 onboarding action", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.rpc.mockReset().mockResolvedValue({ data: "completed", error: null });
    mocks.revalidate.mockReset();
  });

  it("안정 request id와 version을 RPC에 전달한다", async () => {
    await expect(saveNewLeadOnboardingAction({ ok: false, message: "" }, form())).resolves.toEqual({ ok: true, message: "도움말을 완료했습니다." });
    expect(mocks.rpc).toHaveBeenCalledWith("set_new_lead_onboarding_state", expect.objectContaining({ p_request_id: id, p_state: "completed" }));
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-a");
  });

  it("잘못된 request id와 권한 거부를 저장 성공으로 꾸미지 않는다", async () => {
    await expect(saveNewLeadOnboardingAction({ ok: false, message: "" }, form("bad"))).resolves.toEqual({ ok: false, message: "도움말 상태를 저장하지 못했습니다." });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.permission.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    await expect(saveNewLeadOnboardingAction({ ok: false, message: "" }, form())).resolves.toEqual({ ok: false, message: "도움말 상태를 저장할 권한이 없습니다." });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  purgeExpiredBoards: vi.fn(async () => 0),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: async () => ({ repo: { purgeExpiredBoards: mocks.purgeExpiredBoards } }),
}));

import { scheduleExpiredTrashPurge } from "./trash-maintenance";

function ctxFor(orgId: string, role: Ctx["role"]): Ctx {
  return { org: { id: orgId, name: "합성 회사", plan_tier: "free", created_at: "" }, user: { id: "u1", name: "합성", created_at: "" }, role, scope: "all" } as Ctx;
}

beforeEach(() => {
  mocks.after.mockReset();
  mocks.purgeExpiredBoards.mockClear();
});

describe("Issue 857 — 휴지통 만료 정리는 화면을 기다리게 하지 않는다", () => {
  it("응답 뒤로 미루고, 미룬 일이 돌 때 정리한다", async () => {
    await scheduleExpiredTrashPurge(ctxFor("org-after", "owner"), true);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.purgeExpiredBoards).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.purgeExpiredBoards).toHaveBeenCalledTimes(1);
  });

  it("같은 회사는 몇 시간에 한 번만 돈다", async () => {
    await scheduleExpiredTrashPurge(ctxFor("org-throttle", "owner"), true);
    await scheduleExpiredTrashPurge(ctxFor("org-throttle", "admin"), true);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("탭 관리 권한이 없으면 건드리지 않는다", async () => {
    await scheduleExpiredTrashPurge(ctxFor("org-member", "admin"), false);
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("정리가 실패하면 다음 화면에서 다시 시도한다", async () => {
    mocks.purgeExpiredBoards.mockRejectedValueOnce(new Error("permission_denied"));
    await scheduleExpiredTrashPurge(ctxFor("org-retry", "owner"), true);
    await mocks.after.mock.calls[0][0]();
    await scheduleExpiredTrashPurge(ctxFor("org-retry", "owner"), true);
    expect(mocks.after).toHaveBeenCalledTimes(2);
  });
});

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
    await scheduleExpiredTrashPurge(ctxFor("org-after", "owner"));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.purgeExpiredBoards).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.purgeExpiredBoards).toHaveBeenCalledTimes(1);
  });

  it("같은 회사는 몇 시간에 한 번만 돈다", async () => {
    await scheduleExpiredTrashPurge(ctxFor("org-throttle", "owner"));
    await scheduleExpiredTrashPurge(ctxFor("org-throttle", "admin"));
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("관리 권한이 없는 역할은 건드리지 않는다", async () => {
    await scheduleExpiredTrashPurge(ctxFor("org-member", "member"));
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

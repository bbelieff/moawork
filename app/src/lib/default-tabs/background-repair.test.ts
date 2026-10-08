import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  createClient: vi.fn(async (_options?: { noStore?: boolean }) => ({ fresh: true })),
  repairNewcust: vi.fn(async () => ({ kind: "ready" })),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/newcust/entry", () => ({ repairNewcustBoardOnEntry: mocks.repairNewcust }));
vi.mock("@/lib/contact/entry", () => ({ repairContactBoardOnEntry: vi.fn() }));
vi.mock("@/lib/notices/entry", () => ({ repairNoticeBoardOnEntry: vi.fn() }));
vi.mock("@/lib/work/entry", () => ({ repairContractWorkBoardOnEntry: vi.fn() }));

import { scheduleDefaultTabRepair } from "./background-repair";
import { NEW_LEAD_TAB_SOURCE } from "./types";

function ctxFor(orgId: string, role: Ctx["role"]): Ctx {
  return { org: { id: orgId, name: "합성 회사", plan_tier: "free", created_at: "" }, user: { id: "u1", name: "합성", created_at: "" }, role, scope: "all" } as Ctx;
}

beforeEach(() => {
  mocks.after.mockReset();
  mocks.createClient.mockClear();
  mocks.repairNewcust.mockClear();
});

describe("Issue 857 — 기본 탭으로 바로 와도 진입 점검은 응답 뒤에 돈다", () => {
  it("늘 새로 읽는 클라이언트로 경유지와 같은 점검을 응답 뒤에 돌린다", async () => {
    const ctx = ctxFor("org-run", "owner");
    await scheduleDefaultTabRepair(ctx, NEW_LEAD_TAB_SOURCE);
    expect(mocks.createClient).toHaveBeenCalledWith({ noStore: true });
    expect(mocks.repairNewcust).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.repairNewcust).toHaveBeenCalledWith(ctx, { fresh: true });
  });

  it("같은 회사·같은 탭은 10분에 한 번만", async () => {
    await scheduleDefaultTabRepair(ctxFor("org-throttle", "owner"), NEW_LEAD_TAB_SOURCE);
    await scheduleDefaultTabRepair(ctxFor("org-throttle", "admin"), NEW_LEAD_TAB_SOURCE);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("구성원·사용자 탭은 점검하지 않는다", async () => {
    await scheduleDefaultTabRepair(ctxFor("org-member", "member"), NEW_LEAD_TAB_SOURCE);
    await scheduleDefaultTabRepair(ctxFor("org-user-tab", "owner"), null);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});

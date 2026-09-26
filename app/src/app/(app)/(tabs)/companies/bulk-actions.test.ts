import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getSessionMock,
  loadPermGuardMock,
  recordRiskyMock,
  crmMock,
  createClientMock,
  lineageReadMock,
  lineageReassignMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  loadPermGuardMock: vi.fn(),
  recordRiskyMock: vi.fn(),
  crmMock: {
    getCompany: vi.fn(),
    updateCompany: vi.fn(),
    getDeal: vi.fn(),
    updateDeal: vi.fn(),
    reassignDeal: vi.fn(),
  },
  createClientMock: vi.fn(),
  lineageReadMock: vi.fn(),
  lineageReassignMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: getSessionMock }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: loadPermGuardMock }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: recordRiskyMock }));
vi.mock("@/lib/crm", () => ({ getCrmService: () => crmMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/assignment-lineage", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/assignment-lineage")>();
  return {
    ...orig,
    AssignmentLineageService: class {
      read = lineageReadMock;
      reassign = lineageReassignMock;
    },
    SupabaseAssignmentLineageRepo: class {},
  };
});

function memberOkClient(itemsResult: { error: unknown; data: unknown } | Error, projectionThrows = false) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () =>
            table === "org_members"
              ? { in: async () => ({ error: null, data: [{ user_id: "user-1" }] }) }
              : {
                  is: () => ({
                    limit: () => ({
                      maybeSingle: async () => {
                        if (projectionThrows) throw new Error("projection throw");
                        return itemsResult as { error: unknown; data: unknown };
                      },
                    }),
                  }),
                },
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
}

import {
  bulkReassignDealsAction,
  bulkStartWorkAction,
  bulkUpdateCompaniesAction,
  bulkUpdateDealsAction,
} from "./bulk-actions";

const CTX = { org: { id: "org-1" }, user: { id: "actor-1" }, role: "owner", scope: "all" };

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(CTX);
  loadPermGuardMock.mockResolvedValue({ kind: "allowed" });
  recordRiskyMock.mockResolvedValue({ ok: true });
  crmMock.getCompany.mockResolvedValue({ id: "c1" });
  crmMock.updateCompany.mockResolvedValue({ id: "c1" });
  crmMock.getDeal.mockResolvedValue({ id: "d1", assigned_to: null });
  crmMock.updateDeal.mockResolvedValue({ id: "d1" });
  crmMock.reassignDeal.mockResolvedValue({ id: "d1" });
  lineageReadMock.mockResolvedValue({ currentAssigneeId: null, version: 0 });
  lineageReassignMock.mockResolvedValue({ accepted: true, replayed: false, version: 1 });
  createClientMock.mockResolvedValue({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ error: null, data: [{ user_id: "user-1" }] }) }) }) }),
    }),
    rpc: vi.fn(async () => ({ data: [{ deal_id: "deal-new", item_id: "item-new", replayed: false }], error: null })),
  });
});

describe("companies bulk 권한/tenant 거부", () => {
  it("한 행이어도 danger.bulk_edit_delete+업무권한+감사가 필수다", async () => {
    loadPermGuardMock.mockResolvedValueOnce({ kind: "denied", reason: "permission" });
    const result = await bulkUpdateCompaniesAction({ companyIds: ["c1"], field: "biz_type", value: "제조업" });
    expect(result.failed).toBe(1);
    expect(result.results[0]?.ok).toBe(false);
    expect(crmMock.updateCompany).not.toHaveBeenCalled();
  });

  it("감사 실패는 실행하지 않는다", async () => {
    recordRiskyMock.mockResolvedValueOnce({ ok: false });
    const result = await bulkUpdateDealsAction({ dealIds: ["d1"], field: "title", value: "새 자금" });
    expect(result.failed).toBe(1);
    expect(crmMock.updateDeal).not.toHaveBeenCalled();
  });

  it("테넌트 밖 회사는 건별 실패 — 빈 성공으로 위장하지 않는다", async () => {
    crmMock.getCompany.mockRejectedValueOnce(new Error("고객사를 찾을 수 없습니다"));
    const result = await bulkUpdateCompaniesAction({ companyIds: ["other-org"], field: "biz_type", value: "제조업" });
    expect(result.failed).toBe(1);
    expect(crmMock.updateCompany).not.toHaveBeenCalled();
  });

  it("딜 조회 오류를 회사 집계로 우회하지 않는다", async () => {
    crmMock.getDeal.mockRejectedValueOnce(new Error("딜을 찾을 수 없습니다"));
    const result = await bulkUpdateDealsAction({ dealIds: ["missing"], field: "title", value: "x" });
    expect(result.failed).toBe(1);
    expect(crmMock.updateDeal).not.toHaveBeenCalled();
  });
});

describe("companies bulk 부분 실패", () => {
  it("성공한 항목은 결과에서 ok, 실패 입력은 메시지와 함께 남는다", async () => {
    crmMock.updateCompany
      .mockResolvedValueOnce({ id: "c1" })
      .mockRejectedValueOnce(new Error("저장하지 못했어요"));
    const result = await bulkUpdateCompaniesAction({
      companyIds: ["c1", "c2"],
      field: "biz_type",
      value: "제조업",
    });
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((entry) => entry.itemId === "c1")?.ok).toBe(true);
    expect(result.results.find((entry) => entry.itemId === "c2")?.ok).toBe(false);
  });

  it("집계 필드는 서버에서도 거부한다", async () => {
    const result = await bulkUpdateCompaniesAction({ companyIds: ["c1"], field: "status", value: "승인" });
    expect(result.failed).toBe(1);
    expect(crmMock.updateCompany).not.toHaveBeenCalled();
  });

  it("담당 변경은 조직 멤버가 아니면 전건 실패한다", async () => {
    createClientMock.mockResolvedValueOnce({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ in: async () => ({ error: null, data: [] }) }) }) }),
      }),
    });
    const result = await bulkReassignDealsAction({ dealIds: ["d1"], assigneeId: "outsider" });
    expect(result.failed).toBe(1);
    expect(crmMock.reassignDeal).not.toHaveBeenCalled();
  });

  it("업무 시작은 명시적 RPC 1건씩 — 실패해도 멈추지 않는다", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ deal_id: "deal-1", item_id: "item-1", replayed: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "실패", code: "42501" } });
    createClientMock.mockResolvedValueOnce({ rpc });
    const result = await bulkStartWorkAction({ companyIds: ["c1", "c2"] });
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("담당 일괄 lineage 전용 — 투영 조회 우회 금지", () => {
  it("투영 조회 error는 CRM fallback 없이 그 건 실패로 닫는다", async () => {
    createClientMock.mockResolvedValueOnce(
      memberOkClient({ error: { message: "db down" }, data: null }),
    );
    const result = await bulkReassignDealsAction({ dealIds: ["d1"], assigneeId: "user-1" });
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0]?.ok).toBe(false);
    expect(result.results[0]?.message).toMatch(/확인하지 못해 저장하지 않았습니다/);
    expect(crmMock.reassignDeal).not.toHaveBeenCalled();
    expect(lineageReassignMock).not.toHaveBeenCalled();
  });

  it("투영 조회 throw도 CRM fallback 없이 그 건 실패로 닫는다", async () => {
    createClientMock.mockResolvedValueOnce(
      memberOkClient({ error: null, data: null }, true),
    );
    const result = await bulkReassignDealsAction({ dealIds: ["d1"], assigneeId: "user-1" });
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.results[0]?.ok).toBe(false);
    expect(crmMock.reassignDeal).not.toHaveBeenCalled();
    expect(lineageReassignMock).not.toHaveBeenCalled();
  });

  it("투영 없음은 lineage 우회 없이 실패 — 성공 0을 성공으로 꾸미지 않는다", async () => {
    createClientMock.mockResolvedValueOnce(
      memberOkClient({ error: null, data: null }),
    );
    const result = await bulkReassignDealsAction({ dealIds: ["d1"], assigneeId: "user-1" });
    expect(result.ok).toBe(false);
    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0]?.message).toMatch(/보드 투영이 없어/);
    expect(crmMock.reassignDeal).not.toHaveBeenCalled();
  });

  it("투영이 있을 때만 실제 lineage read->reassign 경로를 쓴다", async () => {
    createClientMock.mockResolvedValueOnce(
      memberOkClient({ error: null, data: { id: "item-1", board_id: "board-1" } }),
    );
    const result = await bulkReassignDealsAction({ dealIds: ["d1"], assigneeId: "user-1" });
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(1);
    expect(lineageReadMock).toHaveBeenCalledTimes(1);
    expect(lineageReassignMock).toHaveBeenCalledTimes(1);
    expect(crmMock.reassignDeal).not.toHaveBeenCalled();
  });

  it("부분 실패 초안을 보존한다 — 성공분만 ok, 실패분은 메시지와 함께 남는다", async () => {
    const first = memberOkClient({ error: null, data: { id: "item-1", board_id: "board-1" } });
    const second = memberOkClient({ error: null, data: null });
    const membersOnly = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ in: async () => ({ error: null, data: [{ user_id: "user-1" }] }) }) }),
        }),
      }),
      rpc: vi.fn(async () => ({ data: null, error: null })),
    };
    void membersOnly;
    let calls = 0;
    createClientMock.mockResolvedValueOnce({
      from: (table: string) => {
        if (table === "org_members") return first.from(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  limit: () => ({
                    maybeSingle: async () => {
                      calls += 1;
                      return calls === 1
                        ? { error: null, data: { id: "item-1", board_id: "board-1" } }
                        : { error: null, data: null };
                    },
                  }),
                }),
              }),
            }),
          }),
        };
      },
      rpc: vi.fn(async () => ({ data: null, error: null })),
    });
    void second;
    const result = await bulkReassignDealsAction({ dealIds: ["d1", "d2"], assigneeId: "user-1" });
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.results.find((entry) => entry.itemId === "d1")?.ok).toBe(true);
    expect(result.results.find((entry) => entry.itemId === "d2")?.ok).toBe(false);
    expect(crmMock.reassignDeal).not.toHaveBeenCalled();
  });
});

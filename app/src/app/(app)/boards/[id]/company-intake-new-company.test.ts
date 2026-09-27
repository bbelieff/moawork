import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  intakeRpc: vi.fn(),
  revalidate: vi.fn(),
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  guard: "allowed",
  boardDetail: { columns: [], groups: [{ id: "group-2" }] },
  session: { org: { id: "org-session" }, user: { id: "user-1" }, role: "owner", scope: "all" },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "create_company_and_start_work") return mocks.intakeRpc(args);
      return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    },
  })),
}));
vi.mock("@/lib/companies/start-work", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/companies/start-work")>();
  return { ...actual, startCompanyWork: mocks.start };
});
vi.mock("@/lib/perm/guard", () => ({
  loadPermGuard: vi.fn(async () => ({ kind: mocks.guard })),
}));
vi.mock("@/lib/boards/server", () => ({
  createRequestBoards: vi.fn(async () => ({
    service: {
      getBoardDetail: vi.fn(async () => structuredClone(mocks.boardDetail)),
      updateColumn: vi.fn(),
    },
  })),
}));
vi.mock("@/lib/crm", () => ({
  getCrmService: () => ({ listCompanies: mocks.listCompanies, createCompany: mocks.createCompany }),
}));

import { CompanyIntakeError } from "@/lib/companies/start-work";
import { startCompanyWorkFromNewCompanyAction } from "./company-intake-actions";

function form(entries: Record<string, string>) {
  const value = new FormData();
  for (const [key, entry] of Object.entries(entries)) value.set(key, entry);
  return value;
}

const BASE = {
  companyName: "모아상사",
  workRequestId: "work-req-1",
  boardId: "board-1",
  groupId: "group-2",
};

function companyRow(id: string, name: string) {
  return {
    id,
    org_id: "org-session",
    name,
    biz_type: null,
    region: null,
    owner_name: null,
    phone: null,
    email: null,
    revenue: null,
    founded_on: null,
    homepage: null,
    assigned_to: "user-1",
  };
}

describe("새 회사 등록 + 업무 시작 (155 원자 경로)", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ dealId: "deal-1", itemId: "item-1", replayed: false });
    mocks.intakeRpc.mockReset().mockResolvedValue({
      data: [{ company_id: "company-new", deal_id: "deal-1", item_id: "item-1", replayed: false }],
      error: null,
    });
    mocks.revalidate.mockReset();
    mocks.listCompanies.mockReset().mockResolvedValue([]);
    mocks.createCompany.mockReset().mockImplementation(async (_ctx: unknown, input: { name: string }) => companyRow("company-new", input.name));
    mocks.guard = "allowed";
    mocks.boardDetail = { columns: [], groups: [{ id: "group-2" }] };
  });

  it("원자 RPC로 잇고 세션 조직으로 시작한다 — 예전 두 단계는 타지 않는다", async () => {
    const result = await startCompanyWorkFromNewCompanyAction({ ok: null, message: "" }, form(BASE));
    expect(result).toEqual({ ok: true, message: "새 회사를 등록하고 업무를 시작했어요.", createdCompanyId: "company-new" });
    expect(mocks.intakeRpc).toHaveBeenCalledWith(expect.objectContaining({
      p_org_id: "org-session",
      p_board_id: "board-1",
      p_group_id: "group-2",
      p_request_id: "work-req-1",
      p_name: "모아상사",
    }));
    // 후보 선행 차단이 없다 — replay가 먼저다. 성공 경로는 목록을 읽지 않는다.
    expect(mocks.listCompanies).not.toHaveBeenCalled();
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.revalidate).toHaveBeenCalledWith("/boards/board-1");
  });

  it("정본 매핑으로 저장한다 — 사업자유형·창업연월·단일 지역", async () => {
    await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({
        ...BASE,
        businessType: "개인사업자",
        businessSubtype: "간이",
        foundedMonth: "2024-03",
        regionSido: "서울",
        regionSigungu: "강남구",
      }),
    );
    expect(mocks.intakeRpc).toHaveBeenCalledWith(expect.objectContaining({
      p_biz_type: "개인사업자(간이)",
      p_founded_on: "2024-03-01",
      p_region: "서울_강남구",
    }));
  });

  it("잃어버린 응답의 재시도는 같은 답으로 수렴한다", async () => {
    mocks.intakeRpc.mockResolvedValueOnce({
      data: [{ company_id: "company-new", deal_id: "deal-1", item_id: "item-1", replayed: true }],
      error: null,
    });
    const result = await startCompanyWorkFromNewCompanyAction({ ok: null, message: "" }, form(BASE));
    expect(result).toEqual({
      ok: true,
      message: "이미 등록된 요청이에요. 같은 회사로 진행합니다.",
      createdCompanyId: "company-new",
    });
    expect(mocks.createCompany).not.toHaveBeenCalled();
  });

  it("폼에 가짜 org 를 실어 보내도 세션 org 로만 쓴다 — 테넌트 상승 없음", async () => {
    await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({ ...BASE, orgId: "org-evil", org_id: "org-evil" }),
    );
    expect(mocks.intakeRpc).toHaveBeenCalledWith(expect.objectContaining({ p_org_id: "org-session" }));
  });

  it("replay보다 후보를 먼저 막지 않는다 — 같은 열쇠+같은 내용은 자신의 회사여도 같은 답이다", async () => {
    // 성공 뒤 응답만 잃은 재시도: 보이는 목록에는 자신이 막 만든 회사가 이미 있다.
    // 그래도 같은 열쇠+같은 내용이면 RPC replay가 먼저여서 같은 회사로 수렴한다.
    mocks.listCompanies.mockResolvedValue([{
      ...companyRow("company-new", "모아상사"),
      biz_type: null,
      region: null,
      phone: null,
    }]);
    mocks.intakeRpc.mockResolvedValueOnce({
      data: [{ company_id: "company-new", deal_id: "deal-1", item_id: "item-1", replayed: true }],
      error: null,
    });
    const result = await startCompanyWorkFromNewCompanyAction({ ok: null, message: "" }, form(BASE));
    expect(result).toEqual({
      ok: true,
      message: "이미 등록된 요청이에요. 같은 회사로 진행합니다.",
      createdCompanyId: "company-new",
    });
    expect(mocks.intakeRpc).toHaveBeenCalledTimes(1);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("같은 열쇠에 다른 내용은 거절한다 — 후보보다 replay 판정이 먼저다", async () => {
    mocks.listCompanies.mockResolvedValue([]);
    mocks.intakeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "company intake idempotency key reuse" },
    });
    const result = await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({ ...BASE, companyName: "다른상사" }),
    );
    expect(result.ok).toBe(false);
    expect(result.conflictCandidates).toBeUndefined();
    expect(result.createdCompanyId).toBeUndefined();
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });

  it("genuinely new 열쇠의 같은 이름은 RPC가 막고 후보를 보여준다 — 삽입 없음", async () => {
    mocks.listCompanies.mockResolvedValue([{
      ...companyRow("company-old", "모아상사"),
      biz_type: "법인사업자",
      region: "서울_강남구",
      phone: "02-1111-2222",
    }]);
    mocks.intakeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "company intake duplicate candidate" },
    });
    const result = await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({ ...BASE, workRequestId: "work-req-new", companyName: "  모아상사 " }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.intakeRpc).toHaveBeenCalledTimes(1);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(result.conflictCandidates).toEqual([
      { id: "company-old", name: "모아상사", detail: "법인사업자 · 서울_강남구 · 02-1111-2222" },
    ]);
  });

  it("RPC가 권한 없음으로 판정하면 만들지 않고 그 답을 돌려준다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.intakeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "company intake permission denied" },
    });
    const result = await startCompanyWorkFromNewCompanyAction({ ok: null, message: "" }, form(BASE));
    expect(result.ok).toBe(false);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("정본 검증을 그대로 쓴다 — 잘못된 창업연월·사업자유형·지역은 저장 전에 막힌다", async () => {
    const cases: Record<string, string>[] = [
      { foundedMonth: "2024-13" },
      { businessType: "대기업" },
      { regionSido: "서울", regionSigungu: "없는구" },
    ];
    for (const extra of cases) {
      const result = await startCompanyWorkFromNewCompanyAction(
        { ok: null, message: "" },
        form({ ...BASE, ...extra }),
      );
      expect(result.ok).toBe(false);
    }
    expect(mocks.intakeRpc).not.toHaveBeenCalled();
    expect(mocks.createCompany).not.toHaveBeenCalled();
  });

  it("필수값이 비면 시작하지 않는다", async () => {
    const result = await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({ ...BASE, companyName: "   " }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.intakeRpc).not.toHaveBeenCalled();
    expect(mocks.createCompany).not.toHaveBeenCalled();
  });
});

describe("새 회사 155 미적용 — fail-closed, ZERO writes", () => {
  beforeEach(() => {
    mocks.start.mockReset().mockResolvedValue({ dealId: "deal-1", itemId: "item-1", replayed: false });
    mocks.intakeRpc.mockReset().mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    mocks.revalidate.mockReset();
    mocks.listCompanies.mockReset().mockResolvedValue([]);
    mocks.createCompany.mockReset().mockImplementation(async (_ctx: unknown, input: { name: string }) => companyRow("company-new", input.name));
    mocks.guard = "allowed";
    mocks.boardDetail = { columns: [], groups: [{ id: "group-2" }] };
  });

  it("155가 없으면 만들지 않고 끝낸다 — 예전 두 단계로 가지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await startCompanyWorkFromNewCompanyAction({ ok: null, message: "" }, form(BASE));
    expect(result.ok).toBe(false);
    expect(result.createdCompanyId).toBeUndefined();
    expect(result.retryCompanyId).toBeUndefined();
    expect(result.conflictCandidates).toBeUndefined();
    expect(mocks.intakeRpc).toHaveBeenCalledTimes(1);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.listCompanies).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("42883도 같은 fail-closed다 — ZERO writes", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.intakeRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });
    const result = await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({ ...BASE, groupId: "group-evil" }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("위조된 그룹이어도 155 없이는 RPC 부재로 끝낸다 — 회사를 만들지 않는다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await startCompanyWorkFromNewCompanyAction(
      { ok: null, message: "" },
      form({ ...BASE, groupId: "group-evil" }),
    );
    expect(result.ok).toBe(false);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("같은 열쇠에 다른 내용이면 RPC가 거절한다 — CompanyIntakeError 전달", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.intakeRpc.mockReset().mockRejectedValueOnce(
      new CompanyIntakeError("company intake idempotency key reuse", "22023"),
    );
    // RPC 판정 오류는 답으로 끝난다 — 예비책이 없다.
    // (mock이 직접 던진 경우 — 실제 경로는 error payload로 온다.)
    const result = await startCompanyWorkFromNewCompanyAction({ ok: null, message: "" }, form(BASE));
    expect(result.ok).toBe(false);
    expect(mocks.createCompany).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

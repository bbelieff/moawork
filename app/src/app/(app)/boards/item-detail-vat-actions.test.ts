import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  permission: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "10000000-0000-4000-8000-000000000001" }, user: { id: "actor-not-forwarded" } })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ rpc: mocks.rpc })) }));

import { confirmItemVatPeriodsAction, loadItemVatPeriodsAction } from "./item-detail-vat-actions";

const target = {
  boardId: "20000000-0000-4000-8000-000000000002",
  itemId: "30000000-0000-4000-8000-000000000003",
};
const confirmation = {
  sourceFileId: "40000000-0000-4000-8000-000000000004",
  documentBizNo: "123-45-67891",
  periods: [
    { periodStart: "2025-07-01", periodEnd: "2025-12-31", salesAmount: "67890" },
    { periodStart: "2025-01-01", periodEnd: "2025-06-30", salesAmount: "12345" },
  ],
};
const snapshot = {
  version: 3,
  replayed: false,
  periods: [{
    period_start: "2025-01-01",
    period_end: "2025-06-30",
    sales_amount: "12345",
    source_file_id: confirmation.sourceFileId,
    applied_version: 3,
  }],
};

describe("VAT 기간별 자료 server actions", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.rpc.mockReset().mockResolvedValue({ data: snapshot, error: null });
    mocks.revalidatePath.mockReset();
  });

  it("서버 세션 org와 현재 대상만 read RPC에 전달한다", async () => {
    await expect(loadItemVatPeriodsAction(target)).resolves.toMatchObject({ ok: true, data: { version: 3 } });
    expect(mocks.permission).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("list_board_item_vat_periods", {
      p_org_id: "10000000-0000-4000-8000-000000000001",
      p_board_id: target.boardId,
      p_item_id: target.itemId,
    });
  });

  it("정렬·정규화한 기간과 CAS/영수증만 confirm RPC에 보내고 성공 뒤에만 현재 보드를 갱신한다", async () => {
    const result = await confirmItemVatPeriodsAction({
      ...target,
      requestId: "50000000-0000-4000-8000-000000000005",
      expectedVersion: 2,
      confirmation,
    });
    expect(result).toMatchObject({ ok: true, data: { version: 3 } });
    expect(mocks.permission).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001", "work.item_upsert");
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_board_item_vat_periods", {
      p_org_id: "10000000-0000-4000-8000-000000000001",
      p_board_id: target.boardId,
      p_item_id: target.itemId,
      p_source_file_id: confirmation.sourceFileId,
      p_document_biz_no: "1234567891",
      p_periods: [
        { period_start: "2025-01-01", period_end: "2025-06-30", sales_amount: "12345" },
        { period_start: "2025-07-01", period_end: "2025-12-31", sales_amount: "67890" },
      ],
      p_request_id: "50000000-0000-4000-8000-000000000005",
      p_expected_version: 2,
    });
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_actor_id");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/boards/${target.boardId}`);
  });

  it.each([
    ["40001", "conflict"],
    ["42501", "permission"],
    ["22023", "request_mismatch"],
    ["XX000", "unavailable"],
  ])("DB %s를 PII 없는 실패로 닫고 revalidate하지 않는다", async (databaseCode, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: databaseCode, message: "sensitive database detail" } });
    const result = await confirmItemVatPeriodsAction({
      ...target,
      requestId: "50000000-0000-4000-8000-000000000005",
      expectedVersion: 2,
      confirmation,
    });
    expect(result).toMatchObject({ ok: false, code: expectedCode });
    expect(JSON.stringify(result)).not.toContain("sensitive database detail");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("부분적이거나 malformed인 RPC 응답을 성공으로 승격하지 않는다", async () => {
    mocks.rpc.mockResolvedValue({ data: { version: 3, replayed: false, periods: [{ period_start: "2025-01-01" }] }, error: null });
    await expect(loadItemVatPeriodsAction(target)).resolves.toMatchObject({ ok: false, code: "unavailable" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["missing replay marker", { version: 3, periods: [] }],
    ["non-boolean replay marker", { version: 3, replayed: "false", periods: [] }],
    ["impossible Gregorian date", {
      version: 3,
      replayed: false,
      periods: [{
        period_start: "2025-02-30", period_end: "2025-03-01", sales_amount: "1",
        source_file_id: confirmation.sourceFileId, applied_version: 3,
      }],
    }],
    ["duplicate ranges", {
      version: 3,
      replayed: false,
      periods: [snapshot.periods[0], snapshot.periods[0]],
    }],
  ])("%s readback을 canonical success로 승격하지 않는다", async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(loadItemVatPeriodsAction(target)).resolves.toMatchObject({ ok: false, code: "unavailable" });
  });

  it("존재하지 않는 입력 날짜는 confirm RPC 전에 거부한다", async () => {
    await expect(confirmItemVatPeriodsAction({
      ...target,
      requestId: "50000000-0000-4000-8000-000000000005",
      expectedVersion: 2,
      confirmation: {
        ...confirmation,
        periods: [{ periodStart: "2025-02-29", periodEnd: "2025-03-01", salesAmount: "1" }],
      },
    })).resolves.toMatchObject({ ok: false, code: "request_mismatch" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("중복 기간·잘못된 입력과 권한 거부는 RPC 전 차단한다", async () => {
    const duplicate = { ...confirmation, periods: [confirmation.periods[0], confirmation.periods[0]] };
    await expect(confirmItemVatPeriodsAction({
      ...target,
      requestId: "50000000-0000-4000-8000-000000000005",
      expectedVersion: 2,
      confirmation: duplicate,
    })).resolves.toMatchObject({ ok: false, code: "request_mismatch" });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.permission.mockResolvedValue({ kind: "denied", reason: "permission" });
    await expect(confirmItemVatPeriodsAction({
      ...target,
      requestId: "50000000-0000-4000-8000-000000000005",
      expectedVersion: 2,
      confirmation,
    })).resolves.toMatchObject({ ok: false, code: "permission" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

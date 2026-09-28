import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardColumn } from "@/lib/boards/types";

const mocks = vi.hoisted(() => ({ session: vi.fn(), permission: vi.fn(), audit: vi.fn(), graph: vi.fn(), detail: vi.fn(), item: vi.fn(), setCells: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/perm/server", () => ({ recordRiskyAction: mocks.audit }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: mocks.graph }));
vi.mock("@/lib/notify/board-actions", () => ({ notifyBoardItemMoved: vi.fn() }));
import { bulkApplyCellsAction } from "./bulk-actions";

const board = { id: "board-a", source: "core.default-tab/new-lead", is_system: false };
function column(key: string, type: BoardColumn["type"] = "text", over: Partial<BoardColumn> = {}) {
  return { key, type, source: "auto", label: key, options_jsonb: null, ...over };
}
function apply(columnKey: string, value: unknown = "QA-BULK", itemIds = ["item-a", "item-b"]) {
  return bulkApplyCellsAction({ boardId: board.id, itemIds, columnKey, value: value as never, workflowKind: null });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ org: { id: "org-a" }, user: { id: "actor-a" }, role: "owner", scope: "all" });
  mocks.permission.mockResolvedValue({ kind: "allowed" });
  mocks.audit.mockResolvedValue({ ok: true });
  mocks.detail.mockResolvedValue({ board, columns: [column("ad_name")] });
  mocks.item.mockImplementation(async (_ctx, _board, id) => ({ id, deal_id: `deal-${id}` }));
  mocks.rpc.mockImplementation(async (_rpc, args) => ({ error: null, data: [{ deal_id: args.p_deal_id, item_id: "item-a", changed_fields: Object.keys(args.p_patch), replayed: false }] }));
  mocks.setCells.mockResolvedValue({ errors: [] });
  const memberQuery = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: [{ user_id: "member-a" }], error: null }) };
  mocks.from.mockReturnValue(memberQuery);
  mocks.graph.mockResolvedValue({ client: { rpc: mocks.rpc, from: mocks.from }, service: { getBoardDetail: mocks.detail, getItem: mocks.item, setCells: mocks.setCells } });
});

describe("linked new-lead bulk writes use canonical persistence", () => {
  it.each([
    ["ad_name", "acquisition_source"], ["acquisition_source", "acquisition_source"],
    ["rep_name", "representative_name"], ["biz_reg_type", "business_registration_type"],
    ["business_registration_type", "business_registration_type"], ["industry", "industry"],
    ["revenue_band", "revenue_band"], ["sido", "region_sido"], ["region_sido", "region_sido"],
    ["sigungu", "region_sigungu"], ["region_sigungu", "region_sigungu"], ["email", "email"],
  ])("routes %s through the audited %s writer for each selected item", async (key, field) => {
    mocks.detail.mockResolvedValue({ board, columns: [column(key)] });
    const result = await apply(key);
    expect(result).toMatchObject({ ok: true, applied: 2, failed: 0 });
    expect(mocks.setCells).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "update_new_lead_fields", expect.objectContaining({ p_org_id: "org-a", p_deal_id: "deal-item-a", p_patch: { [field]: "QA-BULK" }, p_value_source: "manual" }));
    expect(mocks.rpc.mock.calls[0][1].p_request_id).not.toBe(mocks.rpc.mock.calls[1][1].p_request_id);
    expect(mocks.item.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });
  it.each([ ["applied_on", "date", "2026-09-26"], ["collaborators", "people", ["member-a"]], ["address_detail", "text", "테스트 주소"] ] as const)("uses canonical meta for %s", async (key, type, value) => {
    mocks.detail.mockResolvedValue({ board, columns: [column(key, type)] });
    expect(await apply(key, value)).toMatchObject({ applied: 2, failed: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("update_new_lead_intake_meta", expect.objectContaining({ p_patch: { [key]: value } }));
    expect(mocks.setCells).not.toHaveBeenCalled();
  });
  it("normalizes valid phone and refuses malformed phone without clearing canonical data", async () => {
    mocks.detail.mockResolvedValue({ board, columns: [column("phone", "phone")] });
    expect(await apply("phone", "01012345678")).toMatchObject({ applied: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith("update_new_lead_fields", expect.objectContaining({ p_patch: { phone: "010-1234-5678" } }));
    mocks.rpc.mockClear();
    expect(await apply("phone", "bad phone")).toMatchObject({ applied: 0, failed: 2 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([column("ad_name", "text", { is_readonly: true }), column("ad_name", "text", { source: "calc" }), column("industry", "select", { options_jsonb: { options: [{ id: "allowed", label: "Allowed", order: 0 }] } })])("retains read-only/source/options validation ($key)", async (col) => {
    mocks.detail.mockResolvedValue({ board, columns: [col] });
    expect(await apply(col.key, "invalid")).toMatchObject({ applied: 0, failed: 2 });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.setCells).not.toHaveBeenCalled();
  });
  it("refuses malformed dates before calling the meta RPC", async () => {
    mocks.detail.mockResolvedValue({ board, columns: [column("applied_on", "date")] });
    expect(await apply("applied_on", "not-a-date")).toMatchObject({ applied: 0, failed: 2 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps partial results for hidden/cross-board rows and canonical permission denial without direct fallback", async () => {
    mocks.item.mockRejectedValueOnce(new Error("not visible"));
    mocks.rpc.mockResolvedValueOnce({ error: { code: "42501" }, data: null });
    const result = await apply("ad_name", "QA", ["hidden", "denied", "allowed"]);
    expect(result).toMatchObject({ applied: 1, failed: 2 });
    expect(result.results[1].message).toContain("권한");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.setCells).not.toHaveBeenCalled();
  });
  it("requires bulk permission even for a single canonical row", async () => {
    mocks.permission.mockImplementation(async (_org, scope) => scope === "danger.bulk_edit_delete" ? { kind: "denied", reason: "permission" } : { kind: "allowed" });
    expect(await apply("ad_name", "QA", ["one"])).toMatchObject({ applied: 0, failed: 1 });
    expect(mocks.graph).not.toHaveBeenCalled();
  });
  it("denies owner through fields so assignment lineage cannot be bypassed", async () => {
    mocks.detail.mockResolvedValue({ board, columns: [column("owner", "person")] });
    expect(await apply("owner", "member-a")).toMatchObject({ applied: 0, failed: 2 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves ordinary status/date service writes and transition gates derived from the actual board", async () => {
    mocks.detail.mockResolvedValue({ board, columns: [column("consult_status", "status"), column("recall_at", "date")] });
    expect(await apply("workflow_progress", "상담 전")).toMatchObject({ applied: 2 });
    expect(mocks.setCells).toHaveBeenCalledWith(expect.anything(), board.id, "item-a", { consult_status: "상담 전" }, expect.any(String));
    expect(await apply("recall_at", "2026-09-26")).toMatchObject({ applied: 2 });
    expect(await apply("workflow_progress", "리드컨택으로 넘기기")).toMatchObject({ applied: 0, failed: 2 });
    expect(mocks.setCells).toHaveBeenCalledTimes(4);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps unlinked rows and same-key custom board fields on the existing service", async () => {
    mocks.item.mockResolvedValue({ id: "item-a", deal_id: null });
    expect(await apply("ad_name")).toMatchObject({ applied: 2 });
    mocks.detail.mockResolvedValue({ board: { ...board, source: null }, columns: [column("ad_name")] });
    expect(await apply("ad_name")).toMatchObject({ applied: 2 });
    expect(mocks.setCells).toHaveBeenCalledTimes(4);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

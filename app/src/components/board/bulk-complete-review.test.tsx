// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), permission: vi.fn(), graph: vi.fn(), rpc: vi.fn(),
  detail: vi.fn(), item: vi.fn(), trash: vi.fn(), restore: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: mocks.graph }));
vi.mock("@/app/(app)/boards/bulk-actions", () => ({
  bulkApplyCellsAction: vi.fn(), bulkAssignAction: vi.fn(), bulkMoveGroupAction: vi.fn(),
}));
import { bulkTrashAction, bulkRestoreAction } from "@/app/(app)/boards/bulk-trash-actions";
import { bulkAddNoteAction } from "@/app/(app)/boards/bulk-note-actions";
import { BulkActionBar, type BulkDialogState } from "./BulkActionBar";
import { bulkRangeIds, intersectVisibleSelection, selectionToCsv } from "./bulk-selection";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rows = [{ id: "item-a", title: "Test A" }, { id: "item-b", title: "Test B" }];
const requestIds = { "item-a": "10000000-0000-4000-8000-000000000001", "item-b": "10000000-0000-4000-8000-000000000002" };
const note = { boardId: "board-a", itemIds: rows.map(r => r.id), kind: "memo" as const, body: "original", requestIds };
let root: Root | null = null;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ org: { id: "org-a" }, user: { id: "actor-a" }, role: "owner", scope: "all" });
  mocks.permission.mockResolvedValue({ kind: "allowed" });
  mocks.detail.mockResolvedValue({ board: { id: "board-a", is_system: false } });
  mocks.item.mockImplementation(async (_ctx, _board, id) => ({ id, assigned_to: "actor-a" }));
  mocks.trash.mockResolvedValue(undefined);
  mocks.restore.mockResolvedValue({});
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.graph.mockResolvedValue({ client: { rpc: mocks.rpc }, service: { getBoardDetail: mocks.detail, getItem: mocks.item, deleteItem: mocks.trash, restoreItem: mocks.restore } });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("independent bulk action boundary review", () => {
  it("denied permission performs no trash, restore or note writes", async () => {
    mocks.permission.mockResolvedValue({ kind: "denied", reason: "permission" });
    const input = { boardId: "board-a", itemIds: ["item-a"] };
    expect((await bulkTrashAction(input)).failed).toBe(1);
    expect((await bulkRestoreAction(input)).failed).toBe(1);
    expect((await bulkAddNoteAction(note)).failed).toBe(2);
    expect(mocks.graph).not.toHaveBeenCalled();
  });
  it("system boards refuse every new bulk write", async () => {
    mocks.detail.mockResolvedValue({ board: { is_system: true } });
    await bulkTrashAction({ boardId: "board-a", itemIds: ["item-a"] });
    await bulkRestoreAction({ boardId: "board-a", itemIds: ["item-a"] });
    await bulkAddNoteAction(note);
    expect(mocks.trash).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("scoped and foreign-board note rows never reach RPC", async () => {
    mocks.session.mockResolvedValue({ org: { id: "org-a" }, user: { id: "actor-a" }, role: "member", scope: "assigned" });
    mocks.item.mockResolvedValueOnce({ assigned_to: "actor-b" }).mockRejectedValueOnce(new Error("not found"));
    expect((await bulkAddNoteAction(note)).failed).toBe(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("trash reports partial failure and restores only caller-supplied successes", async () => {
    mocks.trash.mockRejectedValueOnce(new Error("denied"));
    const result = await bulkTrashAction({ boardId: "board-a", itemIds: ["item-a", "item-b", "item-a"] });
    expect([result.applied, result.failed]).toEqual([1, 1]);
    const succeeded = result.results.filter(r => r.ok).map(r => r.itemId);
    await bulkRestoreAction({ boardId: "board-a", itemIds: succeeded });
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.restore.mock.calls[0][2]).toBe("item-b");
  });
  it("note same-payload retry reuses receipts; changed payload is rejected by the actual RPC contract", async () => {
    // migration 143 compares item/kind/body for each request_id (23505 mismatch).
    const receipts = new Map<string, string>();
    let failB = true;
    mocks.rpc.mockImplementation(async (_name, p) => {
      if (p.p_item_id === "item-b" && failB) { failB = false; return { error: { code: "08006" } }; }
      const payload = JSON.stringify([p.p_item_id, p.p_kind, p.p_body]);
      const previous = receipts.get(p.p_request_id);
      if (previous && previous !== payload) return { error: { code: "23505" } };
      receipts.set(p.p_request_id, payload);
      return { error: null };
    });
    expect((await bulkAddNoteAction(note)).applied).toBe(1);
    expect((await bulkAddNoteAction(note)).applied).toBe(2);
    expect(receipts.size).toBe(2);
    expect((await bulkAddNoteAction({ ...note, body: "changed" })).failed).toBe(2);
  });
  it("shift range excludes filtered rows and keeps display order", () => {
    const visible = ["c", "a", "b"];
    expect(bulkRangeIds(visible, "c", "b")).toEqual(visible);
    expect(intersectVisibleSelection(new Set(["hidden", "b", "c"]), visible)).toEqual(["c", "b"]);
  });
  it("CSV quotes lone carriage returns so embedded text cannot become another formula row", () => {
    expect(selectionToCsv(["name"], [["normal\r=1+1"]])).toBe('name\r\n"normal\r=1+1"');
  });
  it("status notifications run only after successful writes and notification failure preserves save success", async () => {
    const { bulkApplyCellsAction } = await vi.importActual<typeof import("@/app/(app)/boards/bulk-actions")>("@/app/(app)/boards/bulk-actions");
    const writes = vi.fn()
      .mockResolvedValueOnce({ errors: [{ message: "invalid status" }] })
      .mockResolvedValueOnce({ errors: [] });
    mocks.detail.mockResolvedValue({ board: { id: "board-a", is_system: false }, columns: [
      { key: "status", type: "status", source: "in", is_readonly: false },
    ] });
    mocks.graph.mockResolvedValue({ client: { rpc: mocks.rpc }, service: { getBoardDetail: mocks.detail, setCells: writes } });
    mocks.rpc.mockResolvedValue({ error: { message: "notification unavailable" } });
    const result = await bulkApplyCellsAction({ boardId: "board-a", itemIds: ["item-a", "item-b"], columnKey: "status", value: "active", workflowKind: null });
    expect([result.applied, result.failed]).toEqual([1, 1]);
    expect(result.results[1]).toMatchObject({ itemId: "item-b", ok: true });
    expect(result.results[1].message).toContain("알림");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("notify_board_item_moved", expect.objectContaining({ p_org_id: "org-a", p_board_id: "board-a", p_item_id: "item-b" }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeGreaterThan(writes.mock.invocationCallOrder[1]);
  });
});

// Mirrors BoardWorkspace's selection ownership; only the actual dialog is under test.
function Harness({ op = "trash" }: { op?: "trash" | "note" }) {
  const [selected, setSelected] = useState(rows);
  const [dialog, setDialog] = useState<BulkDialogState | null>({ op });
  return selected.length > 0 || dialog ? <BulkActionBar boardId="board-a" workflowKind={null}
    totalSelected={selected.length} targets={selected} targetValues={{}} canEdit canDelete canMove
    statusColumn={null} fieldColumns={[]} dateColumns={[]} members={[]} groups={[]}
    exportCsv="" exportFilename="review.csv" dialog={dialog} notice={null}
    onOpenDialog={op => setDialog({ op })} onCloseDialog={() => setDialog(null)}
    onClear={() => setSelected([])} onApplied={ids => setSelected(current => current.filter(r => !ids.includes(r.id)))} onNotice={() => {}} /> : null;
}
async function mount(op: "trash" | "note" = "trash") {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root?.render(<Harness op={op} />); });
  return host;
}
async function click(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text));
  expect(button, `button: ${text}`).toBeDefined();
  await act(async () => { button!.click(); });
}
describe("independent trash recovery behavior", () => {
  it("all-success trash keeps a usable undo after selection clears", async () => {
    const host = await mount(); await click(host, "2개 휴지통으로"); await click(host, "되돌리기");
    expect(mocks.restore.mock.calls.map(c => c[2])).toEqual(["item-a", "item-b"]);
  });
  it("partial trash retains undo and restores only successful rows", async () => {
    mocks.trash.mockImplementation(async (_ctx, _board, id) => { if (id === "item-b") throw new Error("denied"); });
    const host = await mount(); await click(host, "2개 휴지통으로"); await click(host, "되돌리기");
    expect(mocks.restore.mock.calls.map(c => c[2])).toEqual(["item-a"]);
  });
  it("trash retry applies only failures but undo accumulates successes across attempts", async () => {
    mocks.trash.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("temporary"));
    const host = await mount(); await click(host, "2개 휴지통으로"); await click(host, "1개 휴지통으로");
    expect(mocks.trash.mock.calls.map(c => c[2])).toEqual(["item-a", "item-b", "item-b"]);
    await click(host, "되돌리기");
    expect(mocks.restore.mock.calls.map(c => c[2])).toEqual(["item-a", "item-b"]);
  });
  it("partial undo retries only failed restorations", async () => {
    mocks.restore.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("temporary"));
    const host = await mount(); await click(host, "2개 휴지통으로"); await click(host, "되돌리기"); await click(host, "되돌리기");
    expect(mocks.restore.mock.calls.map(c => c[2])).toEqual(["item-a", "item-b", "item-b"]);
  });
});

async function enterBody(host: HTMLElement, value: string) {
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("independent note retry behavior", () => {
  it.each([false, true])("retry preserves draft and skips successful rows (changed body: %s)", async (changeBody) => {
    mocks.rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { code: "08006" } });
    const host = await mount("note");
    await enterBody(host, "original"); await click(host, "2개에 메모 남기기");
    const originalB = mocks.rpc.mock.calls[1][1];
    expect(host.querySelector("textarea")?.value).toBe("original");
    if (changeBody) await enterBody(host, "changed");
    await click(host, "1개에 메모 남기기");
    expect(mocks.rpc.mock.calls.map(c => c[1].p_item_id)).toEqual(["item-a", "item-b", "item-b"]);
    const retry = mocks.rpc.mock.calls[2][1];
    expect(retry.p_body).toBe(changeBody ? "changed" : "original");
    if (changeBody) expect(retry.p_request_id).not.toBe(originalB.p_request_id);
    else expect(retry.p_request_id).toBe(originalB.p_request_id);
  });
});

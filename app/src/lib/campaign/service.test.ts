import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/lib/types";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { EMPTY_FILTERS } from "@/components/board/filters";
import { CampaignConfirmationError, CampaignPermissionError, filterSnapshotHash, RetargetingCampaignService } from "./service";

const ctx = { user: { id: "user-a", email: "a@example.test", name: "A" }, org: { id: "org-a", name: "A" }, role: "member", scope: "assigned" } as Ctx;
const columns = [{ id: "phone-col", org_id: "org-a", board_id: "board-a", key: "phone", label: "연락처", type: "phone", source: "in", rightPinned: false, options_jsonb: null, sort_order: 0, width: null }] as BoardColumn[];
const row = (id: string, phone: string, assigned = "user-a"): ItemWithValues => ({ id, org_id: "org-a", board_id: "board-a", group_id: null, title: id, assigned_to: assigned, sort_order: 0, created_at: "", updated_at: "", values: { phone } });

function setup(rows: ItemWithValues[], options: { allowed?: boolean; blocked?: string[] } = {}) {
  const enqueue = vi.fn(async (input) => ({ queued: input.targets.length, duplicate: 0, failed: 0 }));
  const service = new RetargetingCampaignService(
    { loadScopedBoard: vi.fn(async () => ({ columns, rows })) },
    { canBulkSend: vi.fn(async () => options.allowed ?? true) },
    { blockedPhones: vi.fn(async () => new Set(options.blocked ?? [])) },
    { enqueue },
  );
  const command = { ctx, boardId: "board-a", filters: EMPTY_FILTERS, excludedItemIds: [], phoneColumnKey: "phone", templateId: "template-a", channel: "sms" as const, senderDigits: "0212345678", campaignKey: "special-guarantee-2026-08", confirmedCount: rows.length, unitCostKrw: 20 };
  return { service, enqueue, command };
}

describe("retargeting campaign producer", () => {
  it("passes the exact scoped+filtered snapshot to BBE-30 outbox without an export", async () => {
    const { service, enqueue, command } = setup([row("a", "010-1111-2222"), row("b", "010-3333-4444")]);
    const result = await service.enqueue({ ...command, filters: { ...EMPTY_FILTERS, q: "a" }, confirmedCount: 1 });
    expect(result).toMatchObject({ matched: 1, selected: 1, eligible: 1, estimatedCostKrw: 20, queued: 1 });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org-a", actorId: "user-a", campaignKey: command.campaignKey, targets: [{ itemId: "a", phoneDigits: "01011112222" }] }));
  });

  it("cannot add a client id outside the request-scoped source and supports individual exclusion", async () => {
    const { service, enqueue, command } = setup([row("visible", "01011112222")]);
    const result = await service.enqueue({ ...command, excludedItemIds: ["visible", "hidden-client-id"], confirmedCount: 0 });
    expect(result).toMatchObject({ matched: 1, selected: 0, eligible: 0, queued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails closed on permission and on mismatched typed confirmation", async () => {
    const denied = setup([row("a", "01011112222")], { allowed: false });
    await expect(denied.service.enqueue(denied.command)).rejects.toBeInstanceOf(CampaignPermissionError);
    const allowed = setup([row("a", "01011112222")]);
    await expect(allowed.service.enqueue({ ...allowed.command, confirmedCount: 0 })).rejects.toBeInstanceOf(CampaignConfirmationError);
    expect(allowed.enqueue).not.toHaveBeenCalled();
  });

  it("counts malformed and opted-out contacts before estimating cost", async () => {
    const { service, command } = setup([row("ok", "01011112222"), row("bad", "x"), row("off", "01033334444")], { blocked: ["01033334444"] });
    const result = await service.enqueue({ ...command, confirmedCount: 1, unitCostKrw: 30 });
    expect(result).toMatchObject({ matched: 3, selected: 3, missingOrInvalid: 1, optedOut: 1, eligible: 1, estimatedCostKrw: 30 });
  });

  it("uses D10 canonical normalization for +82, spaces and hyphens before opt-out", async () => {
    const { service, enqueue, command } = setup([
      row("intl", "+82 10-1111-2222"), row("local", "010 3333 4444"), row("hyphen", "010-5555-6666"),
    ], { blocked: ["01011112222"] });
    const result = await service.enqueue({ ...command, confirmedCount: 2 });
    expect(result).toMatchObject({ selected: 3, optedOut: 1, eligible: 2 });
    expect(enqueue.mock.calls[0][0].targets).toEqual([
      { itemId: "local", phoneDigits: "01033334444" }, { itemId: "hyphen", phoneDigits: "01055556666" },
    ]);
  });

  it("does not call outbox for zero eligible rows", async () => {
    const { service, enqueue, command } = setup([], {});
    expect(await service.enqueue({ ...command, confirmedCount: 0 })).toMatchObject({ eligible: 0, queued: 0 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("handles a large snapshot deterministically", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => row(`lead-${index}`, `010${String(index).padStart(8, "0")}`));
    const { service, command } = setup(rows);
    const result = await service.enqueue({ ...command, confirmedCount: 10_000 });
    expect(result).toMatchObject({ matched: 10_000, eligible: 10_000, queued: 10_000 });
    expect(result.filterSnapshotHash).toBe(filterSnapshotHash(EMPTY_FILTERS));
  });

  it("canonicalizes filter option ordering for retry idempotency", () => {
    const a = { ...EMPTY_FILTERS, assignees: ["b", "a"], byColumn: { status: ["z", "a"] } };
    const b = { ...EMPTY_FILTERS, assignees: ["a", "b"], byColumn: { status: ["a", "z"] } };
    expect(filterSnapshotHash(a)).toBe(filterSnapshotHash(b));
  });
});

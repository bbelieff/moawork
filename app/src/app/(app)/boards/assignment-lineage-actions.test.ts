import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  permission: vi.fn(),
  updateMeta: vi.fn(),
  cookieSet: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: mocks.cookieSet })) }));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ org: { id: "org-a" }, user: { id: "actor-a" } })),
}));
vi.mock("@/lib/perm/guard", () => ({ loadPermGuard: mocks.permission }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc: mocks.rpc })),
}));
vi.mock("@/lib/boards/server", () => ({ createRequestBoards: vi.fn() }));
vi.mock("@/lib/new-lead/mutations", () => ({
  canonicalAssignee: vi.fn(),
  createCanonicalNewLead: vi.fn(),
  updateCanonicalNewLead: vi.fn(),
  updateCanonicalNewLeadMeta: mocks.updateMeta,
  updateCanonicalNewLeadTitle: vi.fn(),
  NewLeadMutationError: class NewLeadMutationError extends Error {},
}));
vi.mock("@/lib/new-lead/advance", () => ({
  advanceNewLeadToContact: vi.fn(),
  NewLeadAdvanceError: class NewLeadAdvanceError extends Error {},
}));

import {
  cancelAssignmentHandoffAction,
  readAssignmentLineageAction,
  reassignAssignmentAction,
  scheduleAssignmentHandoffAction,
  setAssignmentFollowerAction,
} from "./assignment-lineage-actions";
import { updateNewLeadMetaAction } from "./new-lead-actions";

const ref = { boardId: "board-a", dealId: "deal-a", itemId: "item-a" };
const requestId = "50000000-0000-4000-8000-000000000001";
const snapshot = {
  orgId: "org-a",
  ...ref,
  baselineAssigneeId: "member-a",
  currentAssigneeId: "member-a",
  version: 0,
  transitions: [],
  followers: [],
  pendingHandoff: null,
};

describe("#599 assignment lineage server actions", () => {
  beforeEach(() => {
    mocks.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name === "read_assignment_lineage"
        ? snapshot
        : { accepted: true, replayed: false, version: 1, handoffId: "handoff-a" },
      error: null,
    }));
    mocks.revalidatePath.mockReset();
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.updateMeta.mockReset().mockResolvedValue({ replayed: false });
    mocks.cookieSet.mockReset();
  });

  it("reads with the session org and the exact board/deal/item projection", async () => {
    await expect(readAssignmentLineageAction(ref)).resolves.toEqual({ ok: true, data: snapshot });
    expect(mocks.rpc).toHaveBeenCalledWith("read_assignment_lineage", {
      p_org_id: "org-a",
      p_board_id: "board-a",
      p_deal_id: "deal-a",
      p_item_id: "item-a",
    });
  });

  it("routes reassign, follower, schedule, and cancel through canonical RPCs with stable request/version inputs", async () => {
    await reassignAssignmentAction({ ...ref, assignedTo: "member-b", expectedAssignedTo: "member-a", expectedVersion: 0, requestId });
    await setAssignmentFollowerAction({ ...ref, userId: "member-c", follow: true, requestId });
    await scheduleAssignmentHandoffAction({ ...ref, toUserId: "member-b", expectedAssignedTo: "member-a", expectedVersion: 0, requestId });
    await cancelAssignmentHandoffAction({ ...ref, handoffId: "handoff-a", requestId });

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "reassign_deal_with_lineage",
      "set_assignment_follower",
      "schedule_assignment_handoff",
      "cancel_assignment_handoff",
    ]);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_org_id: "org-a",
      p_board_id: "board-a",
      p_deal_id: "deal-a",
      p_item_id: "item-a",
      p_assigned_to: "member-b",
      p_expected_assigned_to: "member-a",
      p_expected_version: 0,
      p_request_id: requestId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/boards/board-a");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/newcust");
  });

  it.each([
    ["40001", "conflict"],
    ["42501", "permission"],
    ["22023", "request_mismatch"],
    ["XX000", "unavailable"],
  ])("fails closed without a direct owner-write fallback for RPC code %s", async (rpcCode, expectedCode) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: rpcCode, message: "database detail" } });
    const result = await reassignAssignmentAction({ ...ref, assignedTo: "member-b", expectedAssignedTo: "member-a", expectedVersion: 0, requestId });
    expect(result).toMatchObject({ ok: false, code: expectedCode });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("reassign_deal_with_lineage", expect.any(Object));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

function legacyMetaForm(field: string, values: string[]) {
  const data = new FormData();
  data.set("boardId", "board-a");
  data.set("dealId", "deal-a");
  data.set("itemId", "item-a");
  data.set("field", field);
  data.set("requestId", requestId);
  for (const value of values) data.append("value", value);
  return data;
}

describe("#599 legacy new-lead owner action", () => {
  beforeEach(() => {
    mocks.permission.mockReset().mockResolvedValue({ kind: "allowed" });
    mocks.updateMeta.mockReset().mockResolvedValue({ replayed: false });
    mocks.cookieSet.mockReset();
  });

  it("rejects owner before the legacy meta RPC while preserving non-owner collaborators", async () => {
    await updateNewLeadMetaAction(legacyMetaForm("owner", ["member-b"]));
    expect(mocks.updateMeta).not.toHaveBeenCalled();
    expect(mocks.cookieSet).toHaveBeenCalled();

    await updateNewLeadMetaAction(legacyMetaForm("collaborators", ["member-b", "member-c"]));
    expect(mocks.updateMeta).toHaveBeenCalledWith(expect.anything(), {
      orgId: "org-a",
      dealId: "deal-a",
      requestId,
      patch: { collaborators: ["member-b", "member-c"] },
    });
  });
});

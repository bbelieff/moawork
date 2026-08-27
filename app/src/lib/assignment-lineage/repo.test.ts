import { describe, expect, it } from "vitest";
import {
  AssignmentLineageUnavailableError,
  LocalAssignmentLineageRepo,
  SupabaseAssignmentLineageRepo,
  type AssignmentActor,
} from ".";

const ids = {
  orgA: "00000000-0000-4000-8000-000000000001",
  orgB: "00000000-0000-4000-8000-000000000002",
  owner: "10000000-0000-4000-8000-000000000001",
  member: "10000000-0000-4000-8000-000000000002",
  next: "10000000-0000-4000-8000-000000000003",
  inactive: "10000000-0000-4000-8000-000000000004",
  outsider: "10000000-0000-4000-8000-000000000005",
  deal: "20000000-0000-4000-8000-000000000001",
  item: "30000000-0000-4000-8000-000000000001",
};

const actor: AssignmentActor = { orgId: ids.orgA, userId: ids.owner };
const request = (suffix: number) => `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function local() {
  return new LocalAssignmentLineageRepo({
    members: [
      { orgId: ids.orgA, userId: ids.owner, active: true, canWrite: true },
      { orgId: ids.orgA, userId: ids.member, active: true, canWrite: false },
      { orgId: ids.orgA, userId: ids.next, active: true, canWrite: false },
      { orgId: ids.orgA, userId: ids.inactive, active: false, canWrite: false },
      { orgId: ids.orgB, userId: ids.outsider, active: true, canWrite: true },
    ],
    deals: [{ orgId: ids.orgA, dealId: ids.deal, itemId: ids.item, assignedTo: ids.owner }],
  });
}

describe("assignment-lineage local parity", () => {
  it("keeps a baseline-only read, then atomically projects one replay-safe transition", async () => {
    const repo = local();
    expect(await repo.read(actor, ids.deal)).toMatchObject({
      baselineAssigneeId: ids.owner, currentAssigneeId: ids.owner, version: 0, transitions: [],
    });
    const command = { dealId: ids.deal, assignedTo: ids.member, expectedAssignedTo: ids.owner,
      expectedVersion: 0, requestId: request(1) };
    expect(await repo.reassign(actor, command)).toMatchObject({ replayed: false, version: 1 });
    expect(await repo.reassign(actor, command)).toMatchObject({ replayed: true, version: 1 });
    expect(repo.inspect(ids.deal, ids.orgA)).toMatchObject({
      dealAssignedTo: ids.member, itemAssignedTo: ids.member,
      ownerProjection: ids.member, transitionCount: 1,
    });
    expect((await repo.read(actor, ids.deal)).transitions).toHaveLength(1);
  });

  it("fails closed on request mismatch, stale current/version, inactive and cross-org targets", async () => {
    const repo = local();
    const command = { dealId: ids.deal, assignedTo: ids.member, expectedAssignedTo: ids.owner,
      expectedVersion: 0, requestId: request(2) };
    await repo.reassign(actor, command);
    await expect(repo.reassign(actor, { ...command, assignedTo: ids.next })).rejects.toMatchObject({ code: "22023" });
    await expect(repo.reassign(actor, { ...command, requestId: request(3) })).rejects.toMatchObject({ code: "40001" });
    await expect(repo.reassign(actor, { ...command, assignedTo: ids.inactive, requestId: request(4) })).rejects.toMatchObject({ code: "42501" });
    await expect(repo.reassign(actor, { ...command, assignedTo: ids.outsider, requestId: request(5) })).rejects.toMatchObject({ code: "42501" });
    expect(repo.inspect(ids.deal, ids.orgA)?.transitionCount).toBe(1);
  });

  it("keeps local reads on the same manager/current-assignee/follower boundary as RLS", async () => {
    const repo = local();
    await expect(repo.read({ orgId: ids.orgA, userId: ids.member }, ids.deal)).rejects.toMatchObject({ code: "42501" });
    await repo.setFollower(actor, { dealId: ids.deal, userId: ids.member, follow: true, requestId: request(6) });
    expect((await repo.read({ orgId: ids.orgA, userId: ids.member }, ids.deal)).dealId).toBe(ids.deal);
    await repo.setFollower(actor, { dealId: ids.deal, userId: ids.member, follow: false, requestId: request(7) });
    await expect(repo.read({ orgId: ids.orgA, userId: ids.member }, ids.deal)).rejects.toMatchObject({ code: "42501" });
  });

  it("separates followers and pending handoff from immutable assignment history", async () => {
    const repo = local();
    await repo.setFollower(actor, { dealId: ids.deal, userId: ids.next, follow: true, requestId: request(10) });
    const scheduled = await repo.scheduleHandoff(actor, { dealId: ids.deal, toUserId: ids.member,
      expectedAssignedTo: ids.owner, expectedVersion: 0, requestId: request(11) });
    expect((await repo.read(actor, ids.deal)).pendingHandoff?.id).toBe(scheduled.handoffId);
    await repo.reassign(actor, { dealId: ids.deal, assignedTo: ids.member, expectedAssignedTo: ids.owner,
      expectedVersion: 0, requestId: request(12) });
    expect((await repo.read(actor, ids.deal)).pendingHandoff).toBeNull();
    const before = repo.inspect(ids.deal, ids.orgA);
    await repo.setFollower(actor, { dealId: ids.deal, userId: ids.next, follow: false, requestId: request(13) });
    const after = repo.inspect(ids.deal, ids.orgA);
    expect(after?.transitionCount).toBe(before?.transitionCount);
    expect(after?.handoffEvents).toEqual(before?.handoffEvents);
    await repo.reassign(actor, { dealId: ids.deal, assignedTo: ids.owner, expectedAssignedTo: ids.member,
      expectedVersion: 1, requestId: request(14) });
    expect(repo.inspect(ids.deal, ids.orgA)?.notifications).not.toContain(`${request(14)}:${ids.next}`);
  });
});

describe("assignment-lineage Supabase adapter", () => {
  it("maps every command to the tenant-bound RPC contract and validates reads", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const repo = new SupabaseAssignmentLineageRepo({ rpc(name, params) {
      calls.push({ name, params });
      if (name === "read_assignment_lineage") return Promise.resolve({ error: null, data: {
        orgId: ids.orgA, dealId: ids.deal, itemId: ids.item,
        baselineAssigneeId: ids.owner, currentAssigneeId: ids.owner, version: 0,
        transitions: [], followers: [], pendingHandoff: null,
      } });
      return Promise.resolve({ error: null, data: { accepted: true, replayed: false, version: 0 } });
    } });
    await repo.read(actor, ids.deal);
    await repo.reassign(actor, { dealId: ids.deal, assignedTo: ids.member, expectedAssignedTo: ids.owner, expectedVersion: 0, requestId: request(20) });
    await repo.setFollower(actor, { dealId: ids.deal, userId: ids.next, follow: true, requestId: request(21) });
    await repo.scheduleHandoff(actor, { dealId: ids.deal, toUserId: ids.member, expectedAssignedTo: ids.owner, expectedVersion: 0, requestId: request(22) });
    await repo.cancelHandoff(actor, { dealId: ids.deal, handoffId: request(23), requestId: request(24) });
    expect(calls.map((call) => call.name)).toEqual([
      "read_assignment_lineage", "reassign_deal_with_lineage", "set_assignment_follower",
      "schedule_assignment_handoff", "cancel_assignment_handoff",
    ]);
    expect(calls[1].params).toMatchObject({ p_org_id: ids.orgA, p_deal_id: ids.deal,
      p_expected_assigned_to: ids.owner, p_expected_version: 0 });
  });

  it("does not accept a cross-tenant or malformed read response", async () => {
    const repo = new SupabaseAssignmentLineageRepo({ rpc() { return Promise.resolve({ error: null, data: {
      orgId: ids.orgB, dealId: ids.deal, itemId: ids.item, baselineAssigneeId: null,
      currentAssigneeId: null, version: 0, transitions: [], followers: [], pendingHandoff: null,
    } }); } });
    await expect(repo.read(actor, ids.deal)).rejects.toBeInstanceOf(AssignmentLineageUnavailableError);
  });
});

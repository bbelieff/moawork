import type {
  AssignmentActor,
  AssignmentCommandResult,
  AssignmentFollower,
  AssignmentLineageSnapshot,
  AssignmentPendingHandoff,
  AssignmentTransition,
  CancelHandoffCommand,
  FollowerCommand,
  ReassignCommand,
  ScheduleHandoffCommand,
} from "./contracts";
import type { AssignmentLineagePort } from "./port";

export type LocalAssignmentMember = Readonly<{
  orgId: string;
  userId: string;
  active: boolean;
  canWrite: boolean;
}>;

export type LocalAssignmentDeal = Readonly<{
  orgId: string;
  dealId: string;
  itemId: string;
  assignedTo: string | null;
}>;

type MutableDeal = {
  orgId: string;
  dealId: string;
  itemId: string;
  assignedTo: string | null;
  itemAssignedTo: string | null;
  ownerProjection: string;
  baselineAssigneeId?: string | null;
  version: number;
  transitions: AssignmentTransition[];
  followers: AssignmentFollower[];
  pendingHandoff: AssignmentPendingHandoff | null;
  handoffEvents: Array<{ type: "scheduled" | "cancelled" | "executed"; requestId: string }>;
};

type Receipt = { actorId: string; operation: string; payload: string; result: AssignmentCommandResult };

export class LocalAssignmentLineageError extends Error {
  constructor(message: string, readonly code: "42501" | "40001" | "22023") {
    super(message);
    this.name = "LocalAssignmentLineageError";
  }
}

export class LocalAssignmentLineageRepo implements AssignmentLineagePort {
  private readonly members: LocalAssignmentMember[];
  private readonly deals = new Map<string, MutableDeal>();
  private readonly receipts = new Map<string, Receipt>();
  private readonly notified = new Set<string>();
  private serial = 0;

  constructor(seed: Readonly<{ members: readonly LocalAssignmentMember[]; deals: readonly LocalAssignmentDeal[] }>) {
    this.members = seed.members.map((member) => ({ ...member }));
    for (const deal of seed.deals) {
      this.deals.set(this.key(deal.orgId, deal.dealId), {
        ...deal,
        itemAssignedTo: deal.assignedTo,
        ownerProjection: deal.assignedTo ?? "미정",
        version: 0,
        transitions: [],
        followers: [],
        pendingHandoff: null,
        handoffEvents: [],
      });
    }
  }

  private key(orgId: string, value: string) { return `${orgId}:${value}`; }
  private now() { this.serial += 1; return new Date(Date.UTC(2026, 7, 27, 0, 0, this.serial)).toISOString(); }
  private id(prefix: string) { this.serial += 1; return `${prefix}-${this.serial}`; }

  private member(actor: AssignmentActor) {
    return this.members.find((member) => member.orgId === actor.orgId && member.userId === actor.userId && member.active);
  }

  private requireDeal(actor: AssignmentActor, dealId: string, write = false) {
    const member = this.member(actor);
    const deal = this.deals.get(this.key(actor.orgId, dealId));
    const canRead = member && deal && (
      member.canWrite || deal.assignedTo === actor.userId ||
      deal.followers.some((follower) => follower.userId === actor.userId)
    );
    if (!member || !deal || (write ? !member.canWrite : !canRead)) {
      throw new LocalAssignmentLineageError(write ? "assignment writer required" : "assignment lineage unavailable", "42501");
    }
    return deal;
  }

  private requireActiveTarget(orgId: string, userId: string) {
    if (!this.members.some((member) => member.orgId === orgId && member.userId === userId && member.active)) {
      throw new LocalAssignmentLineageError("active organization member required", "42501");
    }
  }

  private replay(actor: AssignmentActor, requestId: string, operation: string, payload: unknown) {
    if (!requestId) throw new LocalAssignmentLineageError("request id required", "22023");
    const key = this.key(actor.orgId, requestId);
    const encoded = JSON.stringify(payload);
    const receipt = this.receipts.get(key);
    if (!receipt) return { key, encoded, result: null };
    if (receipt.actorId !== actor.userId || receipt.operation !== operation || receipt.payload !== encoded) {
      throw new LocalAssignmentLineageError("idempotency key reuse with different request", "22023");
    }
    return { key, encoded, result: { ...receipt.result, replayed: true } };
  }

  private remember(key: string, actor: AssignmentActor, operation: string, payload: string, result: AssignmentCommandResult) {
    this.receipts.set(key, { actorId: actor.userId, operation, payload, result });
    return result;
  }

  async read(actor: AssignmentActor, dealId: string): Promise<AssignmentLineageSnapshot> {
    const deal = this.requireDeal(actor, dealId);
    const activeFollowers = deal.followers.filter((follower) =>
      this.members.some((member) => member.orgId === actor.orgId && member.userId === follower.userId && member.active));
    const pending = deal.pendingHandoff && this.members.some((member) =>
      member.orgId === actor.orgId && member.userId === deal.pendingHandoff?.toUserId && member.active)
      ? deal.pendingHandoff : null;
    return {
      orgId: actor.orgId, dealId, itemId: deal.itemId,
      baselineAssigneeId: deal.baselineAssigneeId === undefined ? deal.assignedTo : deal.baselineAssigneeId,
      currentAssigneeId: deal.assignedTo, version: deal.version,
      transitions: deal.transitions.map((row) => ({ ...row })),
      followers: activeFollowers.map((row) => ({ ...row })),
      pendingHandoff: pending ? { ...pending } : null,
    };
  }

  async reassign(actor: AssignmentActor, command: ReassignCommand): Promise<AssignmentCommandResult> {
    const deal = this.requireDeal(actor, command.dealId, true);
    if (command.assignedTo) this.requireActiveTarget(actor.orgId, command.assignedTo);
    const payload = { dealId: command.dealId, assignedTo: command.assignedTo,
      expectedAssignedTo: command.expectedAssignedTo, expectedVersion: command.expectedVersion };
    const replay = this.replay(actor, command.requestId, "reassign", payload);
    if (replay.result) return replay.result;
    if (deal.assignedTo !== command.expectedAssignedTo || deal.version !== command.expectedVersion) {
      throw new LocalAssignmentLineageError("assignment version conflict", "40001");
    }
    if (deal.baselineAssigneeId === undefined) deal.baselineAssigneeId = deal.assignedTo;
    if (deal.assignedTo !== command.assignedTo) {
      const previous = deal.assignedTo;
      deal.assignedTo = command.assignedTo;
      deal.itemAssignedTo = command.assignedTo;
      deal.ownerProjection = command.assignedTo ?? "미정";
      deal.version += 1;
      deal.transitions.push({
        id: this.id("transition"), sequence: deal.version, fromUserId: previous,
        toUserId: command.assignedTo, actorUserId: actor.userId,
        requestId: command.requestId, createdAt: this.now(),
      });
      if (deal.pendingHandoff?.toUserId === command.assignedTo) {
        deal.handoffEvents.push({ type: "executed", requestId: command.requestId });
        deal.pendingHandoff = null;
      }
      const recipients = new Set([command.assignedTo, ...deal.followers.map((follower) => follower.userId)]);
      for (const recipient of recipients) {
        if (recipient && recipient !== actor.userId && this.members.some((member) =>
          member.orgId === actor.orgId && member.userId === recipient && member.active)) {
          this.notified.add(`${command.requestId}:${recipient}`);
        }
      }
    }
    const result: AssignmentCommandResult = { accepted: true, replayed: false, version: deal.version,
      currentAssigneeId: deal.assignedTo, itemId: deal.itemId };
    return this.remember(replay.key, actor, "reassign", replay.encoded, result);
  }

  async setFollower(actor: AssignmentActor, command: FollowerCommand): Promise<AssignmentCommandResult> {
    const deal = this.requireDeal(actor, command.dealId, true);
    if (command.follow) this.requireActiveTarget(actor.orgId, command.userId);
    const operation = command.follow ? "follower_add" : "follower_remove";
    const payload = { dealId: command.dealId, userId: command.userId, follow: command.follow };
    const replay = this.replay(actor, command.requestId, operation, payload);
    if (replay.result) return replay.result;
    if (command.follow && !deal.followers.some((follower) => follower.userId === command.userId)) {
      deal.followers.push({ userId: command.userId, addedBy: actor.userId, createdAt: this.now() });
    } else if (!command.follow) {
      deal.followers = deal.followers.filter((follower) => follower.userId !== command.userId);
    }
    return this.remember(replay.key, actor, operation, replay.encoded,
      { accepted: true, replayed: false, version: deal.version });
  }

  async scheduleHandoff(actor: AssignmentActor, command: ScheduleHandoffCommand): Promise<AssignmentCommandResult> {
    const deal = this.requireDeal(actor, command.dealId, true);
    this.requireActiveTarget(actor.orgId, command.toUserId);
    const payload = { dealId: command.dealId, toUserId: command.toUserId,
      expectedAssignedTo: command.expectedAssignedTo, expectedVersion: command.expectedVersion };
    const replay = this.replay(actor, command.requestId, "handoff_schedule", payload);
    if (replay.result) return replay.result;
    if (deal.assignedTo !== command.expectedAssignedTo || deal.version !== command.expectedVersion || deal.pendingHandoff) {
      throw new LocalAssignmentLineageError("assignment version conflict", "40001");
    }
    const handoffId = this.id("handoff");
    deal.pendingHandoff = { id: handoffId, fromUserId: deal.assignedTo, toUserId: command.toUserId,
      createdBy: actor.userId, expectedVersion: deal.version, createdAt: this.now() };
    deal.handoffEvents.push({ type: "scheduled", requestId: command.requestId });
    return this.remember(replay.key, actor, "handoff_schedule", replay.encoded,
      { accepted: true, replayed: false, version: deal.version, handoffId });
  }

  async cancelHandoff(actor: AssignmentActor, command: CancelHandoffCommand): Promise<AssignmentCommandResult> {
    const deal = this.requireDeal(actor, command.dealId, true);
    const payload = { dealId: command.dealId, handoffId: command.handoffId };
    const replay = this.replay(actor, command.requestId, "handoff_cancel", payload);
    if (replay.result) return replay.result;
    if (!deal.pendingHandoff || deal.pendingHandoff.id !== command.handoffId) {
      throw new LocalAssignmentLineageError("pending handoff unavailable", "40001");
    }
    deal.pendingHandoff = null;
    deal.handoffEvents.push({ type: "cancelled", requestId: command.requestId });
    return this.remember(replay.key, actor, "handoff_cancel", replay.encoded,
      { accepted: true, replayed: false, version: deal.version });
  }

  inspect(dealId: string, orgId: string) {
    const deal = this.deals.get(this.key(orgId, dealId));
    if (!deal) return null;
    return {
      dealAssignedTo: deal.assignedTo, itemAssignedTo: deal.itemAssignedTo,
      ownerProjection: deal.ownerProjection, transitionCount: deal.transitions.length,
      handoffEvents: deal.handoffEvents.map((event) => ({ ...event })),
      notifications: [...this.notified].sort(),
    };
  }
}

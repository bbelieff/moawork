import {
  ASSIGNMENT_LINEAGE_RPC,
  type AssignmentActor,
  type AssignmentCommandResult,
  type AssignmentFollower,
  type AssignmentLineageSnapshot,
  type AssignmentPendingHandoff,
  type AssignmentTransition,
  type CancelHandoffCommand,
  type FollowerCommand,
  type ReassignCommand,
  type ScheduleHandoffCommand,
} from "./contracts";
import type { AssignmentLineagePort } from "./port";

export type AssignmentLineageRpcClient = Readonly<{
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
}>;

export class AssignmentLineageUnavailableError extends Error {
  constructor(message = "assignment_lineage_unavailable", readonly code?: string) {
    super(message);
    this.name = "AssignmentLineageUnavailableError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const version = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function transition(value: unknown): AssignmentTransition | null {
  if (!record(value) || !string(value.id) || !version(value.sequence) || value.sequence < 1 ||
      !nullableString(value.fromUserId) || !nullableString(value.toUserId) ||
      !string(value.actorUserId) || !string(value.requestId) || !string(value.createdAt)) return null;
  return value as unknown as AssignmentTransition;
}

function follower(value: unknown): AssignmentFollower | null {
  if (!record(value) || !string(value.userId) || !string(value.addedBy) || !string(value.createdAt)) return null;
  return value as unknown as AssignmentFollower;
}

function pending(value: unknown): AssignmentPendingHandoff | null {
  if (!record(value) || !string(value.id) || !nullableString(value.fromUserId) ||
      !string(value.toUserId) || !string(value.createdBy) ||
      !version(value.expectedVersion) || !string(value.createdAt)) return null;
  return value as unknown as AssignmentPendingHandoff;
}

export function parseAssignmentLineageSnapshot(value: unknown, actor: AssignmentActor, dealId: string): AssignmentLineageSnapshot {
  if (!record(value) || value.orgId !== actor.orgId || value.dealId !== dealId ||
      !string(value.itemId) || !nullableString(value.baselineAssigneeId) ||
      !nullableString(value.currentAssigneeId) || !version(value.version) ||
      !Array.isArray(value.transitions) || !Array.isArray(value.followers) ||
      (value.pendingHandoff !== null && !record(value.pendingHandoff))) {
    throw new AssignmentLineageUnavailableError("invalid_assignment_lineage_snapshot");
  }
  const transitions = value.transitions.map(transition);
  const followers = value.followers.map(follower);
  const next = value.pendingHandoff === null ? null : pending(value.pendingHandoff);
  if (transitions.some((row) => row === null) || followers.some((row) => row === null) ||
      (value.pendingHandoff !== null && next === null)) {
    throw new AssignmentLineageUnavailableError("invalid_assignment_lineage_snapshot");
  }
  return {
    orgId: actor.orgId,
    dealId,
    itemId: value.itemId,
    baselineAssigneeId: value.baselineAssigneeId,
    currentAssigneeId: value.currentAssigneeId,
    version: value.version,
    transitions: transitions as AssignmentTransition[],
    followers: followers as AssignmentFollower[],
    pendingHandoff: next,
  };
}

function result(value: unknown): AssignmentCommandResult {
  if (!record(value) || value.accepted !== true || typeof value.replayed !== "boolean" || !version(value.version) ||
      (value.currentAssigneeId !== undefined && !nullableString(value.currentAssigneeId)) ||
      (value.itemId !== undefined && !string(value.itemId)) ||
      (value.handoffId !== undefined && !string(value.handoffId))) {
    throw new AssignmentLineageUnavailableError("invalid_assignment_lineage_result");
  }
  return value as unknown as AssignmentCommandResult;
}

export class SupabaseAssignmentLineageRepo implements AssignmentLineagePort {
  constructor(private readonly client: AssignmentLineageRpcClient) {}

  private async call(name: string, params: Record<string, unknown>) {
    const response = await this.client.rpc(name, params);
    if (response.error) throw new AssignmentLineageUnavailableError(response.error.message, response.error.code);
    return response.data;
  }

  async read(actor: AssignmentActor, dealId: string) {
    return parseAssignmentLineageSnapshot(await this.call(ASSIGNMENT_LINEAGE_RPC.read, {
      p_org_id: actor.orgId, p_deal_id: dealId,
    }), actor, dealId);
  }

  async reassign(actor: AssignmentActor, command: ReassignCommand) {
    return result(await this.call(ASSIGNMENT_LINEAGE_RPC.reassign, {
      p_org_id: actor.orgId, p_deal_id: command.dealId, p_assigned_to: command.assignedTo,
      p_expected_assigned_to: command.expectedAssignedTo, p_expected_version: command.expectedVersion,
      p_request_id: command.requestId,
    }));
  }

  async setFollower(actor: AssignmentActor, command: FollowerCommand) {
    return result(await this.call(ASSIGNMENT_LINEAGE_RPC.follower, {
      p_org_id: actor.orgId, p_deal_id: command.dealId, p_user_id: command.userId,
      p_follow: command.follow, p_request_id: command.requestId,
    }));
  }

  async scheduleHandoff(actor: AssignmentActor, command: ScheduleHandoffCommand) {
    return result(await this.call(ASSIGNMENT_LINEAGE_RPC.schedule, {
      p_org_id: actor.orgId, p_deal_id: command.dealId, p_to_user_id: command.toUserId,
      p_expected_assigned_to: command.expectedAssignedTo, p_expected_version: command.expectedVersion,
      p_request_id: command.requestId,
    }));
  }

  async cancelHandoff(actor: AssignmentActor, command: CancelHandoffCommand) {
    return result(await this.call(ASSIGNMENT_LINEAGE_RPC.cancel, {
      p_org_id: actor.orgId, p_deal_id: command.dealId, p_handoff_id: command.handoffId,
      p_request_id: command.requestId,
    }));
  }
}


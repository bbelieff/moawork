export type AssignmentActor = Readonly<{ orgId: string; userId: string }>;

export type AssignmentProjectionRef = Readonly<{
  boardId: string;
  dealId: string;
  itemId: string;
}>;

export type AssignmentTransition = Readonly<{
  id: string;
  sequence: number;
  fromUserId: string | null;
  toUserId: string | null;
  actorUserId: string;
  requestId: string;
  createdAt: string;
}>;

export type AssignmentFollower = Readonly<{
  userId: string;
  addedBy: string;
  createdAt: string;
}>;

export type AssignmentPendingHandoff = Readonly<{
  id: string;
  fromUserId: string | null;
  toUserId: string;
  createdBy: string;
  expectedVersion: number;
  createdAt: string;
}>;

export type AssignmentLineageSnapshot = Readonly<{
  orgId: string;
  boardId: string;
  dealId: string;
  itemId: string;
  baselineAssigneeId: string | null;
  currentAssigneeId: string | null;
  version: number;
  transitions: readonly AssignmentTransition[];
  followers: readonly AssignmentFollower[];
  pendingHandoff: AssignmentPendingHandoff | null;
}>;

export type AssignmentCommandResult = Readonly<{
  accepted: true;
  replayed: boolean;
  version: number;
  currentAssigneeId?: string | null;
  itemId?: string;
  handoffId?: string;
}>;

export type ReassignCommand = AssignmentProjectionRef & Readonly<{
  assignedTo: string | null;
  expectedAssignedTo: string | null;
  expectedVersion: number;
  requestId: string;
}>;

export type FollowerCommand = AssignmentProjectionRef & Readonly<{
  userId: string;
  follow: boolean;
  requestId: string;
}>;

export type ScheduleHandoffCommand = AssignmentProjectionRef & Readonly<{
  toUserId: string;
  expectedAssignedTo: string | null;
  expectedVersion: number;
  requestId: string;
}>;

export type CancelHandoffCommand = AssignmentProjectionRef & Readonly<{
  handoffId: string;
  requestId: string;
}>;

export const ASSIGNMENT_LINEAGE_RPC = {
  read: "read_assignment_lineage",
  reassign: "reassign_deal_with_lineage",
  follower: "set_assignment_follower",
  schedule: "schedule_assignment_handoff",
  cancel: "cancel_assignment_handoff",
} as const;

import type {
  AssignmentActor,
  AssignmentCommandResult,
  AssignmentLineageSnapshot,
  CancelHandoffCommand,
  FollowerCommand,
  ReassignCommand,
  ScheduleHandoffCommand,
} from "./contracts";

export interface AssignmentLineagePort {
  read(actor: AssignmentActor, dealId: string): Promise<AssignmentLineageSnapshot>;
  reassign(actor: AssignmentActor, command: ReassignCommand): Promise<AssignmentCommandResult>;
  setFollower(actor: AssignmentActor, command: FollowerCommand): Promise<AssignmentCommandResult>;
  scheduleHandoff(actor: AssignmentActor, command: ScheduleHandoffCommand): Promise<AssignmentCommandResult>;
  cancelHandoff(actor: AssignmentActor, command: CancelHandoffCommand): Promise<AssignmentCommandResult>;
}


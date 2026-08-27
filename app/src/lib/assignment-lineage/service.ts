import type {
  AssignmentActor,
  AssignmentProjectionRef,
  CancelHandoffCommand,
  FollowerCommand,
  ReassignCommand,
  ScheduleHandoffCommand,
} from "./contracts";
import type { AssignmentLineagePort } from "./port";

export class AssignmentLineageService {
  constructor(private readonly repo: AssignmentLineagePort) {}
  read(actor: AssignmentActor, ref: AssignmentProjectionRef) { return this.repo.read(actor, ref); }
  reassign(actor: AssignmentActor, command: ReassignCommand) { return this.repo.reassign(actor, command); }
  setFollower(actor: AssignmentActor, command: FollowerCommand) { return this.repo.setFollower(actor, command); }
  scheduleHandoff(actor: AssignmentActor, command: ScheduleHandoffCommand) { return this.repo.scheduleHandoff(actor, command); }
  cancelHandoff(actor: AssignmentActor, command: CancelHandoffCommand) { return this.repo.cancelHandoff(actor, command); }
}

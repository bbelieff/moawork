import type { WorkBoardSnapshot, WorkCommand, WorkCommandResult } from "./contracts";

/** Read/write composition boundary shared by the hosted RPC and local-dev source. */
export interface WorkManagementPort {
  load(orgId: string): Promise<WorkBoardSnapshot>;
  execute(command: WorkCommand): Promise<WorkCommandResult>;
}

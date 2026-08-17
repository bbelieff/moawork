export const BOARD_COLUMN_RPC = {
  command: "execute_board_column_command",
  typeDryRun: "board_column_type_dry_run",
} as const;

export type BoardColumnCommandOperation =
  | "create_at"
  | "duplicate"
  | "rename"
  | "settings"
  | "reorder"
  | "type_commit"
  | "archive"
  | "restore";

export type BoardColumnPolicy = {
  roles?: Array<"owner" | "admin" | "team_lead" | "member">;
  scopes?: Array<"all" | "department" | "assigned">;
  userIds?: string[];
};

export type BoardColumnCommandArgs = {
  p_org_id: string;
  p_board_id: string;
  p_column_id: string | null;
  p_operation: BoardColumnCommandOperation;
  p_request_id: string;
  p_payload: Record<string, unknown>;
};

export type BoardColumnTypeDryRunArgs = {
  p_org_id: string;
  p_board_id: string;
  p_column_id: string;
  p_target_type: string;
};

export type BoardColumnTypeDryRun = {
  columnId: string;
  targetType: string;
  totalValues: number;
  invalidValues: number;
  safe: boolean;
  fingerprint: string;
};

export type BoardColumnCommandResult = {
  accepted: true;
  replayed: boolean;
  operation: BoardColumnCommandOperation;
  columnId: string;
  column: Record<string, unknown>;
};

export const BOARD_COLUMN_ERROR_CODES = {
  permissionDenied: "42501",
  notFound: "P0002",
  invalidOrUnsafe: "22023",
  staleDryRun: "40001",
} as const;

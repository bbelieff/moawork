import type { BoardColumnTypeDryRun } from "@/lib/boards/column-metadata-contract";

export type ColumnCommandState = {
  ok: boolean;
  message: string | null;
  archivedColumnId?: string;
  dryRun?: BoardColumnTypeDryRun;
};

export const INITIAL_COLUMN_COMMAND_STATE: ColumnCommandState = { ok: true, message: null };

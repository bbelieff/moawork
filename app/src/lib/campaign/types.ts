import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import type { BoardFilterState } from "@/components/board/filters";
import type { Ctx } from "@/lib/types";

export type CampaignChannel = "sms" | "alimtalk";

export interface RetargetingCommand {
  ctx: Ctx;
  boardId: string;
  filters: BoardFilterState;
  excludedItemIds: readonly string[];
  phoneColumnKey: string;
  templateId: string;
  channel: CampaignChannel;
  senderDigits: string;
  senderProfileId?: string | null;
  campaignKey: string;
  confirmedCount: number;
  unitCostKrw: number;
}

export interface ScopedBoardSnapshot {
  columns: readonly BoardColumn[];
  rows: readonly ItemWithValues[];
}

export interface CampaignSourcePort {
  loadScopedBoard(ctx: Ctx, boardId: string): Promise<ScopedBoardSnapshot>;
}

export interface CampaignPermissionPort {
  canBulkSend(ctx: Ctx): Promise<boolean>;
}

export interface CampaignOptOutPort {
  blockedPhones(orgId: string, phoneDigits: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface CampaignOutboxTarget {
  itemId: string;
  phoneDigits: string;
}

export interface CampaignOutboxPort {
  enqueue(input: {
    orgId: string;
    actorId: string;
    templateId: string;
    channel: CampaignChannel;
    senderDigits: string;
    senderProfileId?: string | null;
    campaignKey: string;
    filterSnapshotHash: string;
    targets: readonly CampaignOutboxTarget[];
  }): Promise<{ queued: number; duplicate: number }>;
}

export interface RetargetingResult {
  filterSnapshotHash: string;
  matched: number;
  selected: number;
  missingOrInvalid: number;
  optedOut: number;
  eligible: number;
  estimatedCostKrw: number;
  queued: number;
  duplicate: number;
}

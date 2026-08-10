export const REJECTION_REASON_CODES = [
  "credit",
  "revenue",
  "industry",
  "documents",
  "timing",
  "other",
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

export interface RejectionInput {
  companyId: string;
  policyfundItemId: string;
  assigneeId: string;
  reason: RejectionReasonCode;
  otherReason?: string | null;
  rejectedAt: string;
  reapplyNoticeDate: string;
}

export interface RejectionHistoryEntry extends RejectionInput {
  id: string;
  reasonText: string;
}

export interface ReapplyTarget {
  companyId: string;
  latestRejection: RejectionHistoryEntry;
}

export interface BatchTargetSelection {
  targetIds: string[];
  count: number;
}

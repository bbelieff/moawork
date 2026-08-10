import {
  REJECTION_REASON_CODES,
  type BatchTargetSelection,
  type ReapplyTarget,
  type RejectionHistoryEntry,
  type RejectionInput,
  type RejectionReasonCode,
} from "./types";

const REASON_LABELS: Record<RejectionReasonCode, string> = {
  credit: "신용 기준 미충족",
  revenue: "매출 기준 미충족",
  industry: "지원 대상 업종 아님",
  documents: "서류 보완 필요",
  timing: "신청 시기 부적합",
  other: "기타",
};

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field}은(는) 필수입니다.`);
  return normalized;
}

function isoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${field}은(는) YYYY-MM-DD 날짜여야 합니다.`);
  }
  return value;
}

export function rejectionReasonText(input: Pick<RejectionInput, "reason" | "otherReason">): string {
  if (!REJECTION_REASON_CODES.includes(input.reason)) throw new Error("지원하지 않는 부결 사유입니다.");
  if (input.reason !== "other") return REASON_LABELS[input.reason];
  return required(input.otherReason ?? "", "기타 사유");
}

/**
 * 업체 마스터에 귀속되는 append-only 부결 이력 장부.
 * 호출자가 실제 저장소에 직렬화할 수 있도록 데이터 외의 의존성은 두지 않는다.
 */
export class RejectionLedger {
  readonly #entries: RejectionHistoryEntry[];

  constructor(seed: readonly RejectionHistoryEntry[] = []) {
    this.#entries = seed.map((entry) => ({ ...entry }));
  }

  record(input: RejectionInput): RejectionHistoryEntry {
    const companyId = required(input.companyId, "회사");
    const policyfundItemId = required(input.policyfundItemId, "업무");
    const assigneeId = required(input.assigneeId, "담당자");
    const rejectedAt = isoDate(input.rejectedAt, "부결일");
    const reapplyNoticeDate = isoDate(input.reapplyNoticeDate, "재신청 안내일");
    const reasonText = rejectionReasonText(input);
    const id = `${companyId}:${policyfundItemId}:${this.#entries.length + 1}`;
    const entry = {
      ...input,
      id,
      companyId,
      policyfundItemId,
      assigneeId,
      rejectedAt,
      reapplyNoticeDate,
      otherReason: input.reason === "other" ? reasonText : null,
      reasonText,
    } satisfies RejectionHistoryEntry;
    this.#entries.push(entry);
    return { ...entry };
  }

  historyForCompany(companyId: string): RejectionHistoryEntry[] {
    return this.#entries.filter((entry) => entry.companyId === companyId).map((entry) => ({ ...entry }));
  }

  reapplyTargets(fromDate: string, throughDate: string): ReapplyTarget[] {
    const from = isoDate(fromDate, "조회 시작일");
    const through = isoDate(throughDate, "조회 종료일");
    if (from > through) throw new Error("조회 시작일은 종료일보다 늦을 수 없습니다.");

    const latestByCompany = new Map<string, RejectionHistoryEntry>();
    for (const entry of this.#entries) {
      if (entry.reapplyNoticeDate < from || entry.reapplyNoticeDate > through) continue;
      const previous = latestByCompany.get(entry.companyId);
      if (!previous || previous.rejectedAt <= entry.rejectedAt) latestByCompany.set(entry.companyId, entry);
    }
    return [...latestByCompany.values()]
      .sort((a, b) => a.reapplyNoticeDate.localeCompare(b.reapplyNoticeDate) || a.companyId.localeCompare(b.companyId))
      .map((latestRejection) => ({ companyId: latestRejection.companyId, latestRejection: { ...latestRejection } }));
  }
}

export function selectBatchTargets(
  available: readonly ReapplyTarget[],
  selectedCompanyIds: readonly string[],
): BatchTargetSelection {
  const availableIds = new Set(available.map((target) => target.companyId));
  const targetIds = [...new Set(selectedCompanyIds)].filter((id) => availableIds.has(id));
  if (targetIds.length === 0) throw new Error("발송할 재신청 대상을 한 곳 이상 골라 주세요.");
  return { targetIds, count: targetIds.length };
}

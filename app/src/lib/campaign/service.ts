import { createHash } from "node:crypto";
import { applyFilters, type BoardFilterState } from "@/components/board/filters";
import { analyzePhone } from "@/lib/format/phone";
import type {
  CampaignOptOutPort,
  CampaignOutboxPort,
  CampaignPermissionPort,
  CampaignSourcePort,
  RetargetingCommand,
  RetargetingResult,
} from "./types";

export class CampaignPermissionError extends Error {}
export class CampaignConfirmationError extends Error {}

function canonicalFilters(filters: BoardFilterState): string {
  const byColumn = Object.fromEntries(
    Object.entries(filters.byColumn)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [key, [...values].sort()]),
  );
  return JSON.stringify({
    q: filters.q.trim(),
    assignees: [...filters.assignees].sort(),
    byColumn,
    sortKey: filters.sortKey,
    sortDir: filters.sortDir,
    columnLimit: filters.columnLimit,
  });
}

export function filterSnapshotHash(filters: BoardFilterState): string {
  return createHash("sha256").update(canonicalFilters(filters)).digest("hex");
}

export function normalizeCampaignPhone(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = analyzePhone(String(value));
  return result.status === "normalized" ? result.normalized : null;
}

export class RetargetingCampaignService {
  constructor(
    private readonly source: CampaignSourcePort,
    private readonly permission: CampaignPermissionPort,
    private readonly optOut: CampaignOptOutPort,
    private readonly outbox: CampaignOutboxPort,
  ) {}

  async enqueue(command: RetargetingCommand): Promise<RetargetingResult> {
    if (!await this.permission.canBulkSend(command.ctx)) throw new CampaignPermissionError("대량 발송 권한이 없어요.");
    if (!Number.isInteger(command.unitCostKrw) || command.unitCostKrw < 0) throw new Error("건당 비용이 올바르지 않아요.");
    if (!/^\d{9,12}$/.test(command.senderDigits)) throw new Error("발신번호를 확인해 주세요.");

    // Source applies tenant and assigned-scope before this in-memory filter. Client-supplied ids never add rows.
    const snapshot = await this.source.loadScopedBoard(command.ctx, command.boardId);
    const matched = applyFilters(snapshot.rows, snapshot.columns, command.filters);
    const excluded = new Set(command.excludedItemIds);
    const selected = matched.filter((row) => !excluded.has(row.id));
    const valid = selected.flatMap((row) => {
      const phoneDigits = normalizeCampaignPhone(row.values[command.phoneColumnKey]);
      return phoneDigits ? [{ itemId: row.id, phoneDigits }] : [];
    });
    const blocked = await this.optOut.blockedPhones(command.ctx.org.id, valid.map((target) => target.phoneDigits));
    const targets = valid.filter((target) => !blocked.has(target.phoneDigits));

    if (command.confirmedCount !== targets.length) {
      throw new CampaignConfirmationError(`발송 가능 건수 ${targets.length}건을 다시 입력해 주세요.`);
    }
    const hash = filterSnapshotHash(command.filters);
    if (targets.length === 0) {
      return { filterSnapshotHash: hash, matched: matched.length, selected: selected.length,
        missingOrInvalid: selected.length - valid.length, optedOut: valid.length, eligible: 0,
        estimatedCostKrw: 0, queued: 0, duplicate: 0, failed: 0 };
    }
    const result = await this.outbox.enqueue({
      orgId: command.ctx.org.id,
      actorId: command.ctx.user.id,
      templateId: command.templateId,
      channel: command.channel,
      senderDigits: command.senderDigits,
      senderProfileId: command.senderProfileId,
      campaignKey: command.campaignKey,
      filterSnapshotHash: hash,
      targets,
    });
    return {
      filterSnapshotHash: hash,
      matched: matched.length,
      selected: selected.length,
      missingOrInvalid: selected.length - valid.length,
      optedOut: valid.length - targets.length,
      eligible: targets.length,
      estimatedCostKrw: targets.length * command.unitCostKrw,
      ...result,
    };
  }
}

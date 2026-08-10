import { SEOUL_NEWCUST_BOARD } from "@/lib/structure-packs";

export const LEGACY_CUTOVER_REQUIRED_CAPABILITIES = [
  "stable_legacy_key",
  "dry_run",
  "quarantine",
  "atomic_apply",
  "source_checksum",
  "target_checksum",
  "source_read_only_fence",
] as const;

type MappingStatus = "ready" | "transform" | "decision_required";

export interface LegacyFieldMapping {
  source: string;
  target: string;
  status: MappingStatus;
  reason?: string;
}

export interface LegacyCutoverPreflight {
  targetPack: string;
  targetColumnCount: number;
  targetGroupCount: number;
  mappings: LegacyFieldMapping[];
  blockers: string[];
  requiresAdditiveMigration: true;
  migrationReason: string;
}

const EXPECTED_TARGETS = [
  ["deals.applied_on", "___1", "date", "ready"],
  ["deals.custom.ad_name", "text_mm40jz80", "text", "ready"],
  ["companies.biz_type", "text_mkz0gcyr", "text", "ready"],
  ["companies.revenue", "___88", "text", "transform", "숫자를 현재 문자열 계약으로 명시 변환해야 합니다."],
  ["companies.phone", "text8", "text", "ready"],
  ["deals.custom.files", "file", "file", "transform", "조직 경계가 확인된 Storage 경로만 허용해야 합니다."],
  ["companies.owner_name", "dup__of____", "text", "ready"],
  ["deals.custom.address", "___8", "text", "ready"],
  ["companies.email", "email_mm40x2jr", "email", "ready"],
  ["deals.assigned_to ?? companies.assigned_to", "person", "person", "transform", "현재 조직의 활성 멤버인지 재검증해야 합니다."],
  ["deals.status_note", "long_text", "longtext", "ready"],
  ["deals.custom.next_contact", "date", "datetime", "transform", "날짜를 회사 시간대의 명시적 시각으로 변환해야 합니다."],
] as const;

function targetColumns() {
  return new Map(SEOUL_NEWCUST_BOARD.columns.map((column) => [column.key, column]));
}

/**
 * 001 marketing 원본과 현재 main의 031 신규업체 팩 사이 정적 컷오버 계약.
 * 실제 고객 행은 읽지 않으며, 모호한 값은 임의 저장 대신 결정 게이트로 남긴다.
 */
export function preflightLegacyCutover(): LegacyCutoverPreflight {
  const columns = targetColumns();
  const blockers: string[] = [];
  const mappings: LegacyFieldMapping[] = EXPECTED_TARGETS.map(
    ([source, key, type, status, reason]) => {
      const column = columns.get(key);
      if (!column || column.type !== type) {
        blockers.push(`target_contract_mismatch:${key}`);
      }
      return { source, target: `item_values.${key}`, status, ...(reason ? { reason } : {}) };
    },
  );

  mappings.unshift({
    source: "deals.title ?? companies.name",
    target: "items.title",
    status: "transform",
    reason: "빈 제목은 임의 생성하지 않고 quarantine 해야 합니다.",
  });
  mappings.push(
    {
      source: "stages.name(kind=marketing)",
      target: "board_groups + item_values.status",
      status: "decision_required",
      reason: "031의 14개 그룹·16개 상담상황과 기존 단계의 exact 대응표가 필요합니다.",
    },
    {
      source: "deals.amount",
      target: "item_values.numeric",
      status: "decision_required",
      reason: "원본 예상 매출과 031의 계약금은 의미가 달라 자동 이관할 수 없습니다.",
    },
    {
      source: "deals.custom.priority",
      target: "quarantine",
      status: "decision_required",
      reason: "031 신규업체 팩에 우선순위 컬럼이 없습니다.",
    },
  );

  return {
    targetPack: "pack.seoul.policyfund1/newcust",
    targetColumnCount: SEOUL_NEWCUST_BOARD.columns.length,
    targetGroupCount: SEOUL_NEWCUST_BOARD.sections.length,
    mappings,
    blockers,
    requiresAdditiveMigration: true,
    migrationReason:
      "003에는 legacy stable key, batch/checksum, quarantine, 원자 apply RPC와 001 쓰기 차단 계약이 없으므로 새 additive migration이 필요합니다.",
  };
}

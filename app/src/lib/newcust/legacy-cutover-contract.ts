import { POLICYFUND_NEWCUST_BOARD } from "@/lib/migration/monday-mapping";

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

export type MondayAutomationDispositionKind =
  | "supported_draft_only"
  | "conditional_unsupported"
  | "pipeline_translation_required"
  | "unknown_not_imported";

export interface MondayAutomationDisposition {
  sourceAutomationId: number;
  sourceColumn: string;
  sourceLabelId: number | null;
  disposition: MondayAutomationDispositionKind;
  target: "draft_rule_after_identity_mapping" | null;
  note: string;
}

export interface MondayCutoverGap {
  id: "G1" | "G2" | "G3" | "G4" | "G5";
  schemaState: string;
  cutoverState: string;
}

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
  sourceLabelIdentity: string;
  automationDispositions: readonly MondayAutomationDisposition[];
  gaps: readonly MondayCutoverGap[];
  requiresFreshMondayCount: true;
  migrationNumberGate: typeof MONDAY_MIGRATION_NUMBER_GATE;
  blockers: string[];
  requiresAdditiveMigration: true;
  migrationReason: string;
}

/**
 * Monday `statusColumnValue.index` is the source label ID, not its display
 * ordinal. The current 031 pack uses text option IDs, so none of these rows
 * may activate a target rule until a future additive contract persists an
 * explicit source-label-ID to target-option identity mapping.
 */
export const MONDAY_AUTOMATION_DISPOSITIONS: readonly MondayAutomationDisposition[] = [
  { sourceAutomationId: 1585150, sourceColumn: "status", sourceLabelId: 0, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "보류 → 보류" },
  { sourceAutomationId: 1585152, sourceColumn: "status", sourceLabelId: 2, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "거절 → 거절" },
  { sourceAutomationId: 1585154, sourceColumn: "status", sourceLabelId: 3, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "1차 부재 → 1차 부재" },
  { sourceAutomationId: 2373960, sourceColumn: "status", sourceLabelId: 4, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "2차 상담예약 → 2차 상담고객" },
  { sourceAutomationId: 2422556, sourceColumn: "status", sourceLabelId: 6, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "해당안됨 → 해당안되는 업체" },
  { sourceAutomationId: 2425994, sourceColumn: "status", sourceLabelId: 7, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "2차 후 고민 → 2차 후 고민" },
  { sourceAutomationId: 3291483, sourceColumn: "status", sourceLabelId: 8, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "관리 → 관리" },
  { sourceAutomationId: 5839527, sourceColumn: "status", sourceLabelId: 9, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "2차 부재 → 2차 부재" },
  { sourceAutomationId: 17898633, sourceColumn: "status", sourceLabelId: 13, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "지원사업만 알아봄 → 지원사업만" },
  { sourceAutomationId: 28213018, sourceColumn: "status", sourceLabelId: 12, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "제조업 1차부재 → 제조업 1차 부재" },
  { sourceAutomationId: 28213171, sourceColumn: "status", sourceLabelId: 14, disposition: "supported_draft_only", target: "draft_rule_after_identity_mapping", note: "제조업 2차부재 → 제조업 2차 부재" },
  { sourceAutomationId: 24895886, sourceColumn: "color_mkyf3jj6", sourceLabelId: 1, disposition: "conditional_unsupported", target: null, note: "담당자 조건 OWNER_A가 필요한 규칙" },
  { sourceAutomationId: 25226879, sourceColumn: "color_mkyf3jj6", sourceLabelId: 1, disposition: "conditional_unsupported", target: null, note: "담당자 조건 OWNER_B가 필요한 규칙" },
  { sourceAutomationId: 1585198, sourceColumn: "color_mkyf3bdg", sourceLabelId: 1, disposition: "pipeline_translation_required", target: null, note: "컨텍관리 보드 이동은 파이프라인 단계 전이 결정이 필요" },
  { sourceAutomationId: 25147700, sourceColumn: "color", sourceLabelId: null, disposition: "unknown_not_imported", target: null, note: "recipe 135의 액션 미상" },
  { sourceAutomationId: 25147729, sourceColumn: "dup__of_ai___", sourceLabelId: null, disposition: "unknown_not_imported", target: null, note: "recipe 135의 액션 미상" },
  { sourceAutomationId: 25148161, sourceColumn: "dup__of_ai_2___", sourceLabelId: null, disposition: "unknown_not_imported", target: null, note: "recipe 135의 액션 미상" },
  { sourceAutomationId: 30249627, sourceColumn: "color3", sourceLabelId: null, disposition: "unknown_not_imported", target: null, note: "recipe 135의 액션 미상" },
  { sourceAutomationId: 32488853, sourceColumn: "color_mm3acc4d", sourceLabelId: null, disposition: "unknown_not_imported", target: null, note: "recipe 135의 액션 미상" },
];

export const MONDAY_CUTOVER_GAPS: readonly MondayCutoverGap[] = [
  { id: "G1", schemaState: "SCHEMA_PRESENT", cutoverState: "CUTOVER_UNMAPPED: source subitem relationships are deferred" },
  { id: "G2", schemaState: "SCHEMA_PRESENT", cutoverState: "CUTOVER_UNMAPPED: live view filters and per-user settings are not mapped" },
  { id: "G3", schemaState: "PARTIAL_SCHEMA", cutoverState: "CUTOVER_UNMAPPED: source label IDs do not bind to status-text rules" },
  { id: "G4", schemaState: "NO_PROVEN_MAPPING", cutoverState: "CUTOVER_UNMAPPED: five recipe-135 column-watch actions remain UNKNOWN" },
  { id: "G5", schemaState: "SCHEMA_PRESENT", cutoverState: "CUTOVER_UNMAPPED: live width, order, and hidden-column state is not mapped" },
];

export const MONDAY_MIGRATION_NUMBER_GATE = {
  migrationNumber: "unallocated",
  minimumAfterFreshMergeInventory: 32,
  old026: "forbidden",
} as const;

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
  ["deals.assigned_to ?? companies.assigned_to", "person", "person", "transform", "현재 조직의 활성 구성원인지 재검증해야 합니다."],
  ["deals.status_note", "long_text", "longtext", "ready"],
  ["deals.custom.next_contact", "date", "datetime", "transform", "날짜를 회사 시간대의 명시적 시각으로 변환해야 합니다."],
] as const;

function targetColumns() {
  return new Map(POLICYFUND_NEWCUST_BOARD.columns.map((column) => [column.key, column]));
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
    targetPack: "pack.policyfund.v1/newcust",
    targetColumnCount: POLICYFUND_NEWCUST_BOARD.columns.length,
    targetGroupCount: POLICYFUND_NEWCUST_BOARD.sections.length,
    mappings,
    sourceLabelIdentity:
      "Monday statusColumnValue.index is the source label ID, never the display ordinal(표시 순번); 031 option IDs are label text and require an explicit future identity mapping.",
    automationDispositions: MONDAY_AUTOMATION_DISPOSITIONS,
    gaps: MONDAY_CUTOVER_GAPS,
    requiresFreshMondayCount: true,
    migrationNumberGate: MONDAY_MIGRATION_NUMBER_GATE,
    blockers,
    requiresAdditiveMigration: true,
    migrationReason:
      "003에는 legacy stable key, batch/checksum, quarantine, 원자 apply RPC와 001 쓰기 차단 계약이 없으므로 새 additive migration이 필요합니다.",
  };
}

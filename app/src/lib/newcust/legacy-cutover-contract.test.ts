import { describe, expect, it } from "vitest";
import { SEOUL_NEWCUST_BOARD } from "@/lib/structure-packs";
import {
  LEGACY_CUTOVER_REQUIRED_CAPABILITIES,
  MONDAY_AUTOMATION_DISPOSITIONS,
  MONDAY_CUTOVER_GAPS,
  MONDAY_MIGRATION_NUMBER_GATE,
  preflightLegacyCutover,
} from "./legacy-cutover-contract";

describe("BBE-27 current-main cutover preflight", () => {
  it("031 신규업체 구조 팩과 exact key/type로 맞물린다", () => {
    const result = preflightLegacyCutover();

    expect(result.targetColumnCount).toBe(SEOUL_NEWCUST_BOARD.columns.length);
    expect(result.targetGroupCount).toBe(14);
    expect(result.blockers).toEqual([]);
  });

  it("Monday 자동화는 label ID를 보존한 11/2/1/5 분류로만 다루며, 미상 규칙을 만들지 않는다", () => {
    const groups = Object.groupBy(MONDAY_AUTOMATION_DISPOSITIONS, (item) => item.disposition);

    expect(groups.supported_draft_only).toHaveLength(11);
    expect(groups.conditional_unsupported).toHaveLength(2);
    expect(groups.pipeline_translation_required).toHaveLength(1);
    expect(groups.unknown_not_imported).toHaveLength(5);
    expect(
      MONDAY_AUTOMATION_DISPOSITIONS
        .filter((item) => item.disposition === "supported_draft_only")
        .map((item) => item.sourceLabelId),
    ).toEqual([0, 2, 3, 4, 6, 7, 8, 9, 13, 12, 14]);
    expect(MONDAY_AUTOMATION_DISPOSITIONS.filter((item) => item.disposition === "unknown_not_imported").every((item) => item.target === null)).toBe(true);
  });

  it("구조팩 일치와 live Monday 컷오버를 구분하고 G1~G5와 수량·번호 게이트를 남긴다", () => {
    const result = preflightLegacyCutover();

    expect(result.sourceLabelIdentity).toContain("label ID");
    expect(result.sourceLabelIdentity).toContain("표시 순번");
    expect(MONDAY_CUTOVER_GAPS.map((gap) => gap.id)).toEqual(["G1", "G2", "G3", "G4", "G5"]);
    expect(MONDAY_CUTOVER_GAPS.every((gap) => gap.cutoverState.includes("UNMAPPED") || gap.cutoverState.includes("DEFERRED"))).toBe(true);
    expect(result.requiresFreshMondayCount).toBe(true);
    expect(MONDAY_MIGRATION_NUMBER_GATE).toEqual({
      migrationNumber: "unallocated",
      minimumAfterFreshMergeInventory: 32,
      old026: "forbidden",
    });
  });

  it("옛 17컬럼 자동 생성 대신 현재 팩의 모호한 필드를 결정 게이트로 둔다", () => {
    const result = preflightLegacyCutover();
    const decisions = result.mappings.filter((mapping) => mapping.status === "decision_required");

    expect(decisions.map((mapping) => mapping.source)).toEqual([
      "stages.name(kind=marketing)",
      "deals.amount",
      "deals.custom.priority",
    ]);
    expect(result.mappings.some((mapping) => mapping.target === "item_values.contact_status")).toBe(false);
  });

  it("안전한 일회 이관은 새 additive DB 계약 없이는 준비 완료가 아니다", () => {
    const result = preflightLegacyCutover();

    expect(result.requiresAdditiveMigration).toBe(true);
    expect(LEGACY_CUTOVER_REQUIRED_CAPABILITIES).toEqual([
      "stable_legacy_key",
      "dry_run",
      "quarantine",
      "atomic_apply",
      "source_checksum",
      "target_checksum",
      "source_read_only_fence",
    ]);
    expect(JSON.stringify(result)).not.toContain("026_newcust_legacy_cutover");
  });
});

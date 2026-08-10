import { describe, expect, it } from "vitest";
import { SEOUL_NEWCUST_BOARD } from "@/lib/structure-packs";
import {
  LEGACY_CUTOVER_REQUIRED_CAPABILITIES,
  preflightLegacyCutover,
} from "./legacy-cutover-contract";

describe("BBE-27 current-main cutover preflight", () => {
  it("031 신규업체 구조 팩과 exact key/type로 맞물린다", () => {
    const result = preflightLegacyCutover();

    expect(result.targetColumnCount).toBe(SEOUL_NEWCUST_BOARD.columns.length);
    expect(result.targetGroupCount).toBe(14);
    expect(result.blockers).toEqual([]);
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

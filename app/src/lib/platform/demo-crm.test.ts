import { describe, expect, it } from "vitest";
import { STAGE_BOARDS } from "@/lib/crm/stageBoards";
import { resolvePlatformDemoCrm, toPlatformDemoStageBoard } from "./demo-crm";

describe("platform demo CRM payload", () => {
  it("builds columns from the narrow admin RPC response", () => {
    const payload = resolvePlatformDemoCrm({
      stages: [{ id: "stage-1", pipeline_id: "pipeline-1", name: "신규", sort_order: 0, kind: "marketing" }],
      deals: [{ id: "deal-1", org_id: "org-1", company_id: null, pipeline_id: "pipeline-1", stage_id: "stage-1", assigned_to: null, title: "상담", amount: null, status_note: null, fee_terms: null, applied_on: null, custom: {}, created_at: "2026-01-01", updated_at: "2026-01-01" }],
      companies: [],
    });
    expect(payload).not.toBeNull();
    const board = toPlatformDemoStageBoard(STAGE_BOARDS[0], payload!);
    expect(board.total).toBe(1);
    expect(board.columns[0].deals[0].title).toBe("상담");
  });

  it("rejects partial or malformed RPC data", () => {
    expect(resolvePlatformDemoCrm({ stages: [], deals: [] })).toBeNull();
    expect(resolvePlatformDemoCrm({ stages: [{ id: 1 }], deals: [], companies: [] })).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { functionalMvpCsvScope, loadFunctionalMvpAvailability, workspaceOpsRpc } from "./server-contract";

const scope = { orgId: "org-1", workspaceId: "workspace-1", userId: "user-1", isOwner: true } as const;
const rpc = vi.fn(async () => ({ data: { accepted: true, status: "dry_run" }, error: null }));
const client = { rpc };

describe("010 workspace operation RPC adapter", () => {
  it("uses the exact owner-bound CSV RPC shape", async () => {
    await workspaceOpsRpc.createCsvDryRun(client, "batch-1", "org-1", "board-1", [{ title: "deidentified" }], "request-1");
    expect(rpc).toHaveBeenCalledWith("create_workspace_csv_dry_run", { p_batch_id: "batch-1", p_org_id: "org-1", p_board_id: "board-1", p_rows: [{ title: "deidentified" }], p_request_id: "request-1" });
  });

  it("fails closed while hosted 010 has no readable server contract", async () => {
    await expect(loadFunctionalMvpAvailability(scope)).resolves.toMatchObject({ kind: "unavailable" });
    expect(functionalMvpCsvScope(scope).mappingVersion).toBe("010-rpc-pending-v1");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  bootstrapWorkspace,
  normalizeWorkspaceName,
  renameWorkspace,
  WorkspaceOperationError,
} from "./service";

function asClient(value: unknown): SupabaseClient {
  return value as SupabaseClient;
}

describe("workspace service", () => {
  it("bootstrap RPC 결과를 검증해 반환한다", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        org_id: "org-1",
        pipeline_id: "pipeline-1",
        entitlements_created: 6,
        stages_created: 6,
      },
      error: null,
    });

    await expect(
      bootstrapWorkspace(asClient({ rpc }), "org-1"),
    ).resolves.toEqual({
      orgId: "org-1",
      pipelineId: "pipeline-1",
      entitlementsCreated: 6,
      stagesCreated: 6,
    });
    expect(rpc).toHaveBeenCalledWith("bootstrap_workspace", {
      p_org_id: "org-1",
    });
  });

  it("RPC 오류나 잘못된 응답을 성공으로 처리하지 않는다", async () => {
    const denied = asClient({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "denied", code: "42501" },
      }),
    });
    await expect(bootstrapWorkspace(denied, "org-1")).rejects.toMatchObject({
      name: "WorkspaceOperationError",
      operation: "bootstrap",
      code: "42501",
    });

    const malformed = asClient({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    await expect(
      bootstrapWorkspace(malformed, "org-1"),
    ).rejects.toBeInstanceOf(WorkspaceOperationError);
  });

  it("조직명 update가 실제 행을 반환해야 성공한다", async () => {
    const single = vi
      .fn()
      .mockResolvedValue({ data: { id: "org-1", name: "서울 센터" }, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    await expect(
      renameWorkspace(asClient({ from }), "org-1", "  서울 센터  "),
    ).resolves.toBe("서울 센터");
    expect(from).toHaveBeenCalledWith("orgs");
    expect(update).toHaveBeenCalledWith({ name: "서울 센터" });
    expect(eq).toHaveBeenCalledWith("id", "org-1");
  });

  it("빈 이름·과도하게 긴 이름을 거부한다", () => {
    expect(() => normalizeWorkspaceName("   ")).toThrow(
      WorkspaceOperationError,
    );
    expect(() => normalizeWorkspaceName("가".repeat(81))).toThrow(
      WorkspaceOperationError,
    );
  });
});

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LegacyApplyResult, LegacyCutoverStatus, LegacyDryRunResult } from "@/lib/newcust/legacy-types";

export class NewcustLegacyMigrationError extends Error {
  constructor(readonly op: string, readonly cause: { message: string; code?: string }) {
    super(`[newcust-legacy/${op}] ${cause.message}`);
    this.name = "NewcustLegacyMigrationError";
  }
}

export class NewcustLegacyMigrationSource {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(op: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.db.rpc(`newcust_legacy_${op}`, args);
    if (error) throw new NewcustLegacyMigrationError(op, error);
    return data as T;
  }

  dryRun(orgId: string): Promise<LegacyDryRunResult> {
    return this.rpc("dry_run", { p_org_id: orgId });
  }

  apply(orgId: string, requestId: string, expectedChecksum: string): Promise<LegacyApplyResult> {
    return this.rpc("apply", { p_org_id: orgId, p_request_id: requestId, p_expected_checksum: expectedChecksum });
  }

  rollback(orgId: string, expectedTargetChecksum: string): Promise<{ status: LegacyCutoverStatus }> {
    return this.rpc("rollback", { p_org_id: orgId, p_expected_target_checksum: expectedTargetChecksum });
  }

  status(orgId: string): Promise<{ status: LegacyCutoverStatus; batch_id: string | null }> {
    return this.rpc("status", { p_org_id: orgId });
  }

  uiReady(orgId: string): Promise<boolean> {
    return this.rpc("ui_ready", { p_org_id: orgId });
  }
}

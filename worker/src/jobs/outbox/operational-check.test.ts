import { describe, expect, it } from "vitest";
import { checkOutboxOperationalReadiness } from "./operational-check.js";
import type { QueryPort } from "./store.js";

describe("outbox production readiness probe", () => {
  it("passes only the constrained identity without claiming or sending", async () => {
    const calls: string[] = [];
    const port = { query: async (sql: string) => {
      calls.push(sql);
      return { rows: [{ identity: "moawork_outbox_worker", row_security: "on", schema_ready: true, can_claim: true, pending_rows: "0" }] };
    } } as unknown as QueryPort;
    const result = await checkOutboxOperationalReadiness(port);
    expect(result).toMatchObject({ schemaReady: true, canClaim: true, pendingRows: 0 });
    expect(calls[0]).not.toMatch(/select\s+\*\s+from\s+public\.claim_message_outbox/i);
  });

  it("fails closed for a broad or incomplete runtime identity", async () => {
    const port = { query: async () => ({ rows: [{ identity: "service_role", row_security: "off", schema_ready: true, can_claim: true, pending_rows: "0" }] }) } as unknown as QueryPort;
    await expect(checkOutboxOperationalReadiness(port)).rejects.toThrow("not ready");
  });
});

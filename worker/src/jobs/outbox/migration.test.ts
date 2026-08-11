import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/038_outbox.sql", import.meta.url)), "utf8");

describe("BBE-30 outbox migration", () => {
  it("owns an atomic leased claim with a bounded batch", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("least(coalesce(p_limit, 50), 100)");
    expect(sql).toContain("lease_expires_at");
  });

  it("deduplicates by a stable business key without transaction identity", () => {
    expect(sql).toContain("unique (org_id, idempotency_key)");
    expect(sql).toContain("p_source_entity_id::text");
    expect(sql).toContain("p_trigger_column_key, p_trigger_value_id");
    expect(sql).not.toContain("txid_current");
    expect(sql).toContain("'duplicate_suppressed'");
    expect(sql).toContain("set status = 'canceled'");
  });

  it("records actor and delivery lifecycle without payload or phone data", () => {
    expect(sql).toContain("actor_kind text not null");
    expect(sql).toContain("'retry_scheduled'");
    expect(sql).not.toMatch(/phone|to_addr|body_snapshot/);
  });

  it("keeps worker mutations away from browser roles", () => {
    expect(sql).toContain("revoke execute on function public.claim_message_outbox(integer,text,integer) from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.claim_message_outbox(integer,text,integer) to service_role");
  });
});

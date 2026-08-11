import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/052_outbox_delivery.sql", import.meta.url)), "utf8");

describe("BBE-30 outbox migration", () => {
  it("owns an atomic leased claim with a bounded batch", () => {
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("least(coalesce(p_limit, 50), 100)");
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain("lease_token = gen_random_uuid()");
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
    const outboxTables = sql.slice(0, sql.indexOf("alter table public.message_outbox enable row level security"));
    expect(outboxTables).not.toMatch(/phone|to_addr|body_snapshot/);
  });

  it("keeps worker mutations away from browser roles", () => {
    expect(sql).toContain("revoke execute on function public.claim_message_outbox(integer,text,integer) from public, anon, authenticated");
    expect(sql).toContain("create role moawork_outbox_worker login password null nobypassrls noinherit");
    expect(sql).toContain("revoke execute on function public.claim_message_outbox(integer,text,integer) from service_role");
    expect(sql).toContain("grant execute on function public.claim_message_outbox(integer,text,integer) to moawork_outbox_worker");
    expect(sql).toContain("p_message_id uuid, p_worker_id text, p_lease_token uuid");
    expect(sql).not.toContain("grant select, update on public.message_outbox to moawork_outbox_worker");
  });

  it("atomically rejects mismatched, expired, and stale lease acknowledgements", () => {
    expect(sql.match(/and leased_by=p_worker_id/g)).toHaveLength(3);
    expect(sql.match(/and lease_token=p_lease_token and lease_expires_at > now\(\)/g)).toHaveLength(3);
    expect(sql.match(/raise exception '유효한 outbox lease가 아니에요.'/g)).toHaveLength(3);
  });
});

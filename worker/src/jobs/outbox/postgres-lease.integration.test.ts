import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/058_outbox_delivery.sql", import.meta.url)),
  "utf8",
);

function functionSql(name: string, nextName?: string): string {
  const start = migration.indexOf(`create or replace function public.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function public.${nextName}`, start)
    : migration.indexOf("revoke all on public.message_outbox", start);
  if (start < 0 || end < 0) throw new Error(`migration function not found: ${name}`);
  return migration.slice(start, end);
}

const outboxId = "10000000-0000-0000-0000-000000000001";
const orgId = "20000000-0000-0000-0000-000000000001";
const messageId = "30000000-0000-0000-0000-000000000001";
const tokenA = "40000000-0000-0000-0000-000000000001";
const tokenB = "40000000-0000-0000-0000-000000000002";

describe("outbox PostgreSQL lease acknowledgements", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create table public.message_outbox (
        id uuid primary key, org_id uuid not null, message_id uuid not null,
        actor_kind text not null, actor_id text not null, status text not null,
        attempt_count integer not null, next_attempt_at timestamptz not null default now(),
        leased_at timestamptz, lease_expires_at timestamptz, leased_by text, lease_token uuid,
        delivered_at timestamptz, provider_message_id text, last_error text, updated_at timestamptz not null default now()
      );
      create table public.message_outbox_audit (
        outbox_id uuid, org_id uuid, event text, actor_kind text, actor_id text,
        worker_id text, attempt_count integer
      );
      ${functionSql("complete_message_outbox", "retry_message_outbox")}
      ${functionSql("retry_message_outbox", "fail_message_outbox")}
      ${functionSql("fail_message_outbox", "load_message_outbox_payload")}
    `);
  });

  afterEach(async () => db.close());

  async function seed(owner = "worker-a", token = tokenA, lease = "1 hour") {
    await db.query(
      `insert into public.message_outbox
       (id,org_id,message_id,actor_kind,actor_id,status,attempt_count,leased_by,lease_token,lease_expires_at)
       values ($1,$2,$3,'person','actor','leased',1,$4,$5,now() + $6::interval)`,
      [outboxId, orgId, messageId, owner, token, lease],
    );
  }

  it("rejects worker mismatch, token mismatch, and an expired lease", async () => {
    await seed();
    await expect(db.query("select public.complete_message_outbox($1,'receipt','worker-x',$2)", [outboxId, tokenA])).rejects.toThrow();
    await expect(db.query("select public.retry_message_outbox($1,'retry',now(),'worker-a',$2)", [outboxId, tokenB])).rejects.toThrow();
    await db.query("update public.message_outbox set lease_expires_at=now()-interval '1 second'");
    await expect(db.query("select public.fail_message_outbox($1,'dead','worker-a',$2)", [outboxId, tokenA])).rejects.toThrow();
  });

  it("rejects every stale A acknowledgement after B reclaims, then accepts B", async () => {
    await seed();
    await db.query(
      "update public.message_outbox set leased_by='worker-b', lease_token=$1, lease_expires_at=now()+interval '1 hour', attempt_count=2",
      [tokenB],
    );
    await expect(db.query("select public.complete_message_outbox($1,'receipt-a','worker-a',$2)", [outboxId, tokenA])).rejects.toThrow();
    await expect(db.query("select public.retry_message_outbox($1,'retry',now(),'worker-a',$2)", [outboxId, tokenA])).rejects.toThrow();
    await expect(db.query("select public.fail_message_outbox($1,'dead','worker-a',$2)", [outboxId, tokenA])).rejects.toThrow();
    expect((await db.query<{ status: string }>("select status from public.message_outbox where id=$1", [outboxId])).rows[0]?.status).toBe("leased");

    await expect(db.query("select public.complete_message_outbox($1,'receipt-b','worker-b',$2)", [outboxId, tokenB])).resolves.toBeDefined();
    expect((await db.query<{ status: string }>("select status from public.message_outbox where id=$1", [outboxId])).rows[0]?.status).toBe("delivered");
  });
});

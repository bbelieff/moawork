import { describe, expect, it } from "vitest";
import { PostgresOutboxStore, type QueryPort } from "./store.js";

describe("PostgresOutboxStore", () => {
  it("claims through the bounded atomic database function", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const db: QueryPort = { async query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      return { rows: [{ outbox_id: "o", message_id: "m", attempt_count: 1, actor_kind: "person", actor_id: "u", lease_token: "token" } as unknown as T] };
    } };
    const store = new PostgresOutboxStore(db);
    expect(await store.claim(1_000, "worker-1", 60_000)).toEqual([{ outboxId: "o", messageId: "m", attempt: 1, actor: { kind: "person", id: "u" }, workerId: "worker-1", leaseToken: "token" }]);
    expect(calls[0]).toEqual({ sql: "select * from public.claim_message_outbox($1,$2,$3)", values: [100, "worker-1", 60_000] });
  });

  it("passes the exact worker and opaque lease token to every acknowledgement RPC", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const db: QueryPort = { async query<T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values }); return { rows: [] as T[] };
    } };
    const store = new PostgresOutboxStore(db);
    const delivery = { outboxId: "o", messageId: "m", attempt: 1, actor: { kind: "person" as const, id: "u" }, workerId: "worker-1", leaseToken: "opaque-token" };
    await store.markDeliveryStarted(delivery);
    await store.markDelivered(delivery, "provider-id");
    await store.markRetry(delivery, "retry", new Date(0));
    await store.markDead(delivery, "dead");
    expect(calls.map(({ values }) => values?.slice(-2))).toEqual([
      ["worker-1", "opaque-token"], ["worker-1", "opaque-token"], ["worker-1", "opaque-token"], ["worker-1", "opaque-token"],
    ]);
  });
});

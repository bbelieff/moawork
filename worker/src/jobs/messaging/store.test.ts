import { describe, expect, it } from "vitest";
import { PostgresMessagingStore, type QueryPort } from "./store.js";

describe("PostgresMessagingStore", () => {
  it("claims only queued work and maps the persisted snapshot", async () => {
    const calls: Array<[string, readonly unknown[] | undefined]> = [];
    const rows = [{
      id: "m1", status: "queued" as const, channel: "alimtalk" as const,
      to_addr: "01012345678", from_addr: "0212345678", body_snapshot: "안내",
      template_code: "approved-template", sender_profile_id: "pf-1",
    }];
    const query: QueryPort["query"] = async <T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) => {
      calls.push([sql, values]);
      return { rows: rows as unknown as T[] };
    };
    const store = new PostgresMessagingStore({ query });
    await expect(store.claim("m1")).resolves.toEqual({
      id: "m1", status: "queued", channel: "alimtalk", toDigits: "01012345678",
      fromDigits: "0212345678", body: "안내", templateCode: "approved-template", senderProfileId: "pf-1",
    });
    expect(calls[0][0]).toContain("m.status='queued'");
  });

  it("caps dispatch batches at 1000 and persists a bounded failure reason", async () => {
    const calls: Array<[string, readonly unknown[] | undefined]> = [];
    const query: QueryPort["query"] = async <T extends Record<string, unknown>>(sql: string, values?: readonly unknown[]) => {
      calls.push([sql, values]);
      return { rows: [] as T[] };
    };
    const store = new PostgresMessagingStore({ query });
    await store.listQueued(5000);
    expect(calls[0][1]).toEqual([1000]);
    await store.markFailed("m1", "가".repeat(500));
    expect(String(calls[1][1]?.[1])).toHaveLength(300);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/036_messaging.sql", import.meta.url)), "utf8");

describe("messaging migration contract", () => {
  it("adds idempotency, opt-out, batch counts, failure and state-change outbox trigger", () => {
    expect(sql).toMatch(/messages_org_idempotency_uq/i);
    expect(sql).toMatch(/messaging_opt_outs/i);
    expect(sql).toMatch(/excluded_count/i);
    expect(sql).toMatch(/failed_count/i);
    expect(sql).toMatch(/item_values_enqueue_message_transition/i);
    expect(sql).toMatch(/md5\(concat_ws\(':', new\.org_id, new\.item_id, new\.column_key, v_value\)\)/i);
    expect(sql).not.toMatch(/txid_current|claimed_at|attempt_count|retry_failed_messages/i);
  });

  it("does not weaken organization membership helpers or read app_admins", () => {
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.is_org_member/i);
    expect(sql).not.toMatch(/from\s+public\.app_admins/i);
  });
});

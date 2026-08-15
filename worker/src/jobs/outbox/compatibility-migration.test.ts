import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/074_outbox_message_compatibility.sql", import.meta.url)), "utf8");

describe("BBE-30 hosted message compatibility", () => {
  it("is additive and does not fabricate customer delivery snapshots", () => {
    expect(sql.match(/add column if not exists/g)).toHaveLength(4);
    expect(sql).toContain("channel public.message_channel");
    expect(sql).toContain("from_addr text");
    expect(sql).toContain("body_snapshot text");
    expect(sql).toContain("sender_profile_id text");
    expect(sql).not.toMatch(/update\s+public\.messages/i);
    expect(sql).toContain("not valid");
  });
});

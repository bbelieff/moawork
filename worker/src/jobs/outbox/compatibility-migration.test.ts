import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
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

  it("preserves historical rows and rejects new incomplete queued snapshots", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create type public.message_channel as enum ('alimtalk', 'sms');
        create type public.message_status as enum ('queued', 'sent', 'failed');
        create table public.messages (
          id uuid primary key,
          to_addr text,
          status public.message_status not null
        );
        insert into public.messages(id, to_addr, status)
        values ('00000000-0000-4000-8000-000000000001', '01000000000', 'queued');
      `);

      await db.exec(sql);
      await db.exec(sql);

      const historical = await db.query<{ channel: string | null; from_addr: string | null; body_snapshot: string | null }>(`
        select channel::text, from_addr, body_snapshot
        from public.messages
        where id = '00000000-0000-4000-8000-000000000001'
      `);
      expect(historical.rows).toEqual([{ channel: null, from_addr: null, body_snapshot: null }]);

      await expect(db.exec(`
        insert into public.messages(id, to_addr, status)
        values ('00000000-0000-4000-8000-000000000002', '01011112222', 'queued')
      `)).rejects.toThrow(/messages_outbox_snapshot_complete/);

      await db.exec(`
        insert into public.messages(id, to_addr, status, channel, from_addr, body_snapshot)
        values ('00000000-0000-4000-8000-000000000003', '01011112222', 'queued', 'sms', '0212345678', 'snapshot')
      `);
      expect((await db.query<{ count: number }>("select count(*)::int as count from public.messages")).rows[0]?.count).toBe(2);
    } finally {
      await db.close();
    }
  });
});

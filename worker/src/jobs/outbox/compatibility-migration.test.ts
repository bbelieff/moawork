import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const sql = readFileSync(fileURLToPath(new URL("../../../../supabase/migrations/074_outbox_message_compatibility.sql", import.meta.url)), "utf8");

describe("BBE-30 hosted message compatibility", () => {
  it("is additive and does not fabricate customer delivery snapshots", () => {
    expect(sql.match(/add column if not exists/g)).toHaveLength(11);
    expect(sql).toContain("source_entity_id uuid");
    expect(sql).toContain("batch_id uuid");
    expect(sql).toContain("channel public.message_channel");
    expect(sql).toContain("from_addr text");
    expect(sql).toContain("body_snapshot text");
    expect(sql).toContain("sender_profile_id text");
    expect(sql).toContain("idempotency_key text");
    expect(sql).toContain("trigger_column_key text");
    expect(sql).toContain("trigger_value text");
    expect(sql).toContain("provider_message_id text");
    expect(sql).toContain("excluded_reason text");
    expect(sql).toMatch(/unique index if not exists messages_org_idempotency_full_uq/i);
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
          org_id uuid not null,
          template_id uuid,
          to_addr text,
          status public.message_status not null
        );
        insert into public.messages(id, org_id, to_addr, status)
        values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000010', '01000000000', 'queued');
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
        insert into public.messages(id, org_id, to_addr, status)
        values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000010', '01011112222', 'queued')
      `)).rejects.toThrow(/messages_outbox_snapshot_complete/);

      await db.exec(`
        insert into public.messages(id, org_id, to_addr, status, channel, from_addr, body_snapshot, idempotency_key)
        values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000010', '01011112222', 'queued', 'sms', '0212345678', 'snapshot', 'same-key')
      `);
      await expect(db.exec(`
        insert into public.messages(id, org_id, to_addr, status, channel, from_addr, body_snapshot, idempotency_key)
        values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000010', '01033334444', 'queued', 'sms', '0212345678', 'snapshot', 'same-key')
      `)).rejects.toThrow(/messages_org_idempotency_full_uq/);
      await db.exec(`
        insert into public.messages(id, org_id, to_addr, status, channel, from_addr, body_snapshot, idempotency_key)
        values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000010', '01033334444', 'queued', 'sms', '0212345678', 'snapshot', 'same-key')
        on conflict(org_id, idempotency_key)
        do update set idempotency_key=excluded.idempotency_key
      `);
      expect((await db.query<{ count: number }>("select count(*)::int as count from public.messages")).rows[0]?.count).toBe(2);
    } finally {
      await db.close();
    }
  });

  it("coexists with the historical partial index and preserves duplicate NULL keys", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create type public.message_channel as enum ('alimtalk', 'sms');
        create type public.message_status as enum ('queued', 'sent', 'failed');
        create table public.messages (
          id uuid primary key,
          org_id uuid not null,
          template_id uuid,
          to_addr text,
          status public.message_status not null,
          idempotency_key text
        );
        create unique index messages_org_idempotency_uq
          on public.messages(org_id, idempotency_key)
          where idempotency_key is not null;
        insert into public.messages(id, org_id, to_addr, status, idempotency_key) values
          ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000010', '01000000001', 'sent', null),
          ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000010', '01000000002', 'sent', null);
      `);
      await db.exec(sql);
      expect((await db.query<{ count: number }>(`
        select count(*)::int as count from public.messages where idempotency_key is null
      `)).rows[0]?.count).toBe(2);
      expect((await db.query<{ count: number }>(`
        select count(*)::int as count from pg_indexes
        where schemaname='public' and tablename='messages'
          and indexname in ('messages_org_idempotency_uq','messages_org_idempotency_full_uq')
      `)).rows[0]?.count).toBe(2);
    } finally {
      await db.close();
    }
  });
});

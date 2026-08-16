-- BBE-30 hosted compatibility bridge.
-- Some long-lived projects have the pre-041 messages shape. 058 expects the
-- delivery snapshot columns, while fresh databases already receive them from 041.
alter table public.messages
  add column if not exists source_entity_id uuid,
  add column if not exists channel public.message_channel,
  add column if not exists from_addr text,
  add column if not exists body_snapshot text,
  add column if not exists sender_profile_id text,
  add column if not exists idempotency_key text,
  add column if not exists trigger_column_key text,
  add column if not exists trigger_value text;

-- Migration 073 uses an unqualified ON CONFLICT(org_id,idempotency_key).
-- A full unique index is required; the historical 041 partial index cannot be
-- inferred by that statement. PostgreSQL still permits multiple NULL keys.
create unique index if not exists messages_org_idempotency_full_uq
  on public.messages(org_id, idempotency_key);

-- Never synthesize delivery data for existing customer rows. A producer must
-- populate a complete immutable snapshot before enqueueing a paid delivery.
alter table public.messages drop constraint if exists messages_outbox_snapshot_complete;
alter table public.messages add constraint messages_outbox_snapshot_complete check (
  status::text <> 'queued'
  or (channel is not null and nullif(to_addr, '') is not null
      and nullif(from_addr, '') is not null and nullif(body_snapshot, '') is not null)
) not valid;

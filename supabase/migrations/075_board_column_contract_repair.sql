-- BBE-163: restore the board-column contract required by the already deployed
-- default-tab RPCs. Some hosted databases predate 052/056 even though later
-- functions are present, so this migration is deliberately additive and
-- idempotent. It does not touch customer board, item, or value rows.

alter type public.field_type add value if not exists 'people';
alter type public.field_type add value if not exists 'money';
alter type public.field_type add value if not exists 'calc';

do $$
begin
  create type public.field_source as enum ('auto', 'in', 'act', 'msg', 'lk', 'calc');
exception
  when duplicate_object then null;
end
$$;

alter table public.board_columns
  add column if not exists source public.field_source not null default 'in',
  add column if not exists right_pinned boolean not null default false,
  add column if not exists move_rule_jsonb jsonb,
  add column if not exists is_readonly boolean not null default false;


-- BBE-168: recoverable board item deletion.
-- Existing customer rows are not updated; NULL means active for every pre-existing item.

alter table public.items
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists idx_items_active_board_order
  on public.items(org_id, board_id, sort_order)
  where deleted_at is null;

create index if not exists idx_items_trash_board_deleted
  on public.items(org_id, board_id, deleted_at desc)
  where deleted_at is not null;

comment on column public.items.deleted_at is
  'BBE-168: non-null when an item is in the recoverable trash. Group, values, assignee, and sort order are preserved.';
comment on column public.items.deleted_by is
  'BBE-168: authenticated actor who moved the item to trash; cleared on restore.';

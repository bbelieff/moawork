-- BBE-146 rollback for 060_board_foundation_reconcile.sql.
-- Conservative schema rollback. This script is intentionally NOT auto-applied.
-- The hosted database is known to have partial drift, but object provenance is
-- not recorded. Therefore this rollback removes only constraints/function names
-- introduced uniquely by BBE-146 and retains all additive foundation objects.
begin;

alter table if exists public.board_groups
  drop constraint if exists board_groups_detail_layout_jsonb_valid;

alter table if exists public.boards
  drop constraint if exists boards_detail_layout_jsonb_valid;

drop function if exists public.is_valid_detail_layout(jsonb);

commit;

-- Retained deliberately because provenance is unknown: both layout columns,
-- board_columns source/right_pinned/move_rule_jsonb/is_readonly, field_source,
-- 054/055 tables/functions, and additive enum labels. Removing any of them may
-- delete pre-existing schema or data. Full removal requires a separately
-- approved migration backed by an object-provenance snapshot.

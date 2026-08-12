-- BBE-146 rollback for 060_board_foundation_reconcile.sql.
-- Run only after the preflight snapshot confirms these objects were absent
-- before reconciliation. This script is intentionally NOT auto-applied.
begin;

alter table if exists public.board_groups
  drop constraint if exists board_groups_detail_layout_jsonb_valid;

alter table if exists public.boards
  drop constraint if exists boards_detail_layout_jsonb_valid;

drop function if exists public.is_valid_detail_layout(jsonb);

-- Layout columns are deliberately retained. This rollback also supports hosted
-- states where either column predated BBE-146, so dropping them could destroy
-- pre-existing values. Column removal requires a separately approved,
-- preflight-backed destructive migration.

drop function if exists public.read_permission_scoped_work_items(uuid, uuid);
drop function if exists public.read_org_permission_matrix(uuid);
drop function if exists public.record_risky_action(uuid, text, jsonb);
drop function if exists public.bind_workspace_member_permission_exception(uuid, uuid, text, text, text, uuid);
drop function if exists public.write_org_role_permission(uuid, public.member_role, text, boolean, uuid);
drop function if exists public.effective_permission(uuid, text);
drop function if exists public.perm_baseline();
drop table if exists public.org_permission_audit;
drop table if exists public.org_role_permission_overrides;

alter table if exists public.board_columns
  drop column if exists move_rule_jsonb,
  drop column if exists is_readonly,
  drop column if exists source,
  drop column if exists right_pinned;

drop type if exists public.field_source;
commit;

-- PostgreSQL does not safely support DROP VALUE for enums. The additive labels
-- status/people/money/calc, team_lead, and department deliberately remain.
-- Removing them would require a separately reviewed type-rebuild migration.

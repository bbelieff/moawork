-- moa-migration-guard: logical_key=126_issue534_default_definition_state_unique predecessor=125_issue530_board_group_order digest=f75fc55e69b83fdc27e4332add8c8ada2555c17802c013483eba12388636828e foundation=false

select public.begin_guarded_migration(
  p_logical_key => '126_issue534_default_definition_state_unique',
  p_file_name => '126_issue534_default_definition_state_unique.sql',
  p_file_digest => 'f75fc55e69b83fdc27e4332add8c8ada2555c17802c013483eba12388636828e',
  p_expected_predecessor => '125_issue530_board_group_order',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- Reserved system metadata is new in issue #534. This index serializes concurrent
-- first writes without touching customer board rows or user-created saved views.
create unique index if not exists board_views_default_definition_state_unique
  on public.board_views(board_id, user_id)
  where name = '__mw_default_definition__'
    and filters_jsonb->>'system' = 'default-definition-state-v1';

-- BBE-176: close inherited service_role and internal-validator EXECUTE grants.
-- ACL-only successor: function definitions, ownership, tables, and customer data stay unchanged.

revoke execute on function
  public.board_column_access_policy_is_valid(jsonb),
  public.board_column_validation_is_valid(jsonb),
  public.board_column_metadata_is_valid(jsonb, jsonb, jsonb),
  public.board_column_policy_allows(uuid, jsonb),
  public.board_column_value_visible(uuid, uuid, text),
  public.board_column_value_editable(uuid, uuid, text),
  public.board_column_type_dry_run(uuid, uuid, uuid, public.field_type),
  public.execute_board_column_command(uuid, uuid, uuid, text, uuid, jsonb)
from public, anon, service_role;

revoke execute on function
  public.board_column_access_policy_is_valid(jsonb),
  public.board_column_validation_is_valid(jsonb),
  public.board_column_metadata_is_valid(jsonb, jsonb, jsonb)
from authenticated;

grant execute on function
  public.board_column_policy_allows(uuid, jsonb),
  public.board_column_value_visible(uuid, uuid, text),
  public.board_column_value_editable(uuid, uuid, text),
  public.board_column_type_dry_run(uuid, uuid, uuid, public.field_type),
  public.execute_board_column_command(uuid, uuid, uuid, text, uuid, jsonb)
to authenticated;

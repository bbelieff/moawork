-- moa-migration-guard: logical_key=131_issue528_item_phone_review_status predecessor=130_issue571_departments digest=e7dc1bef92c9592ddcc644aed656f7e87a667d3cb4c5bfa4c85b2f902186c495 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '131_issue528_item_phone_review_status',
  p_file_name => '131_issue528_item_phone_review_status.sql',
  p_file_digest => 'e7dc1bef92c9592ddcc644aed656f7e87a667d3cb4c5bfa4c85b2f902186c495',
  p_expected_predecessor => '130_issue571_departments',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- 053 preserved the raw value and review result in a locked audit table, but
-- item readers had no safe way to distinguish an empty phone from a rejected
-- legacy phone. Keep the status beside the EAV value; raw values remain locked.
alter table public.item_values
  add column if not exists phone_normalization_status text not null default 'normalized'
  check (phone_normalization_status in ('normalized', 'needs_review'));

update public.item_values value_row
   set phone_normalization_status = original.normalization_status
  from public.phone_normalization_originals original
 where original.source_table = 'item_values'
   and original.record_id = value_row.item_id
   and original.field_key = value_row.column_key
   and original.org_id = value_row.org_id
   and original.normalization_status = 'needs_review'
   and value_row.phone_normalization_status is distinct from 'needs_review';

create or replace function public.normalize_item_value_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_normalized text;
begin
  if jsonb_typeof(new.value_jsonb) <> 'string'
    or not exists (
      select 1
      from public.items item
      join public.board_columns column_def
        on column_def.board_id = item.board_id
       and column_def.org_id = new.org_id
       and column_def.key = new.column_key
      where item.id = new.item_id
        and item.org_id = new.org_id
        and column_def.type = 'phone'
    ) then
    return new;
  end if;

  v_raw := new.value_jsonb #>> '{}';
  v_normalized := public.normalize_phone(v_raw);
  new.phone_normalization_status := case when v_normalized is null then 'needs_review' else 'normalized' end;
  if v_raw is distinct from v_normalized then
    insert into public.phone_normalization_originals
      (source_table, org_id, record_id, field_key, raw_value, normalization_status)
    values (
      'item_values', new.org_id, new.item_id, new.column_key, new.value_jsonb,
      new.phone_normalization_status
    )
    on conflict do nothing;
  end if;
  new.value_jsonb := to_jsonb(v_normalized);
  return new;
end;
$$;

revoke all on function public.normalize_item_value_phone() from public, anon, authenticated, service_role;

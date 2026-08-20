-- moa-migration-guard: logical_key=098_bbe191_field_value_entity predecessor=097_bbe201_new_lead_field_write_restore digest=63dd6d84ccca73c341c82c01ed2cc59c8fa11af23e91e4207d4349116513251d foundation=false

select public.begin_guarded_migration(
  p_logical_key => '098_bbe191_field_value_entity',
  p_file_name => '098_bbe191_field_value_entity.sql',
  p_file_digest => '63dd6d84ccca73c341c82c01ed2cc59c8fa11af23e91e4207d4349116513251d',
  p_expected_predecessor => '097_bbe201_new_lead_field_write_restore',
  p_executor => 'DG-04',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

alter table public.field_values
  add column entity public.field_entity;

update public.field_values fv
set entity = public.resolve_field_value_entity(fv.org_id, fv.entity_id)
where fv.entity is null;

do $migration$
begin
  if exists (select 1 from public.field_values where entity is null) then
    raise exception using
      errcode = '23514',
      message = 'field_values entity backfill found missing or ambiguous owners';
  end if;
end;
$migration$;

alter table public.field_values
  alter column entity set not null,
  drop constraint field_values_pkey,
  add primary key (entity, entity_id, field_key);

create index field_values_org_entity_entity_id_idx
  on public.field_values(org_id, entity, entity_id);

comment on column public.field_values.entity is
  'BBE-191 durable owner type; prevents same-key values crossing company/deal boundaries.';

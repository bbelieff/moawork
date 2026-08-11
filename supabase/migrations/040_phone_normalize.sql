-- BBE-106 / D10: store phone numbers as digits; format only at presentation.
-- Applying this migration to a hosted database is a separate approval step.

create or replace function public.normalize_phone(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_trimmed text := btrim(p_value);
  v_digits text := regexp_replace(btrim(p_value), '[^0-9]', '', 'g');
begin
  -- Korean international notation becomes the canonical domestic form.
  -- Other country codes remain digits-only with their country code intact.
  if left(v_trimmed, 1) = '+' and left(v_digits, 2) = '82' then
    v_digits := regexp_replace(substr(v_digits, 3), '^0+', '');
    v_digits := case when v_digits = '' then '' else '0' || v_digits end;
  end if;

  if (left(v_digits, 1) = '0' and length(v_digits) between 9 and 11)
    or (left(v_digits, 1) <> '0' and length(v_digits) between 8 and 15) then
    return v_digits;
  end if;

  return null;
end;
$$;

revoke all on function public.normalize_phone(text) from public;
grant execute on function public.normalize_phone(text) to authenticated, service_role;

-- field_values does not store its field_entity. Resolve it from the owning row,
-- and deliberately return null for missing or ambiguous IDs instead of guessing.
create or replace function public.resolve_field_value_entity(p_org_id uuid, p_entity_id uuid)
returns public.field_entity
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.companies c
      where c.org_id = p_org_id and c.id = p_entity_id
    ) and not exists (
      select 1 from public.deals d
      where d.org_id = p_org_id and d.id = p_entity_id
    ) then 'company'::public.field_entity
    when exists (
      select 1 from public.deals d
      where d.org_id = p_org_id and d.id = p_entity_id
    ) and not exists (
      select 1 from public.companies c
      where c.org_id = p_org_id and c.id = p_entity_id
    ) then 'deal'::public.field_entity
    else null
  end;
$$;

revoke all on function public.resolve_field_value_entity(uuid, uuid) from public;

alter table public.companies
  add column if not exists phone_original text,
  add column if not exists phone_normalization_status text not null default 'normalized'
    check (phone_normalization_status in ('normalized', 'needs_review'));

comment on column public.companies.phone_original is
  'BBE-106 legacy/raw phone backup. Existing non-canonical input is preserved before normalization.';

-- Preserve the first raw value before changing existing rows. Re-running is safe.
update public.companies
set phone_original = phone
where phone is not null
  and phone_original is null
  and phone is distinct from public.normalize_phone(phone);

update public.companies
set phone_normalization_status = case
      when public.normalize_phone(phone) is null then 'needs_review'
      else 'normalized'
    end,
    phone = public.normalize_phone(phone)
where phone is distinct from public.normalize_phone(phone);

-- EAV phone cells cannot gain an extra column without changing their shared
-- storage contract. Preserve their first raw value in a locked audit table.
create table if not exists public.phone_normalization_originals (
  source_table text not null check (source_table in ('field_values', 'item_values')),
  org_id uuid not null references public.orgs(id) on delete cascade,
  record_id uuid not null,
  field_key text not null,
  raw_value jsonb not null,
  normalization_status text not null
    check (normalization_status in ('normalized', 'needs_review')),
  preserved_at timestamptz not null default now(),
  primary key (source_table, record_id, field_key)
);

alter table public.phone_normalization_originals enable row level security;
revoke all on table public.phone_normalization_originals from anon, authenticated;
grant select, insert, update, delete on table public.phone_normalization_originals to service_role;

insert into public.phone_normalization_originals
  (source_table, org_id, record_id, field_key, raw_value, normalization_status)
select 'field_values', fv.org_id, fv.entity_id, fv.field_key, fv.value_jsonb,
  case when public.normalize_phone(fv.value_jsonb #>> '{}') is null
    then 'needs_review' else 'normalized' end
from public.field_values fv
join public.field_defs fd
  on fd.org_id = fv.org_id
  and fd.entity = public.resolve_field_value_entity(fv.org_id, fv.entity_id)
  and fd.key = fv.field_key
where fd.type = 'phone'
  and jsonb_typeof(fv.value_jsonb) = 'string'
  and (fv.value_jsonb #>> '{}') is distinct from public.normalize_phone(fv.value_jsonb #>> '{}')
on conflict do nothing;

update public.field_values fv
set value_jsonb = to_jsonb(public.normalize_phone(fv.value_jsonb #>> '{}'))
from public.field_defs fd
where fd.org_id = fv.org_id
  and fd.entity = public.resolve_field_value_entity(fv.org_id, fv.entity_id)
  and fd.key = fv.field_key
  and fd.type = 'phone'
  and jsonb_typeof(fv.value_jsonb) = 'string'
  and (fv.value_jsonb #>> '{}') is distinct from public.normalize_phone(fv.value_jsonb #>> '{}');

insert into public.phone_normalization_originals
  (source_table, org_id, record_id, field_key, raw_value, normalization_status)
select 'item_values', iv.org_id, iv.item_id, iv.column_key, iv.value_jsonb,
  case when public.normalize_phone(iv.value_jsonb #>> '{}') is null
    then 'needs_review' else 'normalized' end
from public.item_values iv
join public.items i on i.id = iv.item_id and i.org_id = iv.org_id
join public.board_columns bc
  on bc.board_id = i.board_id and bc.org_id = iv.org_id and bc.key = iv.column_key
where bc.type = 'phone'
  and jsonb_typeof(iv.value_jsonb) = 'string'
  and (iv.value_jsonb #>> '{}') is distinct from public.normalize_phone(iv.value_jsonb #>> '{}')
on conflict do nothing;

update public.item_values iv
set value_jsonb = to_jsonb(public.normalize_phone(iv.value_jsonb #>> '{}'))
from public.items i, public.board_columns bc
where i.id = iv.item_id
  and i.org_id = iv.org_id
  and bc.board_id = i.board_id
  and bc.org_id = iv.org_id
  and bc.key = iv.column_key
  and bc.type = 'phone'
  and jsonb_typeof(iv.value_jsonb) = 'string'
  and (iv.value_jsonb #>> '{}') is distinct from public.normalize_phone(iv.value_jsonb #>> '{}');

create or replace function public.normalize_company_phone()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_normalized text;
begin
  if new.phone is null then
    return new;
  end if;

  v_normalized := public.normalize_phone(new.phone);
  if new.phone_original is null and new.phone is distinct from v_normalized then
    new.phone_original := new.phone;
  end if;
  new.phone_normalization_status := case
    when v_normalized is null then 'needs_review'
    else 'normalized'
  end;
  new.phone := v_normalized;
  return new;
end;
$$;

revoke all on function public.normalize_company_phone() from public;

drop trigger if exists trg_companies_normalize_phone on public.companies;
create trigger trg_companies_normalize_phone
before insert or update of phone on public.companies
for each row execute function public.normalize_company_phone();

create or replace function public.normalize_field_value_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text;
  v_entity public.field_entity;
begin
  v_entity := public.resolve_field_value_entity(new.org_id, new.entity_id);
  if v_entity is null
    or jsonb_typeof(new.value_jsonb) <> 'string'
    or not exists (
      select 1 from public.field_defs fd
      where fd.org_id = new.org_id
        and fd.entity = v_entity
        and fd.key = new.field_key
        and fd.type = 'phone'
    ) then
    return new;
  end if;

  v_raw := new.value_jsonb #>> '{}';
  if v_raw is distinct from public.normalize_phone(v_raw) then
    insert into public.phone_normalization_originals
      (source_table, org_id, record_id, field_key, raw_value, normalization_status)
    values (
      'field_values', new.org_id, new.entity_id, new.field_key, new.value_jsonb,
      case when public.normalize_phone(v_raw) is null then 'needs_review' else 'normalized' end
    )
    on conflict do nothing;
  end if;
  new.value_jsonb := to_jsonb(public.normalize_phone(v_raw));
  return new;
end;
$$;

revoke all on function public.normalize_field_value_phone() from public;

drop trigger if exists trg_field_values_normalize_phone on public.field_values;
create trigger trg_field_values_normalize_phone
before insert or update of value_jsonb, field_key on public.field_values
for each row execute function public.normalize_field_value_phone();

create or replace function public.normalize_item_value_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text;
begin
  if jsonb_typeof(new.value_jsonb) <> 'string'
    or not exists (
      select 1
      from public.items i
      join public.board_columns bc
        on bc.board_id = i.board_id and bc.org_id = new.org_id and bc.key = new.column_key
      where i.id = new.item_id and i.org_id = new.org_id and bc.type = 'phone'
    ) then
    return new;
  end if;

  v_raw := new.value_jsonb #>> '{}';
  if v_raw is distinct from public.normalize_phone(v_raw) then
    insert into public.phone_normalization_originals
      (source_table, org_id, record_id, field_key, raw_value, normalization_status)
    values (
      'item_values', new.org_id, new.item_id, new.column_key, new.value_jsonb,
      case when public.normalize_phone(v_raw) is null then 'needs_review' else 'normalized' end
    )
    on conflict do nothing;
  end if;
  new.value_jsonb := to_jsonb(public.normalize_phone(v_raw));
  return new;
end;
$$;

revoke all on function public.normalize_item_value_phone() from public;

drop trigger if exists trg_item_values_normalize_phone on public.item_values;
create trigger trg_item_values_normalize_phone
before insert or update of value_jsonb, column_key on public.item_values
for each row execute function public.normalize_item_value_phone();

alter table public.companies
  drop constraint if exists companies_phone_digits_only;
alter table public.companies
  add constraint companies_phone_digits_only
  check (phone is null or phone ~ '^[0-9]+$');

create index if not exists companies_org_phone_idx
  on public.companies (org_id, phone)
  where phone is not null;

create view public.phone_normalization_review_counts
with (security_invoker = true)
as
select org_id, count(*)::bigint as needs_review_count
from public.phone_normalization_originals
where normalization_status = 'needs_review'
group by org_id;

revoke all on public.phone_normalization_review_counts from anon, authenticated;
grant select on public.phone_normalization_review_counts to service_role;

do $$
declare
  v_needs_review_count bigint;
begin
  select count(*) into v_needs_review_count
  from public.phone_normalization_originals
  where normalization_status = 'needs_review';
  raise notice 'phone normalization needs_review count: %', v_needs_review_count;
end;
$$;

-- Hosted apply read-back (aggregate-only; never select phone contents):
-- 1. Before apply, record counts from each active store.
--    select 'companies' as source_table, count(*)::bigint as row_count
--      from public.companies where phone is not null
--    union all
--    select 'field_values', count(*)::bigint
--      from public.field_values fv
--      join public.field_defs fd on fd.org_id = fv.org_id
--       and fd.entity = public.resolve_field_value_entity(fv.org_id, fv.entity_id)
--       and fd.key = fv.field_key and fd.type = 'phone'
--    union all
--    select 'item_values', count(*)::bigint
--      from public.item_values iv
--      join public.items i on i.id = iv.item_id and i.org_id = iv.org_id
--      join public.board_columns bc on bc.board_id = i.board_id
--       and bc.org_id = iv.org_id and bc.key = iv.column_key and bc.type = 'phone';
-- 2. After apply, record review/backup counts without raw values.
--    select source_table, normalization_status, count(*)::bigint as row_count
--      from public.phone_normalization_originals
--      group by source_table, normalization_status order by source_table, normalization_status;
--    select count(*)::bigint as company_needs_review_count
--      from public.companies where phone_normalization_status = 'needs_review';
--    select count(*)::bigint as company_non_digit_count
--      from public.companies where phone is not null and phone !~ '^[0-9]+$';
-- 3. If rollback is required, execute the exact transaction below and verify
--    the same aggregate counts from step 1. It restores only rows backed up by
--    this migration and never exposes phone contents.
-- begin;
-- drop trigger if exists trg_companies_normalize_phone on public.companies;
-- drop trigger if exists trg_field_values_normalize_phone on public.field_values;
-- drop trigger if exists trg_item_values_normalize_phone on public.item_values;
-- update public.companies set phone = phone_original
--   where phone_original is not null;
-- update public.field_values fv set value_jsonb = o.raw_value
--   from public.phone_normalization_originals o
--   where o.source_table = 'field_values' and o.org_id = fv.org_id
--     and o.record_id = fv.entity_id and o.field_key = fv.field_key;
-- update public.item_values iv set value_jsonb = o.raw_value
--   from public.phone_normalization_originals o
--   where o.source_table = 'item_values' and o.org_id = iv.org_id
--     and o.record_id = iv.item_id and o.field_key = iv.column_key;
-- drop view if exists public.phone_normalization_review_counts;
-- drop function if exists public.normalize_company_phone();
-- drop function if exists public.normalize_field_value_phone();
-- drop function if exists public.normalize_item_value_phone();
-- drop function if exists public.resolve_field_value_entity(uuid, uuid);
-- drop function if exists public.normalize_phone(text);
-- drop table if exists public.phone_normalization_originals;
-- drop index if exists public.companies_org_phone_idx;
-- alter table public.companies drop constraint if exists companies_phone_digits_only;
-- alter table public.companies drop column if exists phone_normalization_status;
-- alter table public.companies drop column if exists phone_original;
-- commit;

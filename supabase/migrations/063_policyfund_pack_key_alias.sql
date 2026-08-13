-- BBE-132: neutralize the policy-fund pack key without breaking existing references.
--
-- `pack.seoul.policyfund1` is retained as a read-compatible alias row. The new row
-- carries the product-neutral key while preserving every nested mapping value from
-- the historical source; only `key` and the source explanation are changed.
-- No organization/customer rows are read or mutated by this migration.

insert into public.structure_packs (key, name, pack_jsonb)
select
  'pack.policyfund.v1',
  legacy.name,
  jsonb_set(
    jsonb_set(
      legacy.pack_jsonb,
      '{key}',
      to_jsonb('pack.policyfund.v1'::text),
      true
    ),
    '{source}',
    to_jsonb(
      ('실측 출처(특정 고객 전용 팩이 아님): ' || coalesce(legacy.pack_jsonb ->> 'source', ''))::text
    ),
    true
  )
from public.structure_packs as legacy
where legacy.key = 'pack.seoul.policyfund1'
on conflict (key) do update
set
  name = excluded.name,
  pack_jsonb = excluded.pack_jsonb;

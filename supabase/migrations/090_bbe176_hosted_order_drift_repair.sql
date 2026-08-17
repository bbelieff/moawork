-- BBE-176 successor: preserve and repair legacy active column ordering drift.
-- This migration only updates sort_order for active columns on boards whose
-- current order differs from the deterministic (sort_order, created_at, id) order.

create table if not exists public.board_column_order_repair_audit (
  repair_version text not null,
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- Board and column IDs are immutable snapshots, not lifecycle-bound FKs. Historical
  -- migrations include hard-delete paths, so retaining these plain UUIDs preserves the
  -- only reversible old/new mapping after a board or column is removed.
  board_id uuid not null,
  column_id uuid not null,
  old_sort_order integer not null,
  new_sort_order integer not null,
  order_basis text not null,
  column_created_at timestamptz not null,
  repaired_at timestamptz not null default clock_timestamp(),
  primary key (repair_version, column_id),
  check (repair_version = 'bbe176-hosted-order-v1'),
  check (order_basis = 'row_number(sort_order,created_at,id)-1')
);

alter table public.board_column_order_repair_audit enable row level security;
revoke all on public.board_column_order_repair_audit from public, anon, authenticated, service_role;

do $repair$
declare
  v_active_predicate text;
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'board_columns'
       and column_name = 'archived_at'
  ) then
    v_active_predicate := 'c.archived_at is null';
  else
    v_active_predicate := 'true';
  end if;

  drop table if exists pg_temp.bbe176_order_repair_ranked;
  execute format($sql$
    create temporary table bbe176_order_repair_ranked on commit drop as
    with ranked as (
      select c.id as column_id,
             c.org_id,
             c.board_id,
             c.sort_order as old_sort_order,
             c.created_at as column_created_at,
             row_number() over (
               partition by c.org_id, c.board_id
               order by c.sort_order, c.created_at, c.id
             )::integer - 1 as new_sort_order
        from public.board_columns c
       where %s
    ), affected_boards as (
      select distinct org_id, board_id
        from ranked
       where old_sort_order is distinct from new_sort_order
    )
    select r.*
      from ranked r
      join affected_boards a using (org_id, board_id)
  $sql$, v_active_predicate);

  insert into public.board_column_order_repair_audit (
    repair_version,
    org_id,
    board_id,
    column_id,
    old_sort_order,
    new_sort_order,
    order_basis,
    column_created_at
  )
  select 'bbe176-hosted-order-v1',
         org_id,
         board_id,
         column_id,
         old_sort_order,
         new_sort_order,
         'row_number(sort_order,created_at,id)-1',
         column_created_at
    from pg_temp.bbe176_order_repair_ranked
  on conflict (repair_version, column_id) do nothing;

  -- Move the complete affected active layout to a disjoint temporary range.
  -- This remains safe when 089's active unique index already exists.
  update public.board_columns c
     set sort_order = -1000000000 - r.new_sort_order
    from pg_temp.bbe176_order_repair_ranked r
   where c.id = r.column_id;

  update public.board_columns c
     set sort_order = r.new_sort_order
    from pg_temp.bbe176_order_repair_ranked r
   where c.id = r.column_id;
end
$repair$;

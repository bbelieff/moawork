-- BBE-153 / D79: persist the six calculated board values without allowing
-- clients to edit them. Hosted apply and real customer data are out of scope.
-- 062 follows BBE-159's merged 061_board_rls_visibility.sql.

alter table public.item_values
  add column if not exists value_updated_at timestamptz not null default now(),
  add column if not exists calculated_at timestamptz,
  add column if not exists stale_after timestamptz;

comment on column public.item_values.calculated_at is
  'D79 server calculation timestamp. NULL means the value is not calculated.';
comment on column public.item_values.stale_after is
  'D79 freshness deadline for date-dependent calculations.';

create index if not exists item_values_calculation_freshness_idx
  on public.item_values (stale_after, calculated_at)
  where calculated_at is not null;

create table if not exists public.board_calculation_failures (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  source_column_key text,
  sqlstate text not null,
  error_message text not null,
  failed_at timestamptz not null default clock_timestamp()
);

create index if not exists board_calculation_failures_item_time_idx
  on public.board_calculation_failures (item_id, failed_at desc);
create index if not exists board_calculation_failures_board_time_idx
  on public.board_calculation_failures (board_id, failed_at desc);
create index if not exists board_calculation_failures_org_time_idx
  on public.board_calculation_failures (org_id, failed_at desc);

alter table public.board_calculation_failures enable row level security;
revoke all on table public.board_calculation_failures from public, anon, authenticated, service_role;

create or replace function public.bbe153_normalized_label(p_label text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select replace(replace(replace(coalesce(p_label, ''), 'ƒ', ''), ' ', ''), '_', '')
$$;

create or replace function public.bbe153_is_calculated_column(
  p_item_id uuid,
  p_column_key text
) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.items i
      join public.board_columns c
        on c.board_id = i.board_id and c.key = p_column_key
     where i.id = p_item_id
       and (c.source = 'calc' or c.is_readonly)
  )
$$;

create or replace function public.bbe153_guard_calculated_value_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if public.bbe153_is_calculated_column(new.item_id, new.column_key)
     and current_user <> 'postgres' then
    raise exception 'calculated values are server read-only'
      using errcode = '42501';
  end if;
  new.value_updated_at := clock_timestamp();
  return new;
end
$$;

revoke all on function public.bbe153_guard_calculated_value_write() from public, anon, authenticated, service_role;

drop trigger if exists bbe153_guard_calculated_value_write on public.item_values;
create trigger bbe153_guard_calculated_value_write
before insert or update of value_jsonb on public.item_values
for each row execute function public.bbe153_guard_calculated_value_write();

create or replace function public.bbe153_refresh_board_total(p_board_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  -- 총 매출액은 카드 계약대로 보드의 수수료(원) 합계다. 한 번의 set-based
  -- upsert로 모든 행의 저장값과 계산시각을 맞춘다.
  with total as (
    select coalesce(sum(case when jsonb_typeof(v.value_jsonb) = 'number'
      then (v.value_jsonb #>> '{}')::numeric else 0 end), 0) as amount
      from public.item_values v
      join public.items i on i.id = v.item_id
      join public.board_columns c on c.board_id = i.board_id and c.key = v.column_key
     where i.board_id = p_board_id
       and public.bbe153_normalized_label(c.label) = '수수료(원)'
  ), total_column as (
    select c.key
      from public.board_columns c
     where c.board_id = p_board_id
       and public.bbe153_normalized_label(c.label) = '총매출액'
       and (c.source = 'calc' or c.is_readonly)
  )
  insert into public.item_values(
    org_id, item_id, column_key, value_jsonb,
    value_updated_at, calculated_at, stale_after
  )
  select i.org_id, i.id, c.key, to_jsonb(t.amount), v_now, v_now, null
    from public.items i cross join total_column c cross join total t
   where i.board_id = p_board_id
  on conflict (item_id, column_key) do update
    set value_jsonb = excluded.value_jsonb,
        value_updated_at = excluded.value_updated_at,
        calculated_at = excluded.calculated_at,
        stale_after = excluded.stale_after;
end
$$;

revoke all on function public.bbe153_refresh_board_total(uuid) from public, anon, authenticated, service_role;

create or replace function public.bbe153_calculate_item(
  p_item_id uuid,
  p_today date default (now() at time zone 'Asia/Seoul')::date,
  p_refresh_board_total boolean default true
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.items%rowtype;
  v_now timestamptz := clock_timestamp();
  v_execution numeric;
  v_fee_percent numeric;
  v_fee numeric;
  v_funded_on date;
  v_fee_paid_on date;
  v_review_ends_on date;
  v_targets jsonb;
  v_readers jsonb;
  v_column record;
  v_value jsonb;
  v_stale_after timestamptz;
begin
  select * into strict v_item from public.items where id = p_item_id;

  select max(case
      when public.bbe153_normalized_label(c.label) = '실행액'
       and jsonb_typeof(v.value_jsonb) = 'number'
      then (v.value_jsonb #>> '{}')::numeric end),
    max(case
      when public.bbe153_normalized_label(c.label) in ('수수료(%)', '수수료%')
       and jsonb_typeof(v.value_jsonb) = 'number'
      then (v.value_jsonb #>> '{}')::numeric end),
    max(case
      when public.bbe153_normalized_label(c.label) = '조달일'
       and jsonb_typeof(v.value_jsonb) = 'string'
       and (v.value_jsonb #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v.value_jsonb #>> '{}')::date end),
    max(case
      when public.bbe153_normalized_label(c.label) = '수수료입금일'
       and jsonb_typeof(v.value_jsonb) = 'string'
       and (v.value_jsonb #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v.value_jsonb #>> '{}')::date end),
    max(case
      when public.bbe153_normalized_label(c.label) = '예상심사종료'
       and jsonb_typeof(v.value_jsonb) = 'string'
       and (v.value_jsonb #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v.value_jsonb #>> '{}')::date end),
    (array_agg(v.value_jsonb) filter (
      where public.bbe153_normalized_label(c.label) = '대상'))[1],
    (array_agg(v.value_jsonb) filter (
      where public.bbe153_normalized_label(c.label) in ('읽은사람', 'readuserids')))[1]
  into v_execution, v_fee_percent, v_funded_on, v_fee_paid_on,
       v_review_ends_on, v_targets, v_readers
  from public.item_values v
  join public.board_columns c
    on c.board_id = v_item.board_id and c.key = v.column_key
  where v.item_id = p_item_id;

  v_fee := case when v_execution is null or v_fee_percent is null
    then null else round(v_execution * v_fee_percent / 100) end;

  for v_column in
    select c.key, public.bbe153_normalized_label(c.label) as label
      from public.board_columns c
     where c.board_id = v_item.board_id
       and (c.source = 'calc' or c.is_readonly)
  loop
    v_stale_after := null;
    v_value := case v_column.label
      when '재신청안내일' then to_jsonb(case when v_funded_on is null then null else (v_funded_on + 365)::text end)
      when '수수료(원)' then to_jsonb(v_fee)
      when '심사D-day' then to_jsonb(case
        when v_review_ends_on is null then null
        when v_review_ends_on > p_today then 'D-' || (v_review_ends_on - p_today)::text
        when v_review_ends_on = p_today then '오늘'
        else '지남' end)
      when 'D+180' then to_jsonb(case when v_fee_paid_on is null then null else (v_fee_paid_on + 180)::text end)
      when '읽음' then to_jsonb(case
        when jsonb_typeof(v_targets) = 'array' and jsonb_typeof(v_readers) = 'array'
        then (select count(distinct target.value)::integer
                from jsonb_array_elements_text(v_targets) target(value)
                join jsonb_array_elements_text(v_readers) reader(value) using (value))
        else null end)
      else null
    end;

    if v_column.label in ('재신청안내일', '수수료(원)', '심사D-day', 'D+180', '읽음') then
      if v_column.label in ('심사D-day', 'D+180') then
        v_stale_after := (p_today + 1)::timestamp at time zone 'Asia/Seoul';
      end if;
      insert into public.item_values(
        org_id, item_id, column_key, value_jsonb,
        value_updated_at, calculated_at, stale_after
      ) values (
        v_item.org_id, v_item.id, v_column.key, v_value,
        v_now, v_now, v_stale_after
      )
      on conflict (item_id, column_key) do update
        set value_jsonb = excluded.value_jsonb,
            value_updated_at = excluded.value_updated_at,
            calculated_at = excluded.calculated_at,
            stale_after = excluded.stale_after;
    end if;
  end loop;

  if p_refresh_board_total then
    perform public.bbe153_refresh_board_total(v_item.board_id);
  end if;
end
$$;

revoke all on function public.bbe153_calculate_item(uuid, date, boolean) from public, anon, authenticated, service_role;

create or replace function public.bbe153_after_source_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.items%rowtype;
begin
  if public.bbe153_is_calculated_column(new.item_id, new.column_key) then
    return new;
  end if;
  perform public.bbe153_calculate_item(new.item_id);
  return new;
exception when others then
  select * into v_item from public.items where id = new.item_id;
  insert into public.board_calculation_failures(
    org_id, board_id, item_id, source_column_key, sqlstate, error_message
  ) values (
    v_item.org_id, v_item.board_id, new.item_id, new.column_key, sqlstate, sqlerrm
  );
  update public.item_values v
     set stale_after = least(coalesce(v.stale_after, clock_timestamp()), clock_timestamp())
   where v.item_id = new.item_id and v.calculated_at is not null;
  raise warning 'BBE-153 calculation failed for item %: %', new.item_id, sqlerrm;
  return new;
end
$$;

revoke all on function public.bbe153_after_source_write() from public, anon, authenticated, service_role;

drop trigger if exists bbe153_after_source_write on public.item_values;
create trigger bbe153_after_source_write
after insert or update of value_jsonb on public.item_values
for each row execute function public.bbe153_after_source_write();

create or replace function public.bbe153_recalculate_daily(
  p_today date default (now() at time zone 'Asia/Seoul')::date
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint := 0;
begin
  with candidates as (
    select i.id as item_id, i.org_id, c.key as column_key,
      public.bbe153_normalized_label(c.label) as label,
      max(case
        when public.bbe153_normalized_label(source_column.label) = '예상심사종료'
         and jsonb_typeof(source_value.value_jsonb) = 'string'
         and (source_value.value_jsonb #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
        then (source_value.value_jsonb #>> '{}')::date end) as review_ends_on,
      max(case
        when public.bbe153_normalized_label(source_column.label) = '수수료입금일'
         and jsonb_typeof(source_value.value_jsonb) = 'string'
         and (source_value.value_jsonb #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$'
        then (source_value.value_jsonb #>> '{}')::date end) as fee_paid_on
    from public.items i
    join public.board_columns c on c.board_id = i.board_id
    left join public.item_values existing
      on existing.item_id = i.id and existing.column_key = c.key
    left join public.item_values source_value on source_value.item_id = i.id
    left join public.board_columns source_column
      on source_column.board_id = i.board_id and source_column.key = source_value.column_key
    where public.bbe153_normalized_label(c.label) in ('심사D-day', 'D+180')
      and (c.source = 'calc' or c.is_readonly)
      and (existing.calculated_at is null
        or existing.stale_after is null
        or existing.stale_after <= p_today::timestamp at time zone 'Asia/Seoul')
    group by i.id, i.org_id, c.key, c.label
  ), upserted as (
    insert into public.item_values(
      org_id, item_id, column_key, value_jsonb,
      value_updated_at, calculated_at, stale_after
    )
    select org_id, item_id, column_key,
      case label
        when '심사D-day' then to_jsonb(case
          when review_ends_on is null then null
          when review_ends_on > p_today then 'D-' || (review_ends_on - p_today)::text
          when review_ends_on = p_today then '오늘'
          else '지남' end)
        when 'D+180' then to_jsonb(case when fee_paid_on is null then null else (fee_paid_on + 180)::text end)
      end,
      clock_timestamp(), clock_timestamp(),
      (p_today + 1)::timestamp at time zone 'Asia/Seoul'
    from candidates
    on conflict (item_id, column_key) do update
      set value_jsonb = excluded.value_jsonb,
          value_updated_at = excluded.value_updated_at,
          calculated_at = excluded.calculated_at,
          stale_after = excluded.stale_after
    returning item_id
  )
  select count(distinct item_id) into v_count from upserted;
  return v_count;
end
$$;

revoke all on function public.bbe153_recalculate_daily(date) from public, anon, authenticated, service_role;

-- pg_cron is optional locally. Named scheduling is rerunnable; hosted apply is
-- still a belie approval gate and is not executed by this PR.
do $bbe153_schedule$
begin
  if to_regnamespace('cron') is not null then
    execute $schedule$
      select cron.schedule(
        'bbe153-board-daily-calculations',
        '5 15 * * *',
        'select public.bbe153_recalculate_daily((now() at time zone ''Asia/Seoul'')::date)'
      )
    $schedule$;
  end if;
end
$bbe153_schedule$;

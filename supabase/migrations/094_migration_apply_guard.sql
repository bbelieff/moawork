-- moa-migration-guard: logical_key=094_migration_apply_guard predecessor=093_bbe184_newcust_default_board_repair digest=27fe26d5bc8f287e1c36f049df8236b45907c2ae788df2d39ae5e225c0e71fc8 foundation=true

select pg_advisory_xact_lock(1297040711, 188);

create table public.migration_apply_guard (
  logical_key text primary key,
  file_name text not null unique,
  file_digest text not null check (file_digest ~ '^[0-9a-f]{64}$'),
  expected_predecessor text not null,
  executor text not null check (btrim(executor) <> ''),
  thread_id text not null check (btrim(thread_id) <> ''),
  applied_at timestamptz not null default clock_timestamp()
);

alter table public.migration_apply_guard owner to postgres;
alter table public.migration_apply_guard enable row level security;
alter table public.migration_apply_guard force row level security;
revoke all on table public.migration_apply_guard from public, anon, authenticated, service_role;

create or replace function public.begin_guarded_migration(
  p_logical_key text,
  p_file_name text,
  p_file_digest text,
  p_expected_predecessor text,
  p_executor text,
  p_thread_id text,
  p_foundation boolean default false
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_guard_count bigint;
begin
  if current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'migration guard requires postgres';
  end if;

  if p_logical_key !~ '^[0-9]{3}_[a-z0-9_]+$'
     or p_file_name <> p_logical_key || '.sql'
     or p_file_digest !~ '^[0-9a-f]{64}$'
     or p_expected_predecessor !~ '^[0-9]{3}_[a-z0-9_]+$'
     or btrim(coalesce(p_executor, '')) = ''
     or btrim(coalesce(p_thread_id, '')) = '' then
    raise exception using errcode = '22023', message = 'invalid migration guard metadata';
  end if;

  perform pg_advisory_xact_lock(1297040711, 188);

  if exists (
    select 1 from public.migration_apply_guard where logical_key = p_logical_key
  ) then
    raise exception using errcode = '23505', message = 'migration logical key already applied';
  end if;

  select count(*) into v_guard_count from public.migration_apply_guard;
  if p_foundation then
    if v_guard_count <> 0 then
      raise exception using errcode = '23514', message = 'foundation requires an empty guard ledger';
    end if;
  elsif not exists (
    select 1 from public.migration_apply_guard where logical_key = p_expected_predecessor
  ) then
    raise exception using errcode = '23514', message = 'expected guarded predecessor is missing';
  end if;

  insert into public.migration_apply_guard (
    logical_key, file_name, file_digest, expected_predecessor, executor, thread_id
  ) values (
    p_logical_key, p_file_name, p_file_digest, p_expected_predecessor, p_executor, p_thread_id
  );
end;
$function$;

alter function public.begin_guarded_migration(text, text, text, text, text, text, boolean) owner to postgres;
revoke all on function public.begin_guarded_migration(text, text, text, text, text, text, boolean)
  from public, anon, authenticated, service_role;

select public.begin_guarded_migration(
  p_logical_key => '094_migration_apply_guard',
  p_file_name => '094_migration_apply_guard.sql',
  p_file_digest => '27fe26d5bc8f287e1c36f049df8236b45907c2ae788df2d39ae5e225c0e71fc8',
  p_expected_predecessor => '093_bbe184_newcust_default_board_repair',
  p_executor => 'DG-06',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => true
);

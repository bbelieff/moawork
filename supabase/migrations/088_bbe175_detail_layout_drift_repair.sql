-- BBE-175: repair the hosted schema drift behind board/group detail layouts.
-- Additive only: existing board, group, item, and value rows are never updated.

alter table public.boards
  add column if not exists detail_layout_jsonb jsonb default '[]'::jsonb;

alter table public.board_groups
  add column if not exists detail_layout_jsonb jsonb;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.boards'::regclass
       and conname = 'boards_detail_layout_array'
  ) then
    alter table public.boards
      add constraint boards_detail_layout_array
      check (detail_layout_jsonb is null or jsonb_typeof(detail_layout_jsonb) = 'array');
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.board_groups'::regclass
       and conname = 'board_groups_detail_layout_array'
  ) then
    alter table public.board_groups
      add constraint board_groups_detail_layout_array
      check (detail_layout_jsonb is null or jsonb_typeof(detail_layout_jsonb) = 'array');
  end if;
end
$$;

create or replace function public.guard_detail_layout_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_layout_changed boolean;
begin
  if tg_table_name = 'boards' then
    v_layout_changed := case
      when tg_op = 'INSERT' then new.detail_layout_jsonb is distinct from '[]'::jsonb
      else new.detail_layout_jsonb is distinct from old.detail_layout_jsonb
    end;
  else
    v_layout_changed := case
      when tg_op = 'INSERT' then new.detail_layout_jsonb is not null
      else new.detail_layout_jsonb is distinct from old.detail_layout_jsonb
    end;
  end if;

  if v_layout_changed
     and coalesce(public.org_role(new.org_id)::text, '') not in ('owner', 'admin') then
    raise exception 'detail layout write requires owner or admin'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_detail_layout_write() from public, anon, authenticated;

drop trigger if exists boards_detail_layout_write_guard on public.boards;
create trigger boards_detail_layout_write_guard
before insert or update of detail_layout_jsonb on public.boards
for each row execute function public.guard_detail_layout_write();

drop trigger if exists board_groups_detail_layout_write_guard on public.board_groups;
create trigger board_groups_detail_layout_write_guard
before insert or update of detail_layout_jsonb on public.board_groups
for each row execute function public.guard_detail_layout_write();

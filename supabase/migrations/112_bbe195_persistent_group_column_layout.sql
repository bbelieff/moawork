-- moa-migration-guard: logical_key=112_bbe195_persistent_group_column_layout predecessor=111_bbe264_workspace_owner_deletion_hardening digest=7ff28e87e7f21827e1fb8d203cfe7331d53bae2eb35c5272a35002dde3d385d7 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '112_bbe195_persistent_group_column_layout', p_file_name => '112_bbe195_persistent_group_column_layout.sql',
  p_file_digest => '7ff28e87e7f21827e1fb8d203cfe7331d53bae2eb35c5272a35002dde3d385d7',
  p_expected_predecessor => '111_bbe264_workspace_owner_deletion_hardening', p_executor => 'DG-01',
  p_thread_id => '01a02045-6744-7fa0-9cee-f2700dec67c1', p_foundation => false
);

create unique index if not exists board_views_group_layout_unique
  on public.board_views(org_id, board_id, name)
  where name = '__moawork_group_column_layout_v1__';

create policy board_views_group_layout_insert_rpc_only on public.board_views
  as restrictive for insert to authenticated
  with check (name <> '__moawork_group_column_layout_v1__');
create policy board_views_group_layout_update_rpc_only on public.board_views
  as restrictive for update to authenticated
  using (name <> '__moawork_group_column_layout_v1__')
  with check (name <> '__moawork_group_column_layout_v1__');
create policy board_views_group_layout_delete_rpc_only on public.board_views
  as restrictive for delete to authenticated
  using (name <> '__moawork_group_column_layout_v1__');

create or replace function public.set_board_group_column_order(
  p_board_id uuid,
  p_group_key text,
  p_column_keys text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_current jsonb;
  v_next jsonb;
begin
  if v_actor is null or p_board_id is null or nullif(btrim(p_group_key), '') is null or p_column_keys is null then
    raise exception 'invalid group column layout request' using errcode = '22023';
  end if;

  select b.org_id into v_org_id
    from public.boards b
   where b.id = p_board_id;

  if v_org_id is null
     or not public.effective_permission(v_org_id, 'structure.column_manage') then
    raise exception 'board not found' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':' || p_board_id::text, 195));

  if p_group_key <> '__ungrouped__'
     and not exists (
       select 1 from public.board_groups g
        where g.id::text = p_group_key and g.board_id = p_board_id and g.org_id = v_org_id
     ) then
    raise exception 'group not found' using errcode = '22023';
  end if;

  if cardinality(p_column_keys) <> (
       select count(distinct key) from unnest(p_column_keys) as key
     )
     or exists (
       select 1 from unnest(p_column_keys) as requested(key)
        where not exists (
          select 1 from public.board_columns c
           where c.board_id = p_board_id and c.org_id = v_org_id and c.key = requested.key
        )
     ) then
    raise exception 'column order contains an unknown or duplicate key' using errcode = '22023';
  end if;

  select coalesce(v.visible_columns_jsonb -> 0, '{}'::jsonb)
    into v_current
    from public.board_views v
   where v.org_id = v_org_id
     and v.board_id = p_board_id
     and v.name = '__moawork_group_column_layout_v1__'
   for update;

  v_current := coalesce(v_current, '{}'::jsonb);
  if cardinality(p_column_keys) = 0 then
    v_next := v_current - p_group_key;
  else
    v_next := jsonb_set(v_current, array[p_group_key], to_jsonb(p_column_keys), true);
  end if;

  if v_next = '{}'::jsonb then
    delete from public.board_views v
     where v.org_id = v_org_id
       and v.board_id = p_board_id
       and v.name = '__moawork_group_column_layout_v1__';
    return;
  end if;

  insert into public.board_views(
    org_id, board_id, user_id, name, kind, filters_jsonb,
    sort_jsonb, visible_columns_jsonb, shared
  ) values (
    v_org_id, p_board_id, null, '__moawork_group_column_layout_v1__', 'table',
    '{"system":"group-column-layout-v1"}'::jsonb, '[]'::jsonb,
    jsonb_build_array(v_next), true
  )
  on conflict (org_id, board_id, name)
    where name = '__moawork_group_column_layout_v1__'
  do update set
    visible_columns_jsonb = excluded.visible_columns_jsonb,
    filters_jsonb = excluded.filters_jsonb,
    user_id = null,
    shared = true;
end;
$$;

revoke all on function public.set_board_group_column_order(uuid, text, text[]) from public, anon, service_role;
grant execute on function public.set_board_group_column_order(uuid, text, text[]) to authenticated;

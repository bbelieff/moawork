-- moa-migration-guard: logical_key=126_issue534_default_definition_state_unique predecessor=125_issue530_board_group_order digest=a596b5fc4cc91663fcff760d315f068edb2c688f3fa4fbc475216eb04c05ed34 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '126_issue534_default_definition_state_unique',
  p_file_name => '126_issue534_default_definition_state_unique.sql',
  p_file_digest => 'a596b5fc4cc91663fcff760d315f068edb2c688f3fa4fbc475216eb04c05ed34',
  p_expected_predecessor => '125_issue530_board_group_order',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- Reserved system metadata is new in issue #534. This index serializes concurrent
-- first writes without touching customer board rows or user-created saved views.
create unique index if not exists board_views_default_definition_state_unique
  on public.board_views(board_id)
  where name = '__mw_default_definition__'
    and user_id is null
    and filters_jsonb->>'system' = 'default-definition-state-v1';

create or replace function public.read_default_board_definition_state(p_org_id uuid, p_board_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state jsonb;
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'structure.section_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards where id=p_board_id and org_id=p_org_id) then
    raise exception 'board_unavailable' using errcode='42501';
  end if;
  select filters_jsonb->'state' into v_state from public.board_views
   where org_id=p_org_id and board_id=p_board_id and user_id is null
     and name='__mw_default_definition__' and filters_jsonb->>'system'='default-definition-state-v1';
  return v_state;
end; $$;

create or replace function public.write_default_board_definition_state(p_org_id uuid, p_board_id uuid, p_state jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not public.effective_permission(p_org_id,'structure.section_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards where id=p_board_id and org_id=p_org_id) then
    raise exception 'board_unavailable' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_board_id::text||':default-definition',0));
  update public.board_views set filters_jsonb=jsonb_build_object('system','default-definition-state-v1','state',p_state)
   where org_id=p_org_id and board_id=p_board_id and user_id is null and name='__mw_default_definition__';
  if not found then
    insert into public.board_views(org_id,board_id,user_id,name,kind,filters_jsonb,sort_jsonb,visible_columns_jsonb,shared)
    values(p_org_id,p_board_id,null,'__mw_default_definition__','table',jsonb_build_object('system','default-definition-state-v1','state',p_state),'[]'::jsonb,'[]'::jsonb,false);
  end if;
end; $$;

revoke all on function public.read_default_board_definition_state(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.write_default_board_definition_state(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_default_board_definition_state(uuid,uuid) to authenticated;
grant execute on function public.write_default_board_definition_state(uuid,uuid,jsonb) to authenticated;

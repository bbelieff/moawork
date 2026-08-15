-- BBE-151: concurrent-safe product notice bootstrap and read receipts.

create unique index if not exists boards_org_product_source_uq
  on public.boards(org_id, source)
  where source like 'core.default-tab/%';

create or replace function public.bbe151_ensure_notice_tab(p_org_id uuid, p_definition jsonb)
returns table(board_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid(); v_board uuid; v_created boolean := false;
  v_group jsonb; v_column jsonb; v_group_ids jsonb := '{}'::jsonb; v_group_id uuid;
  v_rule jsonb := '{}'::jsonb; v_pair record;
begin
  if v_actor is null or not public.is_org_member(p_org_id) then raise exception 'organization membership required' using errcode='42501'; end if;
  if p_definition->>'source' <> 'core.default-tab/notice' then raise exception 'invalid notice source' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || (p_definition->>'source'), 0));
  select id into v_board from public.boards where org_id=p_org_id and source=p_definition->>'source';
  if v_board is null then
    insert into public.boards(org_id,name,description,icon,source,sort_order,created_by)
    values(p_org_id,p_definition->>'name',p_definition->>'description',p_definition->>'icon',p_definition->>'source',(select count(*) from public.boards where org_id=p_org_id),v_actor)
    returning id into v_board;
    v_created := true;
    for v_group in select value from jsonb_array_elements(p_definition->'groups') loop
      insert into public.board_groups(org_id,board_id,name,color,sort_order)
      values(p_org_id,v_board,v_group->>'name',v_group->>'color',coalesce((v_group->>'order')::int,0)) returning id into v_group_id;
      v_group_ids := v_group_ids || jsonb_build_object(v_group->>'name',v_group_id::text);
    end loop;
    for v_column in select value from jsonb_array_elements(p_definition->'columns') loop
      v_rule := '{}'::jsonb;
      for v_pair in select key,value from jsonb_each_text(coalesce(v_column->'moveTo','{}'::jsonb)) loop
        v_rule := v_rule || jsonb_build_object(v_pair.key,v_group_ids->>v_pair.value);
      end loop;
      insert into public.board_columns(org_id,board_id,key,label,type,source,options_jsonb,sort_order,width,right_pinned,move_rule_jsonb,is_readonly)
      values(p_org_id,v_board,v_column->>'key',v_column->>'label',(v_column->>'type')::public.field_type,(v_column->>'source')::public.field_source,
        case when jsonb_typeof(v_column->'options')='array' then jsonb_build_object('options',v_column->'options') else null end,
        coalesce((v_column->>'order')::int,0),nullif(v_column->>'width','')::int,coalesce((v_column->>'rightPinned')::boolean,false),nullif(v_rule,'{}'::jsonb),coalesce((v_column->>'readOnly')::boolean,false));
    end loop;
  end if;
  return query select v_board,v_created;
end $$;

create or replace function public.bbe151_mark_notice_read(p_org_id uuid, p_item_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_actor uuid:=auth.uid(); v_targets jsonb; v_readers jsonb; v_count integer;
begin
  if v_actor is null or not public.is_org_member(p_org_id) then raise exception 'organization membership required' using errcode='42501'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id where i.id=p_item_id and i.org_id=p_org_id and b.source='core.default-tab/notice') then raise exception 'notice item not found' using errcode='P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text,0));
  select value_jsonb into v_targets from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='audience';
  if jsonb_typeof(v_targets)<>'array' or not (v_targets ? v_actor::text) then return null; end if;
  select coalesce(value_jsonb,'[]'::jsonb) into v_readers from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='__notice_reader_ids';
  v_readers := coalesce(v_readers,'[]'::jsonb);
  select jsonb_agg(value order by value) into v_readers from (select distinct value from jsonb_array_elements_text(v_readers || jsonb_build_array(v_actor::text))) s;
  select count(*) into v_count from (select value from jsonb_array_elements_text(v_targets) intersect select value from jsonb_array_elements_text(v_readers)) x;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'__notice_reader_ids',v_readers) on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'read_count',to_jsonb(v_count)) on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  return v_count;
end $$;

revoke all on function public.bbe151_ensure_notice_tab(uuid,jsonb) from public,anon;
revoke all on function public.bbe151_mark_notice_read(uuid,uuid) from public,anon;
grant execute on function public.bbe151_ensure_notice_tab(uuid,jsonb) to authenticated;
grant execute on function public.bbe151_mark_notice_read(uuid,uuid) to authenticated;

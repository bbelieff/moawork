-- BBE-151: concurrent-safe product notice bootstrap and read receipts.

create unique index if not exists boards_org_product_source_uq
  on public.boards(org_id, source)
  where source like 'core.default-tab/%';

create or replace function public.bbe151_ensure_notice_tab(p_org_id uuid)
returns table(board_id uuid, created boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid(); v_board uuid; v_created boolean := false;
  v_completed uuid; v_default_group uuid;
begin
  if v_actor is null or not public.is_org_member(p_org_id) then raise exception 'organization membership required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':core.default-tab/notice', 0));
  select id into v_board from public.boards where org_id=p_org_id and source='core.default-tab/notice';
  if v_board is null then
    insert into public.boards(org_id,name,description,icon,source,sort_order,created_by)
    values(p_org_id,'공지사항','공문과 지원사업 공지를 그룹별로 관리합니다.','📢','core.default-tab/notice',(select count(*) from public.boards where org_id=p_org_id),v_actor)
    returning id into v_board;
    v_created := true;
  end if;
  update public.boards set name='공지사항',description='공문과 지원사업 공지를 그룹별로 관리합니다.',icon='📢',is_system=true,source='core.default-tab/notice',updated_at=now() where id=v_board;
  insert into public.board_groups(org_id,board_id,name,color,sort_order)
    select p_org_id,v_board,x.name,x.color,x.ord from (values
      ('📂 매 월 공문리뉴얼','#0073a8',0),('소상공인 직대 접수 대기 업체','#8348b8',1),('특례보증','#00796b',2),('지원사업','#fdab3d',3),('공지 완료','#ffcb00',4)
    ) x(name,color,ord) where not exists(select 1 from public.board_groups g where g.board_id=v_board and g.name=x.name);
  update public.board_groups g set color=x.color,sort_order=x.ord from (values
    ('📂 매 월 공문리뉴얼','#0073a8',0),('소상공인 직대 접수 대기 업체','#8348b8',1),('특례보증','#00796b',2),('지원사업','#fdab3d',3),('공지 완료','#ffcb00',4)
  ) x(name,color,ord) where g.board_id=v_board and g.name=x.name;
  select bg.id into v_default_group from public.board_groups bg where bg.board_id=v_board and bg.name='📂 매 월 공문리뉴얼' order by bg.id limit 1;
  select bg.id into v_completed from public.board_groups bg where bg.board_id=v_board and bg.name='공지 완료' order by bg.id limit 1;
  with ranked as (
    select g.id,g.name,row_number() over(partition by g.name order by g.id) rn,first_value(g.id) over(partition by g.name order by g.id) keeper
    from public.board_groups g where g.board_id=v_board
  ), extras as (
    select r.id,case when r.name in ('📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료') then r.keeper else v_default_group end target
    from ranked r where r.rn>1 or r.name not in ('📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료')
  ) update public.items i set group_id=e.target from extras e where i.board_id=v_board and i.group_id=e.id;
  with ranked as (
    select g.id,g.name,row_number() over(partition by g.name order by g.id) rn from public.board_groups g where g.board_id=v_board
  ) delete from public.board_groups g using ranked r where g.id=r.id and (r.rn>1 or r.name not in ('📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료'));
  insert into public.board_columns(org_id,board_id,key,label,type,source,options_jsonb,sort_order,width,right_pinned,move_rule_jsonb,is_readonly) values
      (p_org_id,v_board,'audience','대상','people','act',null,0,140,false,null,false),
      (p_org_id,v_board,'read_count','읽음','calc','calc',null,1,90,false,null,true),
      (p_org_id,v_board,'author','작성자','person','auto',null,2,110,false,null,true),
      (p_org_id,v_board,'official_pdf','공문PDF','file','in',null,3,130,false,null,false),
      (p_org_id,v_board,'summary','내용 정리','longtext','in',null,4,220,false,null,false),
      (p_org_id,v_board,'low_score_companies','점수 미달인 업체','select','in',null,5,150,false,null,false),
      (p_org_id,v_board,'tax_delinquent_companies','세금 미납인 업체','select','in',null,6,150,false,null,false),
      (p_org_id,v_board,'not_selected_companies','미선정 업체','select','in',null,7,140,false,null,false),
      (p_org_id,v_board,'status','상태','status','act','{"options":[{"id":"작업 중","label":"작업 중","order":0,"color":"#c4c4c4"},{"id":"공지완료","label":"공지완료","order":1,"color":"#ffcb00"}]}'::jsonb,8,110,true,jsonb_build_object('공지완료',v_completed::text),false),
      (p_org_id,v_board,'created_on','작성일','date','auto',null,9,120,false,null,true)
  on conflict on constraint board_columns_board_id_key_key do update set label=excluded.label,type=excluded.type,source=excluded.source,options_jsonb=excluded.options_jsonb,sort_order=excluded.sort_order,width=excluded.width,right_pinned=excluded.right_pinned,move_rule_jsonb=excluded.move_rule_jsonb,is_readonly=excluded.is_readonly;
  delete from public.board_columns c where c.board_id=v_board and c.key not in ('audience','read_count','author','official_pdf','summary','low_score_companies','tax_delinquent_companies','not_selected_companies','status','created_on');
  return query select v_board,v_created;
end $$;

create or replace function public.bbe151_mark_notice_read(p_org_id uuid, p_item_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_actor uuid:=auth.uid(); v_targets jsonb; v_readers jsonb; v_count integer;
  v_scope jsonb; v_published text; v_ended text; v_status text; v_today text;
begin
  if v_actor is null or not public.is_org_member(p_org_id) then raise exception 'organization membership required' using errcode='42501'; end if;
  if not exists(select 1 from public.items i join public.boards b on b.id=i.board_id where i.id=p_item_id and i.org_id=p_org_id and b.source='core.default-tab/notice') then raise exception 'notice item not found' using errcode='P0002'; end if;
  v_scope := public.read_permission_scoped_work_items(p_org_id,null);
  if not coalesce(v_scope->'itemIds','[]'::jsonb) ? p_item_id::text then return null; end if;
  select
    (select value_jsonb from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='audience'),
    (select value_jsonb #>> '{}' from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='published_at'),
    (select value_jsonb #>> '{}' from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='ended_at'),
    (select value_jsonb #>> '{}' from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='status')
  into v_targets,v_published,v_ended,v_status;
  v_today := to_char(current_timestamp at time zone 'Asia/Seoul','YYYY-MM-DD');
  if coalesce(v_published,'')>v_today or (coalesce(v_ended,'')<>'' and v_ended<v_today)
     or coalesce(v_status,'') in ('ended','completed','공지완료') then return null; end if;
  if jsonb_typeof(v_targets)='array' and not (v_targets ? v_actor::text) then return null; end if;
  if jsonb_typeof(v_targets)='string' and v_targets #>> '{}'='notice-audience-managers'
     and public.org_role(p_org_id) not in ('owner','admin') then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_item_id::text,0));
  if jsonb_typeof(v_targets)<>'array' then v_targets:=jsonb_build_array(v_actor::text); end if;
  select coalesce(value_jsonb,'[]'::jsonb) into v_readers from public.item_values where org_id=p_org_id and item_id=p_item_id and column_key='__notice_reader_ids';
  v_readers := coalesce(v_readers,'[]'::jsonb);
  select jsonb_agg(value order by value) into v_readers from (select distinct value from jsonb_array_elements_text(v_readers || jsonb_build_array(v_actor::text))) s;
  select count(*) into v_count from (select value from jsonb_array_elements_text(v_targets) intersect select value from jsonb_array_elements_text(v_readers)) x;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'__notice_reader_ids',v_readers) on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,'read_count',to_jsonb(v_count)) on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  return v_count;
end $$;

revoke all on function public.bbe151_ensure_notice_tab(uuid) from public,anon;
revoke all on function public.bbe151_mark_notice_read(uuid,uuid) from public,anon;
grant execute on function public.bbe151_ensure_notice_tab(uuid) to authenticated;
grant execute on function public.bbe151_mark_notice_read(uuid,uuid) to authenticated;

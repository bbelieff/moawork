-- moa-migration-guard: logical_key=101_bbe238_notice_board_unlock predecessor=100_bbe236_company_csv_import digest=c83e6f3407646109c7b5bf3e387860ab61d40515f698d9fe16fe993eda62fe5a foundation=false

select public.begin_guarded_migration(
  p_logical_key => '101_bbe238_notice_board_unlock',
  p_file_name => '101_bbe238_notice_board_unlock.sql',
  p_file_digest => 'c83e6f3407646109c7b5bf3e387860ab61d40515f698d9fe16fe993eda62fe5a',
  p_expected_predecessor => '100_bbe236_company_csv_import',
  p_executor => 'DC-00',
  p_thread_id => '563d0435-5fbf-4c82-bb05-81c1f98a920e',
  p_foundation => false
);

-- BBE-238: 공지사항 보드 완전 잠금 회귀 되돌림.
--
-- 066_notice_atomic_contract.sql 이 D77(2026-08-12, "boards.is_system 을 잠금 용도로
-- 쓰지 않는다")보다 나흘 늦게 배포되면서 bbe151_ensure_notice_tab() 안에
-- is_system=true 를 심었다 — 총괄 확인 결과 이걸 넣은 의도적 사유가 없었다(2026-08-19).
-- 066 은 수정하지 않는다(레포 규칙) — 여기서 함수를 재정의하고 기존 값을 백필한다.

-- 이미 배포된 조직의 공지사항 보드 백필(있으면 고치고, 없으면 영향 없음).
update public.boards set is_system = false, updated_at = now()
  where source = 'core.default-tab/notice' and is_system = true;

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
  -- BBE-238: is_system=false — D76/D77 대로 회사가 이름·컬럼·삭제까지 자유롭게 고친다.
  update public.boards set name='공지사항',description='공문과 지원사업 공지를 그룹별로 관리합니다.',icon='📢',is_system=false,source='core.default-tab/notice',updated_at=now() where id=v_board;
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

revoke all on function public.bbe151_ensure_notice_tab(uuid) from public,anon;
grant execute on function public.bbe151_ensure_notice_tab(uuid) to authenticated;

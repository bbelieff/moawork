-- moa-migration-guard: logical_key=125_issue530_board_group_order predecessor=124_issue524_company_detail_feed digest=44471785ad899fc27238db0a9ee0513f0bdb24579c20d136f68e8a273dece27d foundation=false

select public.begin_guarded_migration(
  p_logical_key => '125_issue530_board_group_order',
  p_file_name => '125_issue530_board_group_order.sql',
  p_file_digest => '44471785ad899fc27238db0a9ee0513f0bdb24579c20d136f68e8a273dece27d',
  p_expected_predecessor => '124_issue524_company_detail_feed',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

create or replace function public.reorder_board_groups(
  p_org_id uuid,
  p_board_id uuid,
  p_group_ids uuid[]
) returns setof public.board_groups
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if v_actor is null or not public.effective_permission(p_org_id,'structure.section_manage') then
    raise exception 'permission_denied' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_board_id::text,0));
  if not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and not b.is_system) then
    raise exception 'board_unavailable' using errcode='42501';
  end if;
  select count(*) into v_count from public.board_groups g where g.org_id=p_org_id and g.board_id=p_board_id;
  if coalesce(array_length(p_group_ids,1),0)<>v_count
    or (select count(distinct requested.input_id) from unnest(p_group_ids) requested(input_id))<>v_count
    or exists(select 1 from unnest(p_group_ids) requested(input_id) where not exists(
      select 1 from public.board_groups g where g.id=requested.input_id and g.org_id=p_org_id and g.board_id=p_board_id
    )) then
    raise exception 'group_set_mismatch' using errcode='22023';
  end if;
  update public.board_groups g set sort_order=ordered.ord - 1
  from unnest(p_group_ids) with ordinality ordered(id,ord)
  where g.id=ordered.id and g.org_id=p_org_id and g.board_id=p_board_id;
  return query select g.* from public.board_groups g
    where g.org_id=p_org_id and g.board_id=p_board_id order by g.sort_order,g.id;
end $$;

revoke all on function public.reorder_board_groups(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.reorder_board_groups(uuid,uuid,uuid[]) to authenticated;

-- #522: only boards whose order information is already lost are repaired. Boards with unique
-- sort_order values are excluded, preserving every user-defined order.
with damaged as (
  select b.id,b.source
  from public.boards b join public.board_groups g on g.board_id=b.id and g.org_id=b.org_id
  where b.source in ('core.default-tab/new-lead','core.default-tab/contact','core.default-tab/contract-work','core.default-tab/notice')
  group by b.id,b.source
  having count(distinct g.sort_order)<count(*)
), ranked as (
  select g.id,
    row_number() over(partition by g.board_id order by
      case d.source
        when 'core.default-tab/new-lead' then array_position(array['💡 신규고객','🔍 2차 상담고객','🔇 1차 부재','📑 보류','🚫 거절'],g.name)
        when 'core.default-tab/notice' then array_position(array['📂 매 월 공문리뉴얼','소상공인 직대 접수 대기 업체','특례보증','지원사업','공지 완료'],g.name)
        when 'core.default-tab/contact' then case when g.name='💰 컨텍' then 1 when g.name like '💰 담당자 %' then 2 when g.name='💰 계약보류(온/오프)' then 4 when g.name='📍 미팅보류' then 5 when g.name='📍 미팅취소' then 6 when g.name='📍 계약취소' then 7 else null end
        when 'core.default-tab/contract-work' then array_position(array['⏹️ 준비단계','▶️ 진행중','🔂 심사 중','💰 승인','📂 소진공 취약자금 접수예정','📂 소진공 혁신성장 접수예정','📂 소진공 일시적경영애로 접수예정','📂 소진공 재도전 접수예정','기업인증 진행','관리중','⛔ 대출불가'],g.name)
      end nulls last,
      g.name,g.id
    )-1 as new_order
  from public.board_groups g join damaged d on d.id=g.board_id
)
update public.board_groups g set sort_order=r.new_order from ranked r where r.id=g.id;

do $$ begin
  if exists(select 1 from public.boards b join public.board_groups g on g.board_id=b.id and g.org_id=b.org_id
    where b.source in ('core.default-tab/new-lead','core.default-tab/contact','core.default-tab/contract-work','core.default-tab/notice')
    group by b.id having count(distinct g.sort_order)<count(*)) then raise exception 'duplicate_group_order_remains'; end if;
end $$;

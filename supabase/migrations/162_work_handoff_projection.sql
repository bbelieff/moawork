-- moa-migration-guard: logical_key=162_work_handoff_projection predecessor=161_consultation_seal_handoff digest=0bd71d8d01f26876000c6afcf9707892ff53dc61780025e7d71d234e8fc6e461 foundation=false
select public.begin_guarded_migration(
  p_logical_key => '162_work_handoff_projection', p_file_name => '162_work_handoff_projection.sql',
  p_file_digest => '0bd71d8d01f26876000c6afcf9707892ff53dc61780025e7d71d234e8fc6e461', p_expected_predecessor => '161_consultation_seal_handoff',
  p_executor => 'Codex', p_thread_id => 'v17-work-projection', p_foundation => false
);

-- 087 allows one live item per org/deal. 100 incorrectly counted a contact item
-- as an already-created work projection. Retain that item, its values/history,
-- and the existing 139 writer boundary rather than creating a second identity.
create function public.project_committed_work_item(p_org_id uuid,p_deal_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_deal public.deals%rowtype;
  v_item public.items%rowtype; v_source text; v_board uuid; v_group uuid; v_count bigint;
begin
  select m.role::text,m.scope::text into v_role,v_scope
    from public.org_members m join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if not found or not public.effective_permission(p_org_id,'work.view_tabs')
    or not public.effective_permission(p_org_id,'work.item_upsert') then
    raise exception 'work projection permission denied' using errcode='42501'; end if;
  select * into v_item from public.items i where i.org_id=p_org_id and i.deal_id=p_deal_id
    and i.deleted_at is null for update;
  select * into v_deal from public.deals d where d.org_id=p_org_id and d.id=p_deal_id for update;
  if not found or not coalesce(v_role in ('owner','admin') or v_scope='all'
    or (v_deal.assigned_to=v_actor and (v_item.id is null or v_item.assigned_to=v_actor)),false) then
    raise exception 'work projection permission denied' using errcode='42501'; end if;
  if not exists(select 1 from public.pipelines p join public.stages s on s.pipeline_id=p.id
      where p.org_id=p_org_id and p.id=v_deal.pipeline_id and s.id=v_deal.stage_id and s.kind='work')
    or v_deal.company_id is null
    or not exists(select 1 from public.companies c where c.id=v_deal.company_id and c.org_id=p_org_id)
    or not exists(select 1 from public.contact_pipeline_transitions t where t.org_id=p_org_id
      and t.deal_id=p_deal_id and t.kind='contact_to_work' and t.status='committed') then
    raise exception 'committed work handoff required' using errcode='22023'; end if;
  if v_item.id is not null then
    if v_item.archived_at is not null then
      raise exception 'archived item must be restored before editing' using errcode='55000'; end if;
    select b.source into v_source from public.boards b where b.id=v_item.board_id and b.org_id=p_org_id;
    if v_source='core.default-tab/contract-work' then return; end if;
    if v_source is distinct from 'core.default-tab/contact' then
      raise exception 'work projection source unavailable' using errcode='22023'; end if;
    if v_item.parent_item_id is not null or exists(select 1 from public.items c
      where c.org_id=p_org_id and c.parent_item_id=v_item.id and c.deleted_at is null) then
      raise exception '상위·하위 항목 연결을 해제한 뒤 인계해 주세요.' using errcode='22023'; end if;
  elsif exists(select 1 from public.items i where i.org_id=p_org_id and i.deal_id=p_deal_id) then
    raise exception '삭제된 항목은 복원한 뒤 인계해 주세요.' using errcode='22023';
  end if;
  select count(*),(array_agg(b.id order by b.id))[1] into v_count,v_board
    from public.boards b where b.org_id=p_org_id and b.source='core.default-tab/contract-work';
  if v_count<>1 then raise exception '계약업체 실무 보드를 확인해 주세요.' using errcode='22023'; end if;
  select g.id into v_group from public.board_groups g where g.org_id=p_org_id and g.board_id=v_board
    order by g.sort_order,g.id limit 1;
  if v_group is null then raise exception '계약업체 실무 보드에 그룹이 필요합니다.' using errcode='22023'; end if;
  if v_item.id is null then
    -- Existing CRM-only path has no item to move. Keep 100's one-item projection.
    insert into public.items(org_id,board_id,group_id,title,assigned_to,deal_id)
      values(p_org_id,v_board,v_group,coalesce(nullif(btrim(v_deal.title),''),'(제목 없음)'),v_deal.assigned_to,p_deal_id);
  else
    perform public.issue602_move_board_item_private(p_org_id,v_item.id,v_item.board_id,v_item.group_id,v_board,v_group,null,null);
  end if;
end $$;
revoke all on function public.project_committed_work_item(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.bbe235_project_work_board()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='committed' and new.kind='contact_to_work' and new.deal_id is not null then
    perform public.project_committed_work_item(new.org_id,new.deal_id);
  end if;
  return new;
end $$;
revoke all on function public.bbe235_project_work_board() from public,anon,authenticated,service_role;

-- moa-migration-guard: logical_key=110_bbe171_new_lead_title_audit predecessor=109_bbe268_migration_frontier_bridge digest=ac92e81f40161e0ed783dfb4f30768e3118f1ceda3549fad6422a17b6519a626 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '110_bbe171_new_lead_title_audit',
  p_file_name => '110_bbe171_new_lead_title_audit.sql',
  p_file_digest => 'ac92e81f40161e0ed783dfb4f30768e3118f1ceda3549fad6422a17b6519a626',
  p_expected_predecessor => '109_bbe268_migration_frontier_bridge',
  p_executor => 'DG-03',
  p_thread_id => '01a02046-554e-7471-9911-0813a9645a6c',
  p_foundation => false
);

create or replace function public.update_new_lead_title(
  p_org_id uuid, p_deal_id uuid, p_request_id uuid, p_title text,
  p_value_source text default 'manual'
) returns table(deal_id uuid, item_id uuid, replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid;
  v_item uuid; v_old text; v_title text:=nullif(btrim(coalesce(p_title,'')),'');
  v_payload jsonb; v_prior public.new_lead_requests%rowtype;
begin
  if v_actor is null or p_request_id is null or v_title is null
     or p_value_source not in ('manual','automation','import') then
    raise exception 'new lead title input invalid' using errcode='22023';
  end if;
  select m.role::text,m.scope::text,d.assigned_to,d.title into v_role,v_scope,v_assigned,v_old
    from public.org_members m join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active'
   for update of d;
  if not found or not public.effective_permission(p_org_id,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'new lead title update denied' using errcode='42501';
  end if;
  select i.id into v_item from public.items i join public.boards b on b.id=i.board_id
   where i.org_id=p_org_id and i.deal_id=p_deal_id and i.deleted_at is null
     and b.org_id=p_org_id and b.source='core.default-tab/new-lead' for update of i;
  if not found then raise exception 'new lead projection unavailable' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('deal_id',p_deal_id,'title',v_title,'value_source',p_value_source);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation<>'update' or v_prior.payload<>v_payload or v_prior.actor_id<>v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023'; end if;
    return query select p_deal_id,v_item,true; return;
  end if;
  if p_value_source='automation' and exists(select 1 from public.deal_intake_field_audit a
     where a.org_id=p_org_id and a.deal_id=p_deal_id and a.field_key='title' and a.value_source='manual') then
    raise exception 'manual correction conflict: title' using errcode='40001';
  end if;
  if v_old is distinct from v_title then
    insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
      values(p_org_id,p_deal_id,'title',to_jsonb(v_old),to_jsonb(v_title),p_value_source,v_actor,p_request_id);
    update public.deals set title=v_title,updated_at=now() where org_id=p_org_id and id=p_deal_id;
    update public.items set title=v_title,updated_at=now() where org_id=p_org_id and id=v_item;
  end if;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'update',p_deal_id,v_item,v_actor,v_payload);
  return query select p_deal_id,v_item,false;
end $$;

revoke all on function public.update_new_lead_title(uuid,uuid,uuid,text,text) from public,anon,service_role;
grant execute on function public.update_new_lead_title(uuid,uuid,uuid,text,text) to authenticated;

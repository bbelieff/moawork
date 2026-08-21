-- moa-migration-guard: logical_key=119_bbe272_new_lead_default_stage predecessor=118_bbe178_column_value_and_schedule_dispatch digest=dfc8ff87fa828720b6a79acb18176cb165bc09b404889de834b6220a0edeeedf foundation=false

select public.begin_guarded_migration(
  p_logical_key => '119_bbe272_new_lead_default_stage',
  p_file_name => '119_bbe272_new_lead_default_stage.sql',
  p_file_digest => 'dfc8ff87fa828720b6a79acb18176cb165bc09b404889de834b6220a0edeeedf',
  p_expected_predecessor => '118_bbe178_column_value_and_schedule_dispatch',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- BBE-272: a workspace with no CRM pipeline must still be able to save its
-- first new lead. The ensure is deliberately inside the canonical RPC so the
-- structure and lead rows commit or roll back together.
create or replace function public.create_new_lead(
  p_org_id uuid, p_board_id uuid, p_group_id uuid, p_request_id uuid, p_title text,
  p_representative_name text default null, p_phone text default null, p_email text default null,
  p_business_registration_type text default null, p_industry text default null,
  p_industry_code text default null, p_revenue_band text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_acquisition_source text default null, p_source_external_id text default null,
  p_assigned_to uuid default null
) returns table(deal_id uuid, item_id uuid, replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid(); v_role text; v_scope text; v_assignee uuid;
  v_stage uuid; v_pipeline uuid; v_deal uuid; v_item uuid; v_payload jsonb; v_prior public.new_lead_requests%rowtype;
  v_phone text := nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
begin
  if v_actor is null or p_request_id is null or nullif(btrim(coalesce(p_title,'')),'') is null then
    raise exception 'new lead input required' using errcode='22023';
  end if;
  select m.role::text,m.scope::text into v_role,v_scope from public.org_members m
   join public.orgs o on o.id=m.org_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if not found or not public.effective_permission(p_org_id,'work.item_upsert') then
    raise exception 'new lead permission denied' using errcode='42501';
  end if;
  v_assignee := coalesce(p_assigned_to,v_actor);
  if v_assignee<>v_actor and not (v_role in ('owner','admin') or v_scope='all') then
    raise exception 'new lead assignee denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=v_assignee and m.status='active') then
    raise exception 'new lead assignee unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and b.source='core.default-tab/new-lead')
     or not exists(select 1 from public.board_groups g where g.id=p_group_id and g.board_id=p_board_id and g.org_id=p_org_id) then
    raise exception 'new lead projection target unavailable' using errcode='22023';
  end if;

  v_payload := jsonb_build_object('title',btrim(p_title),'representative_name',p_representative_name,
    'phone',v_phone,'email',v_email,'business_registration_type',p_business_registration_type,
    'industry',p_industry,'industry_code',p_industry_code,'revenue_band',p_revenue_band,
    'region_sido',p_region_sido,'region_sigungu',p_region_sigungu,'acquisition_source',p_acquisition_source,
    'source_external_id',p_source_external_id,'assigned_to',v_assignee,'board_id',p_board_id,'group_id',p_group_id);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation<>'create' or v_prior.payload<>v_payload or v_prior.actor_id<>v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023';
    end if;
    return query select v_prior.deal_id,v_prior.item_id,true; return;
  end if;

  -- One initializer per organization. This lock is independent from the
  -- request-id replay lock above and prevents duplicate default structures
  -- when two first leads arrive together.
  perform pg_advisory_xact_lock(hashtextextended('bbe272:new-lead-stage:'||p_org_id::text,0));
  select s.id,s.pipeline_id into v_stage,v_pipeline
    from public.stages s join public.pipelines p on p.id=s.pipeline_id
   where p.org_id=p_org_id and s.kind::text='marketing'
   order by p.id,s.sort_order,s.id limit 1;
  if v_stage is null then
    select p.id into v_pipeline from public.pipelines p
     where p.org_id=p_org_id order by p.id limit 1;
    if v_pipeline is null then
      insert into public.pipelines(org_id,name)
        values(p_org_id,'기본 파이프라인') returning id into v_pipeline;
    end if;
    insert into public.stages(pipeline_id,name,sort_order,kind)
      select v_pipeline,'신규고객',coalesce(max(s.sort_order)+1,0),'marketing'::public.stage_kind
        from public.stages s where s.pipeline_id=v_pipeline
      returning id into v_stage;
  end if;

  insert into public.deals(org_id,company_id,pipeline_id,stage_id,assigned_to,title)
    values(p_org_id,null,v_pipeline,v_stage,v_assignee,btrim(p_title)) returning id into v_deal;
  insert into public.deal_intake(deal_id,org_id,representative_name,phone_normalized,phone_display,email_normalized,
    business_registration_type,industry,industry_code,revenue_band,region_sido,region_sigungu,acquisition_source,source_external_id)
    values(v_deal,p_org_id,nullif(btrim(coalesce(p_representative_name,'')),''),v_phone,nullif(btrim(coalesce(p_phone,'')),''),v_email,
      nullif(btrim(coalesce(p_business_registration_type,'')),''),nullif(btrim(coalesce(p_industry,'')),''),nullif(btrim(coalesce(p_industry_code,'')),''),
      nullif(btrim(coalesce(p_revenue_band,'')),''),nullif(btrim(coalesce(p_region_sido,'')),''),nullif(btrim(coalesce(p_region_sigungu,'')),''),
      nullif(btrim(coalesce(p_acquisition_source,'')),''),nullif(btrim(coalesce(p_source_external_id,'')),''));
  insert into public.items(org_id,board_id,group_id,title,assigned_to,deal_id)
    values(p_org_id,p_board_id,p_group_id,btrim(p_title),v_assignee,v_deal) returning id into v_item;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'create',v_deal,v_item,v_actor,v_payload);
  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select p_org_id,v_item,x.key,x.value
  from public.deal_intake i
  cross join lateral jsonb_each(jsonb_build_object(
    'rep_name',to_jsonb(i.representative_name),'phone',to_jsonb(i.phone_display),'email',to_jsonb(i.email_normalized),
    'industry',to_jsonb(i.industry),'region_sido',to_jsonb(i.region_sido),'region_sigungu',to_jsonb(i.region_sigungu))) x
  join public.board_columns c on c.board_id=p_board_id and c.key=x.key where x.value<>'null'::jsonb;
  return query select v_deal,v_item,false;
end $$;

revoke all on function public.create_new_lead(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid)
  from public,anon,service_role;
grant execute on function public.create_new_lead(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid)
  to authenticated;

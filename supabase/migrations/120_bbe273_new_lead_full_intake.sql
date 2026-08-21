-- moa-migration-guard: logical_key=120_bbe273_new_lead_full_intake predecessor=119_bbe272_new_lead_default_stage digest=89d371eb60436ab467d366efafda4b9ce43b2cf0b7f5047cf51aef9879afa781 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '120_bbe273_new_lead_full_intake',
  p_file_name => '120_bbe273_new_lead_full_intake.sql',
  p_file_digest => '89d371eb60436ab467d366efafda4b9ce43b2cf0b7f5047cf51aef9879afa781',
  p_expected_predecessor => '119_bbe272_new_lead_default_stage',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- Canonical facts stay nullable. Presentation-specific explicit states live in
-- the board projection, so no existing customer row is backfilled or invented.
alter table public.deal_intake add column if not exists address_detail text;
alter table public.deal_intake_field_audit
  drop constraint if exists deal_intake_field_audit_value_source_check;
alter table public.deal_intake_field_audit
  add constraint deal_intake_field_audit_value_source_check
  check (value_source in ('manual','system','automation','import'));

-- Detailed address is a canonical deal_intake fact, not a 23rd visible board
-- column. Permit only that hidden projection on the canonical new-lead board;
-- guard_new_lead_projection_write below still rejects generic/direct writes.
create or replace function public.board_column_value_is_valid(
  p_org_id uuid, p_item_id uuid, p_column_key text, p_value jsonb
) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_col public.board_columns; v_missing boolean;
begin
  if p_column_key='address_detail' and exists(
    select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
     where i.id=p_item_id and i.org_id=p_org_id and i.deal_id is not null
       and i.deleted_at is null and b.source='core.default-tab/new-lead'
  ) then
    return p_value is null or p_value='null'::jsonb or jsonb_typeof(p_value)='string';
  end if;
  select c.* into v_col from public.items i join public.board_columns c
    on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_column_key
   where i.id=p_item_id and i.org_id=p_org_id and c.archived_at is null;
  if not found then return false; end if;
  v_missing:=p_value is null or p_value='null'::jsonb
    or (jsonb_typeof(p_value)='string' and btrim(p_value#>>'{}')='');
  if v_missing then return not v_col.is_required; end if;
  if v_col.validation_jsonb?'minLength' and (jsonb_typeof(p_value)<>'string' or char_length(p_value#>>'{}')<(v_col.validation_jsonb->>'minLength')::int) then return false; end if;
  if v_col.validation_jsonb?'maxLength' and (jsonb_typeof(p_value)<>'string' or char_length(p_value#>>'{}')>(v_col.validation_jsonb->>'maxLength')::int) then return false; end if;
  if v_col.validation_jsonb?'min' and (jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')::numeric<(v_col.validation_jsonb->>'min')::numeric) then return false; end if;
  if v_col.validation_jsonb?'max' and (jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')::numeric>(v_col.validation_jsonb->>'max')::numeric) then return false; end if;
  if v_col.validation_jsonb?'pattern' and (jsonb_typeof(p_value)<>'string' or not (p_value#>>'{}') ~ (v_col.validation_jsonb->>'pattern')) then return false; end if;
  if v_col.validation_jsonb?'allowedValues' and not (v_col.validation_jsonb->'allowedValues' @> jsonb_build_array(p_value)) then return false; end if;
  if v_col.validation_jsonb?'dateMin' and (jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')::timestamptz<(v_col.validation_jsonb->>'dateMin')::timestamptz) then return false; end if;
  if v_col.validation_jsonb?'dateMax' and (jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')::timestamptz>(v_col.validation_jsonb->>'dateMax')::timestamptz) then return false; end if;
  return true;
exception when invalid_regular_expression then return false;
end $$;

create or replace function public.board_column_value_visible(p_org_id uuid,p_item_id uuid,p_column_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(
    select 1 from public.items i join public.board_columns c
      on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_column_key
    join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
    join public.orgs o on o.id=i.org_id and o.status='active'
    where i.org_id=p_org_id and i.id=p_item_id and c.archived_at is null
      and public.effective_permission(p_org_id,'work.view_tabs')
      and public.board_column_policy_allows(p_org_id,c.view_policy_jsonb)
      and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
  ) or (
    p_column_key='address_detail' and exists(
      select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
      join public.org_members m on m.org_id=i.org_id and m.user_id=auth.uid() and m.status='active'
      join public.orgs o on o.id=i.org_id and o.status='active'
      where i.org_id=p_org_id and i.id=p_item_id and i.deal_id is not null and i.deleted_at is null
        and b.source='core.default-tab/new-lead'
        and public.effective_permission(p_org_id,'work.view_tabs')
        and (m.role in ('owner','admin') or m.scope='all' or i.assigned_to=auth.uid())
    )
  )
$$;

-- The canonical write guard must name the keys that the two live 22-column
-- board variants actually use. Keep legacy aliases guarded as well.
create or replace function public.guard_new_lead_projection_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_item uuid:=coalesce(new.item_id,old.item_id); v_key text:=coalesce(new.column_key,old.column_key);
begin
  if v_key in (
    'owner','collaborators','applied_on',
    'rep_name','phone','email','biz_reg_type','industry','revenue_band','sido','sigungu','ad_name',
    'business_registration_type','industry_code','region_sido','region_sigungu','acquisition_source','source_external_id','address_detail'
  ) and exists(
    select 1 from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
     where i.id=v_item and i.deal_id is not null and b.source='core.default-tab/new-lead'
  )
    and current_setting('moawork.new_lead_projection_write',true) is distinct from 'on' then
    raise exception 'canonical new lead fields require update_new_lead_fields' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_new_lead_projection_write() from public,anon,authenticated,service_role;
drop trigger if exists guard_new_lead_projection_write on public.item_values;
create trigger guard_new_lead_projection_write before insert or update or delete on public.item_values
for each row execute function public.guard_new_lead_projection_write();

-- Existing update_new_lead_fields remains the canonical/audited writer. This
-- trigger corrects only its projection aliases after a canonical fact changes;
-- it does not backfill or touch an existing customer row until that row is edited.
create or replace function public.sync_new_lead_intake_projection()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_item uuid; v_board uuid;
begin
  select i.id,i.board_id into v_item,v_board
    from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
   where i.org_id=new.org_id and i.deal_id=new.deal_id and i.deleted_at is null
     and b.source='core.default-tab/new-lead';
  if not found then return new; end if;
  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select new.org_id,v_item,x.key,x.value
    from jsonb_each(jsonb_build_object(
      'rep_name',to_jsonb(new.representative_name),'phone',to_jsonb(new.phone_display),'email',to_jsonb(new.email_normalized),
      'biz_reg_type',to_jsonb(new.business_registration_type),'industry',to_jsonb(new.industry),
      'revenue_band',to_jsonb(new.revenue_band),'sido',to_jsonb(new.region_sido),'sigungu',to_jsonb(new.region_sigungu),
      'ad_name',to_jsonb(new.acquisition_source),
      'business_registration_type',to_jsonb(new.business_registration_type),
      'region_sido',to_jsonb(new.region_sido),'region_sigungu',to_jsonb(new.region_sigungu),
      'acquisition_source',to_jsonb(new.acquisition_source)
    )) x join public.board_columns c on c.org_id=new.org_id and c.board_id=v_board and c.key=x.key
  on conflict on constraint item_values_pkey do update
    set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
    values(new.org_id,v_item,'address_detail',to_jsonb(new.address_detail))
  on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  return new;
end $$;
revoke all on function public.sync_new_lead_intake_projection() from public,anon,authenticated,service_role;
drop trigger if exists sync_new_lead_intake_projection on public.deal_intake;
create trigger sync_new_lead_intake_projection after update on public.deal_intake
for each row execute function public.sync_new_lead_intake_projection();

drop function if exists public.create_new_lead(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid
);

create function public.create_new_lead(
  p_org_id uuid, p_board_id uuid, p_group_id uuid, p_request_id uuid, p_title text,
  p_representative_name text default null, p_phone text default null, p_email text default null,
  p_business_registration_type text default null, p_industry text default null,
  p_industry_code text default null, p_revenue_band text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_acquisition_source text default null, p_source_external_id text default null,
  p_assigned_to uuid default null, p_address_detail text default null,
  p_collaborator_ids uuid[] default '{}'::uuid[]
) returns table(deal_id uuid, item_id uuid, replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid(); v_role text; v_scope text; v_assignee uuid;
  v_stage uuid; v_pipeline uuid; v_deal uuid; v_item uuid;
  v_payload jsonb; v_prior public.new_lead_requests%rowtype;
  v_phone text := nullif(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'');
  v_email text := nullif(lower(btrim(coalesce(p_email,''))),'');
  v_applied_on date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  v_collaborators uuid[];
begin
  if v_actor is null or p_request_id is null or nullif(btrim(coalesce(p_title,'')),'') is null then
    raise exception 'new lead input required' using errcode='22023';
  end if;
  select m.role::text,m.scope::text into v_role,v_scope
    from public.org_members m join public.orgs o on o.id=m.org_id
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
  select coalesce(array_agg(distinct x.user_id order by x.user_id),'{}'::uuid[])
    into v_collaborators from unnest(coalesce(p_collaborator_ids,'{}'::uuid[])) x(user_id);
  if exists(
    select 1 from unnest(v_collaborators) x(user_id)
    where not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=x.user_id and m.status='active')
  ) then
    raise exception 'new lead collaborator unavailable' using errcode='42501';
  end if;
  if not exists(select 1 from public.boards b where b.id=p_board_id and b.org_id=p_org_id and b.source='core.default-tab/new-lead')
     or not exists(select 1 from public.board_groups g where g.id=p_group_id and g.board_id=p_board_id and g.org_id=p_org_id) then
    raise exception 'new lead projection target unavailable' using errcode='22023';
  end if;

  v_payload := jsonb_build_object(
    'title',btrim(p_title),'representative_name',p_representative_name,'phone',v_phone,'email',v_email,
    'business_registration_type',p_business_registration_type,'industry',p_industry,'industry_code',p_industry_code,
    'revenue_band',p_revenue_band,'region_sido',p_region_sido,'region_sigungu',p_region_sigungu,
    'address_detail',p_address_detail,'acquisition_source',p_acquisition_source,'source_external_id',p_source_external_id,
    'assigned_to',v_assignee,'collaborator_ids',to_jsonb(v_collaborators),'board_id',p_board_id,'group_id',p_group_id
  );
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation<>'create' or v_prior.payload<>v_payload or v_prior.actor_id<>v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023';
    end if;
    return query select v_prior.deal_id,v_prior.item_id,true; return;
  end if;

  -- BBE-272 initializer remains inside this transaction.
  perform pg_advisory_xact_lock(hashtextextended('bbe272:new-lead-stage:'||p_org_id::text,0));
  select s.id,s.pipeline_id into v_stage,v_pipeline
    from public.stages s join public.pipelines p on p.id=s.pipeline_id
   where p.org_id=p_org_id and s.kind::text='marketing'
   order by p.id,s.sort_order,s.id limit 1;
  if v_stage is null then
    select p.id into v_pipeline from public.pipelines p where p.org_id=p_org_id order by p.id limit 1;
    if v_pipeline is null then
      insert into public.pipelines(org_id,name) values(p_org_id,'기본 파이프라인') returning id into v_pipeline;
    end if;
    insert into public.stages(pipeline_id,name,sort_order,kind)
      select v_pipeline,'신규고객',coalesce(max(s.sort_order)+1,0),'marketing'::public.stage_kind
        from public.stages s where s.pipeline_id=v_pipeline returning id into v_stage;
  end if;

  insert into public.deals(org_id,company_id,pipeline_id,stage_id,assigned_to,title,applied_on)
    values(p_org_id,null,v_pipeline,v_stage,v_assignee,btrim(p_title),v_applied_on) returning id into v_deal;
  insert into public.deal_intake(
    deal_id,org_id,representative_name,phone_normalized,phone_display,email_normalized,
    business_registration_type,industry,industry_code,revenue_band,region_sido,region_sigungu,
    address_detail,acquisition_source,source_external_id
  ) values(
    v_deal,p_org_id,nullif(btrim(coalesce(p_representative_name,'')),''),v_phone,nullif(btrim(coalesce(p_phone,'')),''),v_email,
    nullif(btrim(coalesce(p_business_registration_type,'')),''),nullif(btrim(coalesce(p_industry,'')),''),
    nullif(btrim(coalesce(p_industry_code,'')),''),nullif(btrim(coalesce(p_revenue_band,'')),''),
    nullif(btrim(coalesce(p_region_sido,'')),''),nullif(btrim(coalesce(p_region_sigungu,'')),''),
    nullif(btrim(coalesce(p_address_detail,'')),''),nullif(btrim(coalesce(p_acquisition_source,'')),''),
    nullif(btrim(coalesce(p_source_external_id,'')),'')
  );
  insert into public.items(org_id,board_id,group_id,title,assigned_to,deal_id)
    values(p_org_id,p_board_id,p_group_id,btrim(p_title),v_assignee,v_deal) returning id into v_item;

  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select p_org_id,v_item,x.key,x.value
    from jsonb_each(jsonb_build_object(
      'owner',to_jsonb(v_assignee),'collaborators',to_jsonb(v_collaborators),'applied_on',to_jsonb(v_applied_on),
      'phone',to_jsonb(nullif(btrim(coalesce(p_phone,'')),'')),'rep_name',to_jsonb(nullif(btrim(coalesce(p_representative_name,'')),'')),
      'biz_reg_type',to_jsonb(nullif(btrim(coalesce(p_business_registration_type,'')),'')),
      'industry',to_jsonb(nullif(btrim(coalesce(p_industry,'')),'')),'revenue_band',to_jsonb(nullif(btrim(coalesce(p_revenue_band,'')),'')),
      'sido',to_jsonb(nullif(btrim(coalesce(p_region_sido,'')),'')),'sigungu',to_jsonb(nullif(btrim(coalesce(p_region_sigungu,'')),'')),
      'email',to_jsonb(v_email),'ad_name',to_jsonb(nullif(btrim(coalesce(p_acquisition_source,'')),'')),
      'business_registration_type',to_jsonb(nullif(btrim(coalesce(p_business_registration_type,'')),'')),
      'region_sido',to_jsonb(nullif(btrim(coalesce(p_region_sido,'')),'')),
      'region_sigungu',to_jsonb(nullif(btrim(coalesce(p_region_sigungu,'')),'')),
      'acquisition_source',to_jsonb(nullif(btrim(coalesce(p_acquisition_source,'')),'')),
      'absence_notice',to_jsonb('해당 없음'::text),'consult1_notice',to_jsonb('해당 없음'::text),
      'confirm2_notice',to_jsonb('해당 없음'::text),'feedback_status',to_jsonb('미입력'::text),
      'consult_status',to_jsonb('상담 전'::text),'contact_move',to_jsonb('컨택 대기'::text)
    )) x
    join public.board_columns c on c.org_id=p_org_id and c.board_id=p_board_id and c.key=x.key
   where x.value <> 'null'::jsonb;
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
    values(p_org_id,v_item,'address_detail',to_jsonb(nullif(btrim(coalesce(p_address_detail,'')),'')))
  on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;

  insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
  select p_org_id,v_deal,x.key,null,x.value,
         case
           when x.key='owner' and p_assigned_to is not null then 'manual'
           when x.key=any(array['applied_on','owner','contact_move','consult_status','absence_notice','consult1_notice','confirm2_notice','feedback_status']) then 'system'
           else 'manual'
         end,
         v_actor,p_request_id
    from jsonb_each(jsonb_build_object(
      'title',to_jsonb(btrim(p_title)),'representative_name',to_jsonb(nullif(btrim(coalesce(p_representative_name,'')),'')),
      'phone',to_jsonb(nullif(btrim(coalesce(p_phone,'')),'')),'email',to_jsonb(v_email),
      'business_registration_type',to_jsonb(nullif(btrim(coalesce(p_business_registration_type,'')),'')),
      'industry',to_jsonb(nullif(btrim(coalesce(p_industry,'')),'')),'revenue_band',to_jsonb(nullif(btrim(coalesce(p_revenue_band,'')),'')),
      'region_sido',to_jsonb(nullif(btrim(coalesce(p_region_sido,'')),'')),'region_sigungu',to_jsonb(nullif(btrim(coalesce(p_region_sigungu,'')),'')),
      'address_detail',to_jsonb(nullif(btrim(coalesce(p_address_detail,'')),'')),
      'acquisition_source',to_jsonb(nullif(btrim(coalesce(p_acquisition_source,'')),'')),
      'applied_on',to_jsonb(v_applied_on),'owner',to_jsonb(v_assignee),'collaborators',to_jsonb(v_collaborators),
      'contact_move',to_jsonb('컨택 대기'::text),'consult_status',to_jsonb('상담 전'::text),
      'absence_notice',to_jsonb('해당 없음'::text),'consult1_notice',to_jsonb('해당 없음'::text),
      'confirm2_notice',to_jsonb('해당 없음'::text),'feedback_status',to_jsonb('미입력'::text)
    )) x;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'create',v_deal,v_item,v_actor,v_payload);
  return query select v_deal,v_item,false;
end $$;

revoke all on function public.create_new_lead(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[]
) from public,anon,service_role;
grant execute on function public.create_new_lead(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[]
) to authenticated;

create or replace function public.update_new_lead_intake_meta(
  p_org_id uuid, p_deal_id uuid, p_request_id uuid, p_patch jsonb
) returns table(deal_id uuid,item_id uuid,changed_fields text[],replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid; v_item uuid; v_board uuid;
  v_payload jsonb; v_prior public.new_lead_requests%rowtype;
  v_owner uuid; v_collaborators uuid[]; v_applied date; v_address text;
begin
  if v_actor is null or p_request_id is null or jsonb_typeof(p_patch)<>'object'
     or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('owner','collaborators','applied_on','address_detail')) then
    raise exception 'new lead meta input invalid' using errcode='22023';
  end if;
  select m.role::text,m.scope::text,d.assigned_to,i.id,i.board_id
    into v_role,v_scope,v_assigned,v_item,v_board
    from public.org_members m join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
    join public.items i on i.org_id=d.org_id and i.deal_id=d.id and i.deleted_at is null
    join public.boards b on b.org_id=i.org_id and b.id=i.board_id and b.source='core.default-tab/new-lead'
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active' for update of d,i;
  if not found or not public.effective_permission(p_org_id,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'new lead meta denied' using errcode='42501';
  end if;
  v_owner:=case when p_patch?'owner' and nullif(p_patch->>'owner','') is not null then (p_patch->>'owner')::uuid else v_assigned end;
  if p_patch?'owner' and (v_owner<>v_actor and not (v_role in ('owner','admin') or v_scope='all')
     or not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=v_owner and m.status='active')) then
    raise exception 'new lead owner unavailable' using errcode='42501';
  end if;
  if p_patch?'collaborators' then
    if jsonb_typeof(p_patch->'collaborators')<>'array' then raise exception 'new lead collaborators invalid' using errcode='22023'; end if;
    select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into v_collaborators from jsonb_array_elements_text(p_patch->'collaborators');
    if exists(select 1 from unnest(v_collaborators) x where not exists(select 1 from public.org_members m where m.org_id=p_org_id and m.user_id=x and m.status='active')) then
      raise exception 'new lead collaborator unavailable' using errcode='42501';
    end if;
  end if;
  if p_patch?'applied_on' then v_applied:=nullif(p_patch->>'applied_on','')::date; end if;
  if p_patch?'address_detail' then v_address:=nullif(btrim(coalesce(p_patch->>'address_detail','')),''); end if;
  v_payload:=jsonb_build_object('deal_id',p_deal_id,'meta_patch',p_patch);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation<>'update' or v_prior.payload<>v_payload or v_prior.actor_id<>v_actor then raise exception 'new lead idempotency key reuse' using errcode='22023'; end if;
    return query select p_deal_id,v_item,array(select a.field_key from public.deal_intake_field_audit a where a.org_id=p_org_id and a.request_id=p_request_id order by a.field_key),true; return;
  end if;
  -- Audit explicitly per requested key; null before/after remain distinguishable JSON values.
  insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
  select p_org_id,p_deal_id,x.key,
    case x.key when 'owner' then to_jsonb(v_assigned) when 'applied_on' then to_jsonb(d.applied_on) when 'address_detail' then to_jsonb(di.address_detail)
      else coalesce((select iv.value_jsonb from public.item_values iv where iv.item_id=v_item and iv.column_key='collaborators'),'[]'::jsonb) end,
    case x.key when 'owner' then to_jsonb(v_owner) when 'applied_on' then to_jsonb(v_applied) when 'address_detail' then to_jsonb(v_address) else to_jsonb(v_collaborators) end,
    'manual',v_actor,p_request_id
  from jsonb_each(p_patch) x cross join public.deals d join public.deal_intake di on di.deal_id=d.id and di.org_id=d.org_id
  where d.id=p_deal_id and d.org_id=p_org_id;
  update public.deals set assigned_to=case when p_patch?'owner' then v_owner else assigned_to end,
    applied_on=case when p_patch?'applied_on' then v_applied else applied_on end where org_id=p_org_id and id=p_deal_id;
  update public.items set assigned_to=case when p_patch?'owner' then v_owner else assigned_to end where org_id=p_org_id and id=v_item;
  update public.deal_intake di set address_detail=case when p_patch?'address_detail' then v_address else di.address_detail end where di.org_id=p_org_id and di.deal_id=p_deal_id;
  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select p_org_id,v_item,x.key,case x.key when 'owner' then to_jsonb(v_owner) when 'collaborators' then to_jsonb(v_collaborators)
    when 'applied_on' then to_jsonb(v_applied) else to_jsonb(v_address) end from jsonb_each(p_patch) x
  on conflict on constraint item_values_pkey do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload) values(p_org_id,p_request_id,'update',p_deal_id,v_item,v_actor,v_payload);
  return query select p_deal_id,v_item,array(select a.field_key from public.deal_intake_field_audit a where a.org_id=p_org_id and a.request_id=p_request_id order by a.field_key),false;
end $$;
revoke all on function public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb) to authenticated;

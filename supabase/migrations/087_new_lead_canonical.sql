-- BBE-173: one canonical new-lead record, with board rows as projections only.
-- Additive and intentionally free of customer-row backfills.

create unique index if not exists deals_org_id_id_uq
  on public.deals(org_id, id);
-- Migration 041 already owns boards_org_id_id_uq. Keep its unique index as the
-- referenced key instead of trying to create a same-named constraint relation.
create unique index if not exists boards_org_id_id_uq
  on public.boards(org_id, id);
create unique index if not exists board_groups_org_board_id_uq
  on public.board_groups(org_id, board_id, id);
create unique index if not exists items_org_id_id_uq
  on public.items(org_id, id);
alter table public.items add column if not exists deal_id uuid;

alter table public.board_groups drop constraint if exists board_groups_org_board_fkey;
alter table public.board_groups add constraint board_groups_org_board_fkey
  foreign key (org_id, board_id) references public.boards(org_id, id) on delete cascade;
alter table public.items drop constraint if exists items_org_board_fkey;
alter table public.items add constraint items_org_board_fkey
  foreign key (org_id, board_id) references public.boards(org_id, id) on delete cascade;
alter table public.items drop constraint if exists items_org_board_group_fkey;
alter table public.items add constraint items_org_board_group_fkey
  foreign key (org_id, board_id, group_id)
  references public.board_groups(org_id, board_id, id) on delete set null (group_id);
alter table public.items drop constraint if exists items_org_deal_fkey;
alter table public.items add constraint items_org_deal_fkey
  foreign key (org_id, deal_id) references public.deals(org_id, id) on delete cascade;
alter table public.item_values drop constraint if exists item_values_org_item_fkey;
alter table public.item_values add constraint item_values_org_item_fkey
  foreign key (org_id, item_id) references public.items(org_id, id) on delete cascade;

create unique index if not exists items_active_deal_projection_uq
  on public.items(org_id, deal_id)
  where deal_id is not null and deleted_at is null;

create table if not exists public.deal_intake (
  deal_id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  representative_name text,
  phone_normalized text,
  phone_display text,
  email_normalized text,
  business_registration_type text,
  industry text,
  industry_code text,
  revenue_band text,
  region_sido text,
  region_sigungu text,
  acquisition_source text,
  source_external_id text,
  captured_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, deal_id),
  foreign key (org_id, deal_id) references public.deals(org_id, id) on delete cascade,
  check (phone_normalized is null or phone_normalized ~ '^[0-9]+$'),
  check (email_normalized is null or email_normalized = lower(email_normalized))
);

create unique index if not exists deal_intake_org_phone_uq on public.deal_intake(org_id, phone_normalized)
  where phone_normalized is not null;
create unique index if not exists deal_intake_org_email_uq on public.deal_intake(org_id, email_normalized)
  where email_normalized is not null;
create unique index if not exists deal_intake_org_external_uq
  on public.deal_intake(org_id, acquisition_source, source_external_id)
  where acquisition_source is not null and source_external_id is not null;

create table if not exists public.deal_intake_field_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null,
  field_key text not null,
  old_value jsonb,
  new_value jsonb,
  value_source text not null check (value_source in ('manual','automation','import')),
  actor_id uuid not null references public.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  request_id uuid not null,
  foreign key (org_id, deal_id) references public.deal_intake(org_id, deal_id) on delete cascade,
  unique (org_id, request_id, field_key)
);

create table if not exists public.new_lead_requests (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation in ('create','update')),
  deal_id uuid not null,
  item_id uuid,
  actor_id uuid not null references public.users(id) on delete restrict,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id),
  foreign key (org_id, deal_id) references public.deals(org_id, id) on delete cascade,
  foreign key (org_id, item_id) references public.items(org_id, id) on delete cascade
);

alter table public.deal_intake enable row level security;
alter table public.deal_intake_field_audit enable row level security;
alter table public.new_lead_requests enable row level security;

drop policy if exists deal_intake_select on public.deal_intake;
create policy deal_intake_select on public.deal_intake for select to authenticated using (
  public.is_org_member(org_id) and exists (
    select 1 from public.deals d where d.org_id=deal_intake.org_id and d.id=deal_intake.deal_id
      and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or d.assigned_to=auth.uid())
  )
);
drop policy if exists deal_intake_audit_select on public.deal_intake_field_audit;
create policy deal_intake_audit_select on public.deal_intake_field_audit for select to authenticated using (
  public.is_org_member(org_id) and exists (
    select 1 from public.deals d where d.org_id=deal_intake_field_audit.org_id and d.id=deal_intake_field_audit.deal_id
      and (public.org_role(org_id) in ('owner','admin') or public.org_scope(org_id)='all' or d.assigned_to=auth.uid())
  )
);

revoke all on public.deal_intake, public.deal_intake_field_audit, public.new_lead_requests
  from public, anon, authenticated, service_role;
grant select on public.deal_intake, public.deal_intake_field_audit to authenticated;

create or replace function public.guard_new_lead_projection_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_item uuid:=coalesce(new.item_id,old.item_id); v_key text:=coalesce(new.column_key,old.column_key);
begin
  if v_key in ('rep_name','phone','email','business_registration_type','industry','industry_code','revenue_band','region_sido','region_sigungu','acquisition_source','source_external_id')
     and exists(select 1 from public.items i where i.id=v_item and i.deal_id is not null)
     and current_setting('moawork.new_lead_projection_write',true) is distinct from 'on' then
    raise exception 'canonical new lead fields require update_new_lead_fields' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
drop trigger if exists guard_new_lead_projection_write on public.item_values;
create trigger guard_new_lead_projection_write before insert or update or delete on public.item_values
for each row execute function public.guard_new_lead_projection_write();
revoke all on function public.guard_new_lead_projection_write() from public,anon,authenticated,service_role;

-- Existing workspaces gain the missing structural column only. No item/value row is updated.
insert into public.board_columns(org_id, board_id, key, label, type, sort_order, width, source, is_readonly)
select b.org_id, b.id, 'industry', '업종', 'text'::public.field_type,
       coalesce((select max(c.sort_order)+1 from public.board_columns c where c.board_id=b.id),0),
       140, 'in', false
from public.boards b
where b.source='core.default-tab/new-lead'
  and not exists(select 1 from public.board_columns c where c.board_id=b.id and c.key='industry');

update public.board_columns c
set label='업종', type='text'::public.field_type, is_readonly=false
from public.boards b
where b.id=c.board_id and b.org_id=c.org_id
  and b.source='core.default-tab/new-lead' and c.key='industry'
  and (c.label is distinct from '업종' or c.type is distinct from 'text'::public.field_type or c.is_readonly);

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
  select s.id,s.pipeline_id into v_stage,v_pipeline from public.stages s join public.pipelines p on p.id=s.pipeline_id
   where p.org_id=p_org_id and s.kind::text='marketing' order by p.created_at,s.sort_order limit 1;
  if v_stage is null then raise exception 'marketing stage unavailable' using errcode='22023'; end if;
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

create or replace function public.update_new_lead_fields(
  p_org_id uuid, p_deal_id uuid, p_request_id uuid, p_patch jsonb, p_value_source text default 'manual'
) returns table(deal_id uuid, changed_fields text[], replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid; v_item uuid; v_board uuid;
  v_payload jsonb; v_patch jsonb; v_prior public.new_lead_requests%rowtype;
  v_key text; v_old jsonb; v_new jsonb; v_changed text[]:='{}';
  v_allowed constant text[]:=array['representative_name','phone','email','business_registration_type','industry','industry_code','revenue_band','region_sido','region_sigungu','acquisition_source','source_external_id'];
begin
  if v_actor is null or p_request_id is null or jsonb_typeof(p_patch)<>'object' or p_value_source not in ('manual','automation','import') then
    raise exception 'new lead update input invalid' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_patch) k where not (k=any(v_allowed))) then
    raise exception 'new lead field unsupported' using errcode='22023';
  end if;
  select coalesce(jsonb_object_agg(e.key,
    case
      when e.value='null'::jsonb then 'null'::jsonb
      when e.key='email' then coalesce(to_jsonb(nullif(lower(btrim(e.value#>>'{}')),'')),'null'::jsonb)
      else coalesce(to_jsonb(nullif(btrim(e.value#>>'{}'),'')),'null'::jsonb)
    end
  ),'{}'::jsonb) into v_patch
  from jsonb_each(p_patch) e;
  select m.role::text,m.scope::text,d.assigned_to into v_role,v_scope,v_assigned
    from public.org_members m join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active' for update of d;
  if not found or not public.effective_permission(p_org_id,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'new lead update denied' using errcode='42501';
  end if;
  select i.id,i.board_id into v_item,v_board from public.items i join public.boards b on b.id=i.board_id
    where i.org_id=p_org_id and i.deal_id=p_deal_id and i.deleted_at is null and b.source='core.default-tab/new-lead' for update;
  if not found then raise exception 'new lead projection unavailable' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('deal_id',p_deal_id,'patch',v_patch,'value_source',p_value_source);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation<>'update' or v_prior.payload<>v_payload or v_prior.actor_id<>v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023'; end if;
    return query select p_deal_id,array(select a.field_key from public.deal_intake_field_audit a where a.org_id=p_org_id and a.request_id=p_request_id order by a.field_key),true; return;
  end if;
  for v_key,v_new in select key,value from jsonb_each(v_patch) loop
    if p_value_source='automation' and exists(select 1 from public.deal_intake_field_audit a
       where a.org_id=p_org_id and a.deal_id=p_deal_id and a.field_key=v_key and a.value_source='manual') then
      raise exception 'manual correction conflict: %',v_key using errcode='40001';
    end if;
    select case v_key
      when 'phone' then coalesce(to_jsonb(phone_display),'null'::jsonb)
      when 'email' then coalesce(to_jsonb(email_normalized),'null'::jsonb)
      else to_jsonb(i)->v_key end into v_old from public.deal_intake i where i.org_id=p_org_id and i.deal_id=p_deal_id;
    if v_old is distinct from v_new then
      insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
        values(p_org_id,p_deal_id,v_key,v_old,v_new,p_value_source,v_actor,p_request_id);
      v_changed:=array_append(v_changed,v_key);
    end if;
  end loop;
  update public.deal_intake i set
    representative_name=case when v_patch?'representative_name' then v_patch->>'representative_name' else i.representative_name end,
    phone_normalized=case when v_patch?'phone' then nullif(regexp_replace(v_patch->>'phone','[^0-9]','','g'),'') else i.phone_normalized end,
    phone_display=case when v_patch?'phone' then v_patch->>'phone' else i.phone_display end,
    email_normalized=case when v_patch?'email' then v_patch->>'email' else i.email_normalized end,
    business_registration_type=case when v_patch?'business_registration_type' then v_patch->>'business_registration_type' else i.business_registration_type end,
    industry=case when v_patch?'industry' then v_patch->>'industry' else i.industry end,
    industry_code=case when v_patch?'industry_code' then v_patch->>'industry_code' else i.industry_code end,
    revenue_band=case when v_patch?'revenue_band' then v_patch->>'revenue_band' else i.revenue_band end,
    region_sido=case when v_patch?'region_sido' then v_patch->>'region_sido' else i.region_sido end,
    region_sigungu=case when v_patch?'region_sigungu' then v_patch->>'region_sigungu' else i.region_sigungu end,
    acquisition_source=case when v_patch?'acquisition_source' then v_patch->>'acquisition_source' else i.acquisition_source end,
    source_external_id=case when v_patch?'source_external_id' then v_patch->>'source_external_id' else i.source_external_id end,
    updated_at=now() where i.org_id=p_org_id and i.deal_id=p_deal_id;
  perform set_config('moawork.new_lead_projection_write','on',true);
  insert into public.item_values(org_id,item_id,column_key,value_jsonb)
  select p_org_id,v_item,case x.key when 'representative_name' then 'rep_name' else x.key end,x.value
    from jsonb_each(v_patch) x join public.board_columns c on c.board_id=v_board and c.key=case x.key when 'representative_name' then 'rep_name' else x.key end
  where x.key in ('representative_name','phone','email','industry','region_sido','region_sigungu')
  on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb,org_id=excluded.org_id;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'update',p_deal_id,v_item,v_actor,v_payload);
  return query select p_deal_id,v_changed,false;
end $$;

do $$
begin
  if to_regprocedure('public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)') is not null
     and to_regprocedure('public.execute_contact_pipeline_transition_legacy_069(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)') is null then
    alter function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)
      rename to execute_contact_pipeline_transition_legacy_069;
  end if;
end $$;

create or replace function public.execute_contact_pipeline_transition(
  p_org_id uuid, p_deal_id uuid, p_source_item_id uuid, p_request_id uuid, p_kind text,
  p_company_id uuid default null, p_company_name text default null,
  p_biz_no text default null, p_owner_name text default null,
  p_business_type text default null, p_industry text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_phone text default null, p_founded_on date default null,
  p_revenue numeric default null
) returns table(status text,deal_id uuid,company_id uuid,reason text)
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid();
begin
  if v_actor is null or not exists(
    select 1 from public.org_members m join public.orgs o on o.id=m.org_id
     where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active'
  ) or not public.effective_permission(p_org_id,'work.item_upsert') then
    raise exception 'transition unavailable' using errcode='42501';
  end if;
  return query select * from public.execute_contact_pipeline_transition_legacy_069(
    p_org_id,p_deal_id,p_source_item_id,p_request_id,p_kind,p_company_id,p_company_name,
    p_biz_no,p_owner_name,p_business_type,p_industry,p_region_sido,p_region_sigungu,
    p_phone,p_founded_on,p_revenue
  );
end $$;

create or replace function public.advance_new_lead_to_contact(p_org_id uuid,p_deal_id uuid,p_request_id uuid)
returns table(status text,deal_id uuid,company_id uuid,reason text)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid;
begin
  select m.role::text,m.scope::text,d.assigned_to into v_role,v_scope,v_assigned
    from public.org_members m
    join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if not found or not public.effective_permission(p_org_id,'work.item_upsert')
     or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'new lead advance denied' using errcode='42501';
  end if;
  return query select * from public.execute_contact_pipeline_transition(
    p_org_id,p_deal_id,null,p_request_id,'lead_to_contact',null,null,null,null,null,null,null,null,null,null,null
  );
end
$$;

revoke all on function public.create_new_lead(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid) from public,anon,service_role;
revoke all on function public.update_new_lead_fields(uuid,uuid,uuid,jsonb,text) from public,anon,service_role;
revoke all on function public.advance_new_lead_to_contact(uuid,uuid,uuid) from public,anon,service_role;
revoke all on function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) from public,anon,service_role;
revoke all on function public.execute_contact_pipeline_transition_legacy_069(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) from public,anon,authenticated,service_role;
grant execute on function public.create_new_lead(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid) to authenticated;
grant execute on function public.update_new_lead_fields(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.advance_new_lead_to_contact(uuid,uuid,uuid) to authenticated;
grant execute on function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) to authenticated;

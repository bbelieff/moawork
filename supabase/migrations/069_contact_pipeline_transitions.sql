-- BBE-152: two canonical tab gates and an auditable double lock.
create table if not exists public.contact_pipeline_transitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete cascade,
  source_item_id uuid references public.items(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('lead_to_contact', 'contact_to_work')),
  from_stage_id uuid references public.stages(id),
  to_stage_id uuid references public.stages(id),
  actor_id uuid not null references public.users(id),
  status text not null check (status in ('committed', 'blocked', 'rolled_back')),
  block_reason text,
  rollback_reason text,
  created_at timestamptz not null default now(),
  unique (org_id, request_id),
  check (deal_id is not null or source_item_id is not null)
);

alter table public.contact_pipeline_transitions enable row level security;
create policy contact_pipeline_transitions_select on public.contact_pipeline_transitions
for select to authenticated using (
  exists (
    select 1 from public.org_members m
    left join public.deals d on d.id = contact_pipeline_transitions.deal_id
    left join public.items i on i.id = contact_pipeline_transitions.source_item_id
    where m.org_id = contact_pipeline_transitions.org_id
      and m.user_id = (select auth.uid())
      and (m.role in ('owner', 'admin') or m.scope = 'all' or d.assigned_to = (select auth.uid()) or i.assigned_to = (select auth.uid()))
  )
);
revoke all on public.contact_pipeline_transitions from public, anon;
grant select on public.contact_pipeline_transitions to authenticated;

create or replace function public.execute_contact_pipeline_transition(
  p_org_id uuid, p_deal_id uuid, p_source_item_id uuid, p_request_id uuid, p_kind text,
  p_company_id uuid default null, p_company_name text default null,
  p_biz_no text default null, p_owner_name text default null,
  p_business_type text default null, p_industry text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_phone text default null, p_founded_on date default null,
  p_revenue numeric default null
) returns table(status text, deal_id uuid, company_id uuid, reason text)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_role text; v_scope text; v_assigned uuid; v_pipeline uuid;
  v_from uuid; v_to uuid; v_company uuid; v_existing public.contact_pipeline_transitions%rowtype;
  v_seal text; v_move text; v_expected_from text; v_expected_to text; v_reason text; v_item_title text;
begin
  if v_actor is null or p_kind not in ('lead_to_contact', 'contact_to_work') then
    raise exception 'transition unavailable' using errcode = '42501';
  end if;
  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m where m.org_id=p_org_id and m.user_id=v_actor;
  if not found then raise exception 'transition unavailable' using errcode='42501'; end if;

  if p_deal_id is null and p_source_item_id is not null and p_kind='contact_to_work' then
    select i.assigned_to,i.title,
      (select iv.value_jsonb #>> '{}' from public.item_values iv where iv.item_id=i.id and iv.column_key='seal_status'),
      (select iv.value_jsonb #>> '{}' from public.item_values iv where iv.item_id=i.id and iv.column_key='work_move')
      into v_assigned,v_item_title,v_seal,v_move
      from public.items i join public.boards b on b.id=i.board_id
      where i.id=p_source_item_id and i.org_id=p_org_id and b.source='core.default-tab/contact' for update;
    if not found or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
      raise exception 'transition unavailable' using errcode='42501';
    end if;
    select * into v_existing from public.contact_pipeline_transitions t
      where t.org_id=p_org_id and t.request_id=p_request_id;
    if found and (v_existing.kind<>p_kind or v_existing.source_item_id is distinct from p_source_item_id) then
      raise exception 'transition request target mismatch' using errcode='22023';
    end if;
    if found and v_existing.status='committed' then
      return query select v_existing.status,v_existing.deal_id,
        (select d.company_id from public.deals d where d.id=v_existing.deal_id),null::text;
      return;
    end if;
    if coalesce(v_move,'') <> '업무관리 이동' then v_reason := '업무관리 이동을 먼저 선택해 주세요.';
    elsif coalesce(v_seal,'대기') <> '완료' then v_reason := '대표 직인 승인이 필요합니다. 현재 직인 완료 = ' || coalesce(v_seal,'대기'); end if;
    if v_reason is not null then
      insert into public.contact_pipeline_transitions(org_id,source_item_id,request_id,kind,actor_id,status,block_reason)
      values(p_org_id,p_source_item_id,p_request_id,p_kind,v_actor,'blocked',v_reason)
      on conflict(org_id,request_id) do update set status='blocked',block_reason=excluded.block_reason,actor_id=excluded.actor_id;
      return query select 'blocked'::text,null::uuid,null::uuid,v_reason; return;
    end if;
    select p.id into v_pipeline from public.pipelines p where p.org_id=p_org_id
      and (select count(*) from public.stages s where s.pipeline_id=p.id and s.kind::text='work')=1
      order by p.created_at limit 1;
    if v_pipeline is null then raise exception 'work stage unavailable' using errcode='22023'; end if;
    select s.id into v_to from public.stages s where s.pipeline_id=v_pipeline and s.kind::text='work';
    select h.deal_id,h.company_id into p_deal_id,v_company from public.handoff_company_to_work(
      p_org_id,null,coalesce(nullif(btrim(coalesce(p_company_name,'')),''),v_item_title),p_biz_no,p_owner_name,p_business_type,p_industry,
      p_region_sido,p_region_sigungu,p_phone,p_founded_on,p_revenue,p_company_id,p_request_id
    ) h;
    update public.deals set pipeline_id=v_pipeline,stage_id=v_to,updated_at=now() where id=p_deal_id and org_id=p_org_id;
    insert into public.activities(org_id,deal_id,type,content,actor) values(p_org_id,p_deal_id,'status','업무관리 이동',v_actor);
    insert into public.contact_pipeline_transitions(org_id,deal_id,source_item_id,request_id,kind,to_stage_id,actor_id,status,block_reason)
    values(p_org_id,p_deal_id,p_source_item_id,p_request_id,p_kind,v_to,v_actor,'committed',null)
    on conflict(org_id,request_id) do update set deal_id=excluded.deal_id,to_stage_id=excluded.to_stage_id,
      actor_id=excluded.actor_id,status='committed',block_reason=null;
    return query select 'committed'::text,p_deal_id,v_company,null::text; return;
  end if;

  if p_deal_id is null then raise exception 'transition unavailable' using errcode='22023'; end if;
  select d.assigned_to,d.pipeline_id,d.stage_id,d.company_id,
         coalesce(d.custom->>'seal_approval', d.custom->>'seal_status')
    into v_assigned,v_pipeline,v_from,v_company,v_seal
    from public.deals d where d.id=p_deal_id and d.org_id=p_org_id for update;
  if not found or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'transition unavailable' using errcode='42501';
  end if;
  select * into v_existing from public.contact_pipeline_transitions t
    where t.org_id=p_org_id and t.request_id=p_request_id;
  if found and (v_existing.kind<>p_kind or v_existing.deal_id is distinct from p_deal_id) then
    raise exception 'transition request target mismatch' using errcode='22023';
  end if;
  if found and v_existing.status='committed' then
    return query select v_existing.status,v_existing.deal_id,v_company,null::text; return;
  end if;

  v_expected_from := case p_kind when 'lead_to_contact' then 'marketing' else 'meeting' end;
  v_expected_to := case p_kind when 'lead_to_contact' then 'meeting' else 'work' end;
  if (select count(*) from public.stages s where s.pipeline_id=v_pipeline and s.kind::text=v_expected_from)=1
     and (select count(*) from public.stages s where s.pipeline_id=v_pipeline and s.kind::text=v_expected_to)=1 then
    select s.id into v_to from public.stages s where s.pipeline_id=v_pipeline and s.kind::text=v_expected_to;
  end if;

  if v_to is null or not exists(select 1 from public.stages s where s.id=v_from and s.kind::text=v_expected_from) then
    v_reason := '현재 단계에서는 이 관문을 넘을 수 없습니다.';
  elsif p_kind='contact_to_work' and coalesce(v_seal,'대기') <> '완료' then
    v_reason := '대표 직인 승인이 필요합니다. 현재 직인 완료 = ' || coalesce(v_seal,'대기');
  end if;
  if v_reason is not null then
    insert into public.contact_pipeline_transitions(org_id,deal_id,request_id,kind,from_stage_id,actor_id,status,block_reason)
    values(p_org_id,p_deal_id,p_request_id,p_kind,v_from,v_actor,'blocked',v_reason)
    on conflict(org_id,request_id) do update set status='blocked',block_reason=excluded.block_reason,actor_id=excluded.actor_id;
    return query select 'blocked'::text,p_deal_id,v_company,v_reason; return;
  end if;

  if p_kind='contact_to_work' then
    if nullif(btrim(coalesce(p_company_name,'')),'') is null then
      raise exception 'company name required' using errcode='22023';
    end if;
    select h.company_id into v_company from public.handoff_company_to_work(
      p_org_id,p_deal_id,p_company_name,p_biz_no,p_owner_name,p_business_type,p_industry,
      p_region_sido,p_region_sigungu,p_phone,p_founded_on,p_revenue,p_company_id,p_request_id
    ) h;
  end if;

  update public.deals set stage_id=v_to, updated_at=now() where id=p_deal_id and org_id=p_org_id;
  insert into public.activities(org_id,deal_id,type,content,actor)
  values(p_org_id,p_deal_id,'status',case p_kind when 'lead_to_contact' then '컨택 이동' else '업무관리 이동' end,v_actor);
  insert into public.contact_pipeline_transitions(org_id,deal_id,request_id,kind,from_stage_id,to_stage_id,actor_id,status,block_reason)
  values(p_org_id,p_deal_id,p_request_id,p_kind,v_from,v_to,v_actor,'committed',null)
  on conflict(org_id,request_id) do update set to_stage_id=excluded.to_stage_id,actor_id=excluded.actor_id,
    status='committed',block_reason=null;
  return query select 'committed'::text,p_deal_id,v_company,null::text;
end; $$;

revoke all on function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) from public,anon,service_role;
grant execute on function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) to authenticated;

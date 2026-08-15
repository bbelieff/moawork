-- BBE-31: execute the product-owned contract-work board through a tenant-bound,
-- replay-safe command boundary. Additive only; customer rows are not rewritten.

create table if not exists public.work_item_versions (
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid primary key references public.items(id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  due_date date,
  workflow_status text not null default 'not_started'
    check (workflow_status in ('not_started','in_progress','done','blocked')),
  updated_at timestamptz not null default now()
);
create index if not exists work_item_versions_org_idx on public.work_item_versions(org_id);

create table if not exists public.work_item_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 10000),
  actor uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists work_item_updates_item_idx on public.work_item_updates(org_id,item_id,created_at);

create table if not exists public.work_command_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor uuid not null references public.users(id),
  board_id uuid not null references public.boards(id) on delete cascade,
  operation text not null,
  result_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id,request_id)
);

create table if not exists public.work_command_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  board_id uuid not null references public.boards(id) on delete cascade,
  item_id uuid references public.items(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  actor uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique(org_id,request_id)
);

alter table public.work_item_versions enable row level security;
alter table public.work_item_updates enable row level security;
alter table public.work_command_receipts enable row level security;
alter table public.work_command_outbox enable row level security;

create policy work_item_versions_read on public.work_item_versions for select
  to authenticated using (public.is_org_member(org_id));
create policy work_item_updates_read on public.work_item_updates for select
  to authenticated using (public.is_org_member(org_id));
create policy work_receipts_read on public.work_command_receipts for select
  to authenticated using (actor=(select auth.uid()) and public.is_org_member(org_id));
create policy work_outbox_read on public.work_command_outbox for select
  to authenticated using (public.org_role(org_id) in ('owner','admin'));

create or replace function public.execute_work_management_command(
  p_org_id uuid, p_board_id uuid, p_item_id uuid, p_operation text,
  p_expected_version integer, p_request_id uuid, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_actor uuid := auth.uid(); v_role public.member_role; v_scope public.member_scope;
  v_result jsonb; v_version integer := 0; v_group uuid; v_column uuid; v_item uuid;
  v_position integer; v_key text; v_value jsonb;
begin
  if p_expected_version is null then
    raise exception 'expected work item version is required' using errcode='22004';
  end if;
  if v_actor is null or p_org_id is null or p_board_id is null or p_request_id is null
     or not public.is_org_member(p_org_id) then raise exception 'active workspace membership required' using errcode='42501'; end if;
  if not exists(select 1 from public.boards where id=p_board_id and org_id=p_org_id and source='core.default-tab/contract-work')
    then raise exception 'contract work board not found' using errcode='P0002'; end if;
  select role,scope into strict v_role,v_scope from public.org_members
    where org_id=p_org_id and user_id=v_actor and status='active';
  select result_jsonb into v_result from public.work_command_receipts where org_id=p_org_id and request_id=p_request_id;
  if found then return v_result || jsonb_build_object('replayed',true); end if;

  if p_item_id is not null then
    if not exists(select 1 from public.items where id=p_item_id and org_id=p_org_id and board_id=p_board_id
      and (v_role in ('owner','admin') or v_scope='all' or assigned_to=v_actor))
      then raise exception 'work item permission denied' using errcode='42501'; end if;
    insert into public.work_item_versions(org_id,item_id) values(p_org_id,p_item_id) on conflict(item_id) do nothing;
    select version into v_version from public.work_item_versions where item_id=p_item_id for update;
    if v_version<>p_expected_version then raise exception 'stale work item version' using errcode='40001'; end if;
  elsif v_role not in ('owner','admin') then raise exception 'work structure permission denied' using errcode='42501'; end if;

  if v_role not in ('owner','admin') and p_operation='delete_item' then
    raise exception 'work item deletion permission denied' using errcode='42501';
  end if;
  if v_role not in ('owner','admin') and p_operation='set_field'
     and not ((p_payload->>'field') = any(array['title','workflow_status','due_date','group_id','institution','product','visit_application_date','review_period','inspection_date','guidance','reapply_date','d180','d365','link','update_entry'])) then
    raise exception 'work field permission denied' using errcode='42501';
  end if;

  case p_operation
    when 'set_field' then
      v_key:=p_payload->>'field'; v_value:=p_payload->'value';
      if v_key='title' then update public.items set title=trim(both '"' from v_value::text),updated_at=now() where id=p_item_id;
      elsif v_key='assigned_to' then
        if v_role not in ('owner','admin') then raise exception 'assignment permission denied' using errcode='42501'; end if;
        if nullif(trim(both '"' from v_value::text),'') is not null and not exists(select 1 from public.org_members where org_id=p_org_id and user_id=nullif(trim(both '"' from v_value::text),'')::uuid and status='active') then raise exception 'assignee is not an active member' using errcode='42501'; end if;
        update public.items set assigned_to=nullif(trim(both '"' from v_value::text),'')::uuid,updated_at=now() where id=p_item_id;
      elsif v_key='workflow_status' then update public.work_item_versions set workflow_status=trim(both '"' from v_value::text) where item_id=p_item_id;
      else
        if not exists(select 1 from public.board_columns where org_id=p_org_id and board_id=p_board_id and key=v_key and not is_readonly) then raise exception 'mutable work column not found' using errcode='42501'; end if;
        insert into public.item_values(org_id,item_id,column_key,value_jsonb) values(p_org_id,p_item_id,v_key,v_value)
        on conflict(item_id,column_key) do update set value_jsonb=excluded.value_jsonb; end if;
    when 'set_due_date' then update public.work_item_versions set due_date=nullif(p_payload->>'due_date','')::date where item_id=p_item_id;
    when 'append_update' then insert into public.work_item_updates(org_id,item_id,body,actor) values(p_org_id,p_item_id,p_payload->>'body',v_actor);
    when 'move_item' then
      if not exists(select 1 from public.board_groups where id=(p_payload->>'group_id')::uuid and org_id=p_org_id and board_id=p_board_id) then raise exception 'target group not found' using errcode='P0002'; end if;
      update public.items set group_id=(p_payload->>'group_id')::uuid,sort_order=coalesce((p_payload->>'position')::int,sort_order),updated_at=now() where id=p_item_id;
    when 'delete_item' then delete from public.items where id=p_item_id;
    when 'create_item' then
      if p_payload ? 'group_id' and not exists(select 1 from public.board_groups where id=(p_payload->>'group_id')::uuid and org_id=p_org_id and board_id=p_board_id) then raise exception 'target group not found' using errcode='P0002'; end if;
      insert into public.items(org_id,board_id,group_id,title,assigned_to,sort_order)
      values(p_org_id,p_board_id,nullif(p_payload->>'group_id','')::uuid,p_payload->>'name',v_actor,
        (select coalesce(max(sort_order),-1)+1 from public.items where board_id=p_board_id)) returning id into v_item;
      insert into public.work_item_versions(org_id,item_id) values(p_org_id,v_item);
    when 'create_group' then insert into public.board_groups(org_id,board_id,name,color,sort_order)
      values(p_org_id,p_board_id,p_payload->>'name','#579bfc',(select coalesce(max(sort_order),-1)+1 from public.board_groups where board_id=p_board_id));
    when 'rename_group' then update public.board_groups set name=p_payload->>'name' where id=(p_payload->>'group_id')::uuid and board_id=p_board_id and org_id=p_org_id;
    when 'delete_group' then delete from public.board_groups where id=(p_payload->>'group_id')::uuid and board_id=p_board_id and org_id=p_org_id;
    when 'reorder_group' then update public.board_groups set sort_order=(p_payload->>'position')::int where id=(p_payload->>'group_id')::uuid and board_id=p_board_id and org_id=p_org_id;
    when 'create_column' then
      v_key:='custom_'||substr(replace(gen_random_uuid()::text,'-',''),1,12);
      insert into public.board_columns(org_id,board_id,key,label,type,source,sort_order)
      values(p_org_id,p_board_id,v_key,p_payload->>'name',case p_payload->>'kind' when 'amount' then 'money'::public.field_type when 'percent' then 'number'::public.field_type when 'year' then 'number'::public.field_type when 'system_date' then 'date'::public.field_type when 'date_range' then 'text'::public.field_type when 'virtual' then 'text'::public.field_type when 'title' then 'text'::public.field_type else (p_payload->>'kind')::public.field_type end,'in',(select coalesce(max(sort_order),-1)+1 from public.board_columns where board_id=p_board_id));
    when 'rename_column' then update public.board_columns set label=p_payload->>'name' where board_id=p_board_id and org_id=p_org_id and key=p_payload->>'column_key';
    when 'delete_column' then delete from public.board_columns where board_id=p_board_id and org_id=p_org_id and key=p_payload->>'column_key';
    when 'reorder_column' then update public.board_columns set sort_order=(p_payload->>'position')::int where board_id=p_board_id and org_id=p_org_id and key=p_payload->>'column_key';
    when 'save_personal_view' then insert into public.board_views(org_id,board_id,user_id,name,kind,filters_jsonb,shared)
      values(p_org_id,p_board_id,v_actor,p_payload->>'name',p_payload->>'kind',coalesce(p_payload->'predicate','{}'),false);
    else raise exception 'unsupported work operation';
  end case;

  if p_item_id is not null and p_operation<>'delete_item' then update public.work_item_versions set version=version+1,updated_at=now() where item_id=p_item_id returning version into v_version; end if;
  v_result:=jsonb_build_object('accepted',true,'replayed',false,'version',v_version);
  insert into public.work_command_receipts(org_id,request_id,actor,board_id,operation,result_jsonb) values(p_org_id,p_request_id,v_actor,p_board_id,p_operation,v_result);
  insert into public.work_command_outbox(org_id,request_id,board_id,item_id,event_type,payload,actor) values(p_org_id,p_request_id,p_board_id,case when p_operation='delete_item' then null else coalesce(p_item_id,v_item) end,'work.'||p_operation,p_payload,v_actor);
  insert into public.audit_logs(org_id,actor,action,target_type,target_id,meta) values(p_org_id,v_actor,'work.'||p_operation,'board',p_board_id,jsonb_build_object('request_id',p_request_id));
  return v_result;
end; $$;

revoke all on function public.execute_work_management_command(uuid,uuid,uuid,text,integer,uuid,jsonb) from public,anon;
grant execute on function public.execute_work_management_command(uuid,uuid,uuid,text,integer,uuid,jsonb) to authenticated;

-- The read contract consumes the product board; all linked values remain in 003.
create or replace function public.read_work_management_board(p_org_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_board public.boards; v_role text; v_members jsonb; v_groups jsonb; v_columns jsonb; v_items jsonb; v_views jsonb;
begin
  if auth.uid() is null or not public.is_org_member(p_org_id) then raise exception 'active workspace membership required' using errcode='42501'; end if;
  select * into strict v_board from public.boards where org_id=p_org_id and source='core.default-tab/contract-work';
  select case when role in ('owner','admin') then 'manager' when scope='all' then 'viewer' else 'assignee' end into strict v_role from public.org_members where org_id=p_org_id and user_id=auth.uid() and status='active';
  select coalesce(jsonb_agg(jsonb_build_object('membershipId',m.org_id||':'||m.user_id,'orgId',m.org_id,'userId',m.user_id,'displayName',coalesce(nullif(u.name,''),'구성원'),'active',true) order by m.created_at),'[]') into v_members from public.org_members m join public.users u on u.id=m.user_id where m.org_id=p_org_id and m.status='active';
  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'color',coalesce(g.color,'#579bfc'),'count',(select count(*) from public.items i where i.group_id=g.id)) order by g.sort_order),'[]') into v_groups from public.board_groups g where g.board_id=v_board.id and g.org_id=p_org_id;
  select coalesce(jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'kind',case c.type::text when 'money' then 'amount' when 'number' then 'amount' when 'status' then 'select' when 'datetime' then 'date' when 'checkbox' then 'select' when 'people' then 'person' when 'calc' then 'text' else c.type::text end,'legacyOrder',c.sort_order+1,'readOnly',c.is_readonly,'system',false) order by c.sort_order),'[]') into v_columns from public.board_columns c where c.board_id=v_board.id and c.org_id=p_org_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'boardId',i.board_id,'groupId',i.group_id,'title',i.title,'assignedTo',i.assigned_to,'workflowStatus',coalesce(w.workflow_status,'not_started'),'dueDate',w.due_date,'version',coalesce(w.version,0),'templateVersion',1,'companyRef',null,'contactRef',null,'companyDisplay',null,'contactDisplay',null,'provenance',null,'values',coalesce((select jsonb_object_agg(iv.column_key,iv.value_jsonb) from public.item_values iv where iv.item_id=i.id),'{}'::jsonb),'updates',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'body',x.body,'createdAt',x.created_at) order by x.created_at) from public.work_item_updates x where x.item_id=i.id),'[]'::jsonb),'activities','[]'::jsonb) order by i.sort_order),'[]'::jsonb) into v_items from public.items i left join public.work_item_versions w on w.item_id=i.id where i.board_id=v_board.id and i.org_id=p_org_id and (v_role<>'assignee' or i.assigned_to=auth.uid());
  select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'kind',v.kind,'shared',v.shared,'isDefault',false,'version',1,'predicate',v.filters_jsonb)),'[]') into v_views from public.board_views v where v.board_id=v_board.id and v.org_id=p_org_id and (v.shared or v.user_id=auth.uid());
  return jsonb_build_object('board',jsonb_build_object('id',v_board.id,'orgId',p_org_id,'title',v_board.name,'icon',coalesce(v_board.icon,'work'),'templateKey','work-management','templateVersion',1,'baselineFingerprint','contract-work','currentFingerprint','contract-work'),'groups',v_groups,'columns',v_columns,'items',v_items,'members',v_members,'views',v_views||jsonb_build_array(jsonb_build_object('id','calendar','name','캘린더','kind','calendar','shared',true,'isDefault',false,'version',1,'predicate','{}'::jsonb),jsonb_build_object('id','gantt','name','간트','kind','gantt','shared',true,'isDefault',false,'version',1,'predicate','{}'::jsonb)),'virtualBindings','[]'::jsonb,'role',v_role,'filesEnabled',false);
end; $$;

revoke all on function public.read_work_management_board(uuid) from public,anon;
grant execute on function public.read_work_management_board(uuid) to authenticated;

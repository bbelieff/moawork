-- moa-migration-guard: logical_key=115_bbe176_column_date_schedule predecessor=114_bbe226_effective_permission_batch digest=e1f34178ea4f0a12e32586cd7b6703dd757217917278e15cd2abce1f310cd207 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '115_bbe176_column_date_schedule',
  p_file_name => '115_bbe176_column_date_schedule.sql',
  p_file_digest => 'e1f34178ea4f0a12e32586cd7b6703dd757217917278e15cd2abce1f310cd207',
  p_expected_predecessor => '114_bbe226_effective_permission_batch',
  p_executor => 'DG-05',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

alter table public.board_columns
  add column if not exists date_settings_jsonb jsonb not null default '{}'::jsonb;

create or replace function public.board_column_date_settings_is_valid(p_settings jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_settings)<>'object' or exists(
    select 1 from jsonb_object_keys(p_settings) k
    where k not in ('includeTime','displayFormat','notificationOffsetMinutes','deadline','reminderOffsetsMinutes')
  ) then return false; end if;
  if p_settings?'includeTime' and jsonb_typeof(p_settings->'includeTime')<>'boolean' then return false; end if;
  if p_settings?'displayFormat' and (jsonb_typeof(p_settings->'displayFormat')<>'string' or p_settings->>'displayFormat' not in ('yyyy-MM-dd','yyyy.MM.dd','MM/dd/yyyy')) then return false; end if;
  if p_settings?'notificationOffsetMinutes' and (jsonb_typeof(p_settings->'notificationOffsetMinutes')<>'number' or (p_settings->>'notificationOffsetMinutes')::numeric not between 0 and 525600) then return false; end if;
  if p_settings?'deadline' and jsonb_typeof(p_settings->'deadline')<>'boolean' then return false; end if;
  if p_settings?'reminderOffsetsMinutes' and (
    jsonb_typeof(p_settings->'reminderOffsetsMinutes')<>'array'
    or jsonb_array_length(p_settings->'reminderOffsetsMinutes')>10
    or exists(select 1 from jsonb_array_elements(p_settings->'reminderOffsetsMinutes') v where jsonb_typeof(v)<>'number' or (v#>>'{}')::numeric not between 0 and 525600)
  ) then return false; end if;
  return true;
end $$;

alter table public.board_columns drop constraint if exists board_columns_date_settings_valid;
alter table public.board_columns add constraint board_columns_date_settings_valid
  check (public.board_column_date_settings_is_valid(date_settings_jsonb));

create table if not exists public.board_column_date_schedules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.board_columns(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  target_user_id uuid not null references public.users(id),
  kind text not null check (kind in ('notification','deadline','reminder')),
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','claimed','fired','cancelled')),
  payload_jsonb jsonb not null default '{}'::jsonb check (jsonb_typeof(payload_jsonb)='object'),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id)
);

create unique index board_column_date_schedule_single_kind_idx
  on public.board_column_date_schedules(org_id,column_id,item_id,target_user_id,kind)
  where kind in ('notification','deadline');
create unique index board_column_date_schedule_reminder_time_idx
  on public.board_column_date_schedules(org_id,column_id,item_id,target_user_id,kind,scheduled_for)
  where kind='reminder';

create table if not exists public.board_column_date_schedule_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id),
  payload_hash text not null,
  result_jsonb jsonb not null,
  created_at timestamptz not null default now(),
  primary key(org_id,request_id)
);

create table if not exists public.board_column_date_schedule_audit (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  schedule_id uuid not null references public.board_column_date_schedules(id) on delete cascade,
  actor_id uuid not null references public.users(id),
  operation text not null check(operation in ('set','cancel')),
  before_jsonb jsonb,
  after_jsonb jsonb,
  request_id uuid not null,
  changed_at timestamptz not null default now(),
  unique(org_id,request_id)
);

alter table public.board_column_date_schedules enable row level security;
alter table public.board_column_date_schedule_receipts enable row level security;
alter table public.board_column_date_schedule_audit enable row level security;

create policy board_column_date_schedule_member_read on public.board_column_date_schedules
  for select to authenticated using (public.is_org_member(org_id));
create policy board_column_date_schedule_receipt_actor_read on public.board_column_date_schedule_receipts
  for select to authenticated using (actor_id=auth.uid() and public.is_org_member(org_id));
create policy board_column_date_schedule_manager_audit_read on public.board_column_date_schedule_audit
  for select to authenticated using (public.org_role(org_id) in ('owner','admin'));

create or replace function public.set_board_column_date_schedule(
  p_org_id uuid,p_board_id uuid,p_column_id uuid,p_item_id uuid,p_target_user_id uuid,
  p_kind text,p_scheduled_for timestamptz,p_request_id uuid,p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_role text; v_hash text; v_prior public.board_column_date_schedule_receipts; v_row public.board_column_date_schedules; v_before jsonb; v_result jsonb;
begin
  if v_actor is null or p_request_id is null or p_kind not in ('notification','deadline','reminder') or p_scheduled_for<=clock_timestamp() or jsonb_typeof(coalesce(p_payload,'{}'))<>'object' then raise exception 'invalid date schedule' using errcode='22023'; end if;
  select m.role::text into v_role from public.org_members m join public.orgs o on o.id=m.org_id where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null or v_role not in ('owner','admin') then raise exception 'column schedule permission denied' using errcode='42501'; end if;
  if not exists(select 1 from public.board_columns c join public.items i on i.org_id=c.org_id and i.board_id=c.board_id where c.id=p_column_id and c.org_id=p_org_id and c.board_id=p_board_id and c.type in ('date','datetime') and c.archived_at is null and i.id=p_item_id) then raise exception 'date column item not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.org_members where org_id=p_org_id and user_id=p_target_user_id and status='active') then raise exception 'target member not found' using errcode='P0002'; end if;
  v_hash:=encode(digest(concat_ws(':','set',p_board_id,p_column_id,p_item_id,p_target_user_id,p_kind,p_scheduled_for,coalesce(p_payload,'{}')::text),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_column_id::text||':'||p_item_id::text,0));
  select * into v_prior from public.board_column_date_schedule_receipts where org_id=p_org_id and request_id=p_request_id;
  if found then if v_prior.actor_id<>v_actor or v_prior.payload_hash<>v_hash then raise exception 'request_id payload mismatch' using errcode='22023'; end if; return v_prior.result_jsonb||jsonb_build_object('replayed',true); end if;
  select to_jsonb(s) into v_before from public.board_column_date_schedules s
    where org_id=p_org_id and column_id=p_column_id and item_id=p_item_id and target_user_id=p_target_user_id and kind=p_kind
      and (p_kind<>'reminder' or scheduled_for=p_scheduled_for);
  if p_kind='reminder' then
    insert into public.board_column_date_schedules(org_id,board_id,column_id,item_id,target_user_id,kind,scheduled_for,status,payload_jsonb,created_by)
    values(p_org_id,p_board_id,p_column_id,p_item_id,p_target_user_id,p_kind,p_scheduled_for,'scheduled',coalesce(p_payload,'{}'),v_actor)
    on conflict(org_id,column_id,item_id,target_user_id,kind,scheduled_for) where kind='reminder'
    do update set board_id=excluded.board_id,status='scheduled',payload_jsonb=excluded.payload_jsonb,updated_at=now(),cancelled_at=null,cancelled_by=null
    returning * into v_row;
  else
    insert into public.board_column_date_schedules(org_id,board_id,column_id,item_id,target_user_id,kind,scheduled_for,status,payload_jsonb,created_by)
    values(p_org_id,p_board_id,p_column_id,p_item_id,p_target_user_id,p_kind,p_scheduled_for,'scheduled',coalesce(p_payload,'{}'),v_actor)
    on conflict(org_id,column_id,item_id,target_user_id,kind) where kind in ('notification','deadline')
    do update set board_id=excluded.board_id,scheduled_for=excluded.scheduled_for,status='scheduled',payload_jsonb=excluded.payload_jsonb,updated_at=now(),cancelled_at=null,cancelled_by=null
    returning * into v_row;
  end if;
  v_result:=jsonb_build_object('accepted',true,'replayed',false,'scheduleId',v_row.id,'status',v_row.status,'scheduledFor',v_row.scheduled_for);
  insert into public.board_column_date_schedule_receipts values(p_org_id,p_request_id,v_actor,v_hash,v_result,now());
  insert into public.board_column_date_schedule_audit(org_id,schedule_id,actor_id,operation,before_jsonb,after_jsonb,request_id) values(p_org_id,v_row.id,v_actor,'set',v_before,to_jsonb(v_row),p_request_id);
  return v_result;
end $$;

create or replace function public.cancel_board_column_date_schedule(p_org_id uuid,p_schedule_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_role text; v_hash text; v_prior public.board_column_date_schedule_receipts; v_row public.board_column_date_schedules; v_before jsonb; v_result jsonb;
begin
  if v_actor is null or p_request_id is null then raise exception 'invalid date schedule cancellation' using errcode='22023'; end if;
  select m.role::text into v_role from public.org_members m join public.orgs o on o.id=m.org_id where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active';
  if v_role is null or v_role not in ('owner','admin') then raise exception 'column schedule permission denied' using errcode='42501'; end if;
  v_hash:=encode(digest('cancel:'||p_schedule_id::text,'sha256'),'hex');
  select * into v_prior from public.board_column_date_schedule_receipts where org_id=p_org_id and request_id=p_request_id;
  if found then if v_prior.actor_id<>v_actor or v_prior.payload_hash<>v_hash then raise exception 'request_id payload mismatch' using errcode='22023'; end if; return v_prior.result_jsonb||jsonb_build_object('replayed',true); end if;
  select * into strict v_row from public.board_column_date_schedules where id=p_schedule_id and org_id=p_org_id for update; v_before:=to_jsonb(v_row);
  if v_row.status in ('claimed','fired') then raise exception 'date schedule already dispatched' using errcode='40001'; end if;
  update public.board_column_date_schedules set status='cancelled',cancelled_at=coalesce(cancelled_at,now()),cancelled_by=coalesce(cancelled_by,v_actor),updated_at=now() where id=p_schedule_id returning * into v_row;
  v_result:=jsonb_build_object('accepted',true,'replayed',false,'scheduleId',v_row.id,'status',v_row.status);
  insert into public.board_column_date_schedule_receipts values(p_org_id,p_request_id,v_actor,v_hash,v_result,now());
  insert into public.board_column_date_schedule_audit(org_id,schedule_id,actor_id,operation,before_jsonb,after_jsonb,request_id) values(p_org_id,v_row.id,v_actor,'cancel',v_before,to_jsonb(v_row),p_request_id);
  return v_result;
end $$;

revoke all on public.board_column_date_schedules,public.board_column_date_schedule_receipts,public.board_column_date_schedule_audit from public,anon,authenticated,service_role;
grant select on public.board_column_date_schedules,public.board_column_date_schedule_receipts,public.board_column_date_schedule_audit to authenticated;
revoke all on function public.board_column_date_settings_is_valid(jsonb),public.set_board_column_date_schedule(uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid,jsonb),public.cancel_board_column_date_schedule(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_board_column_date_schedule(uuid,uuid,uuid,uuid,uuid,text,timestamptz,uuid,jsonb),public.cancel_board_column_date_schedule(uuid,uuid,uuid) to authenticated;

-- BBE-177 audit successor: duplicate is structure-only unless value copying is
-- explicitly confirmed. Keep six-argument callers compatible via DEFAULT false,
-- but remove the old callable signature so its implicit value copy cannot bypass
-- this boundary.
alter function public.execute_board_column_command(uuid,uuid,uuid,text,uuid,jsonb)
  rename to execute_board_column_command_legacy_bbe176;
revoke all on function public.execute_board_column_command_legacy_bbe176(uuid,uuid,uuid,text,uuid,jsonb)
  from public,anon,authenticated,service_role;

create function public.execute_board_column_command(
  p_org_id uuid,p_board_id uuid,p_column_id uuid,p_operation text,p_request_id uuid,
  p_payload jsonb default '{}'::jsonb,p_copy_values boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_result jsonb; v_new_key text; v_role text; v_column jsonb; v_replayed boolean;
  v_prior public.board_column_command_receipts; v_successor_hash text; v_legacy_hash text;
begin
  if p_copy_values is null then raise exception 'copy_values must be explicit boolean' using errcode='22023'; end if;
  if coalesce(p_payload,'{}'::jsonb)?'copyValues' then raise exception 'copyValues must use the explicit argument' using errcode='22023'; end if;
  if p_operation<>'duplicate' and p_copy_values then raise exception 'copy_values is only valid for duplicate' using errcode='22023'; end if;
  select m.role::text into v_role from public.org_members m join public.orgs o on o.id=m.org_id where m.org_id=p_org_id and m.user_id=auth.uid() and m.status='active' and o.status='active';
  if v_role is null or v_role not in ('owner','admin') then raise exception 'column structure permission denied' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_board_id::text,0));
  select * into v_prior from public.board_column_command_receipts where org_id=p_org_id and request_id=p_request_id;
  if found and v_prior.actor_id<>auth.uid() then raise exception 'request_id payload mismatch' using errcode='22023'; end if;
  if p_operation='duplicate' then
    v_successor_hash:=encode(digest(p_operation||':'||coalesce(p_column_id::text,'')||':'||coalesce(p_payload,'{}')::text||':copy_values='||p_copy_values::text,'sha256'),'hex');
    v_legacy_hash:=encode(digest(p_operation||':'||coalesce(p_column_id::text,'')||':'||coalesce(p_payload,'{}')::text,'sha256'),'hex');
    if found then
      if v_prior.result_jsonb?'copiedValues' then
        if v_prior.payload_hash<>v_successor_hash then raise exception 'request_id payload mismatch' using errcode='22023'; end if;
        return v_prior.result_jsonb||jsonb_build_object('replayed',true);
      elsif v_prior.payload_hash=v_legacy_hash and p_copy_values then
        return v_prior.result_jsonb||jsonb_build_object('replayed',true,'copiedValues',true);
      else raise exception 'request_id payload mismatch' using errcode='22023';
      end if;
    end if;
  end if;
  v_result:=public.execute_board_column_command_legacy_bbe176(
    p_org_id,p_board_id,p_column_id,p_operation,p_request_id,
    coalesce(p_payload,'{}'::jsonb)||case when p_operation='duplicate' and p_copy_values then jsonb_build_object('copyValues',true) else '{}'::jsonb end
  );
  v_replayed:=coalesce((v_result->>'replayed')::boolean,false);
  if p_operation='settings' and p_payload?'dateSettings' and not v_replayed then
    if not public.board_column_date_settings_is_valid(p_payload->'dateSettings') then raise exception 'invalid date settings' using errcode='22023'; end if;
    update public.board_columns set date_settings_jsonb=p_payload->'dateSettings'
      where id=p_column_id and org_id=p_org_id and board_id=p_board_id and type in ('date','datetime')
      returning to_jsonb(board_columns.*) into v_column;
    if v_column is null then raise exception 'date column required' using errcode='22023'; end if;
    v_result:=jsonb_set(v_result,'{column}',v_column,true);
    update public.board_column_command_receipts set result_jsonb=v_result where org_id=p_org_id and request_id=p_request_id;
    update public.board_column_audit set after_jsonb=v_column where org_id=p_org_id and request_id=p_request_id;
  end if;
  if p_operation='duplicate' and not p_copy_values and not v_replayed then
    v_new_key:=v_result->'column'->>'key';
    delete from public.item_values v where v.org_id=p_org_id and v.column_key=v_new_key
      and v.item_id in(select i.id from public.items i where i.org_id=p_org_id and i.board_id=p_board_id);
  end if;
  if p_operation='duplicate' then
    if not v_replayed then
      update public.board_columns destination set date_settings_jsonb=source.date_settings_jsonb
        from public.board_columns source
        where source.id=p_column_id and source.org_id=p_org_id and source.board_id=p_board_id
          and destination.id=(v_result->>'columnId')::uuid and destination.org_id=p_org_id and destination.board_id=p_board_id
        returning to_jsonb(destination.*) into v_column;
      v_result:=jsonb_set(v_result,'{column}',v_column,true);
    end if;
    -- A receipt without copiedValues predates this successor and therefore used
    -- the legacy value-copy behavior. Preserve it instead of deleting data.
    v_result:=v_result||jsonb_build_object('copiedValues',case
      when v_replayed and v_result?'copiedValues' then (v_result->>'copiedValues')::boolean
      when v_replayed then true
      else p_copy_values end);
    if not v_replayed then
      update public.board_column_command_receipts set result_jsonb=v_result,payload_hash=v_successor_hash where org_id=p_org_id and request_id=p_request_id;
      update public.board_column_audit set after_jsonb=v_column where org_id=p_org_id and request_id=p_request_id;
    end if;
  end if;
  return v_result;
end $$;

revoke all on function public.execute_board_column_command(uuid,uuid,uuid,text,uuid,jsonb,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.execute_board_column_command(uuid,uuid,uuid,text,uuid,jsonb,boolean)
  to authenticated;

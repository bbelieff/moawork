-- Functional MVP workspace operations foundation.  Source only: not hosted-applied by this migration.
-- Every mutation is owner-only, uses an explicit UUID identity, and is auditable/replay-safe.

create table if not exists public.workspace_builder_configs (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  configuration jsonb not null default '{"tabs":[]}'::jsonb,
  version integer not null default 1 check (version > 0),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (jsonb_typeof(configuration) = 'object' and jsonb_typeof(configuration->'tabs') = 'array')
);

alter table public.boards add constraint boards_id_org_unique unique (id, org_id);

create table if not exists public.workspace_csv_batches (
  id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null,
  request_id uuid not null,
  payload jsonb not null,
  applied_item_ids jsonb not null default '[]'::jsonb,
  status text not null check (status in ('dry_run','applied','rolled_back','quarantined')),
  row_count integer not null check (row_count >= 0),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  applied_at timestamptz,
  rolled_back_at timestamptz,
  unique (org_id, request_id),
  check (jsonb_typeof(payload) = 'array' and jsonb_typeof(applied_item_ids) = 'array'),
  foreign key (board_id, org_id) references public.boards(id, org_id) on delete cascade
);

create table if not exists public.workspace_automation_configs (
  id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null,
  request_id uuid not null,
  draft jsonb not null,
  state text not null check (state in ('draft','active','quarantined')),
  created_by uuid not null references public.users(id),
  updated_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  unique (org_id, request_id),
  check (jsonb_typeof(draft) = 'object'),
  foreign key (board_id, org_id) references public.boards(id, org_id) on delete cascade
);

create table if not exists public.workspace_ops_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid references public.users(id),
  operation text not null,
  entity_type text not null,
  entity_id uuid,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

alter table public.workspace_builder_configs enable row level security;
alter table public.workspace_csv_batches enable row level security;
alter table public.workspace_automation_configs enable row level security;
alter table public.workspace_ops_audit enable row level security;
revoke all on public.workspace_builder_configs, public.workspace_csv_batches, public.workspace_automation_configs, public.workspace_ops_audit from public, anon, authenticated;

create or replace function public.workspace_ops_require_owner(p_org_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or p_org_id is null or not public.is_protected_workspace_owner(p_org_id) then
    raise exception 'protected workspace owner required' using errcode = '42501';
  end if;
  return v_actor;
end; $$;

create or replace function public.save_workspace_builder_config(p_org_id uuid, p_configuration jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.workspace_ops_require_owner(p_org_id); v_existing public.workspace_builder_configs%rowtype;
begin
  if p_request_id is null or jsonb_typeof(p_configuration) <> 'object' or jsonb_typeof(p_configuration->'tabs') <> 'array' then raise exception 'invalid builder configuration' using errcode='22023'; end if;
  select * into v_existing from public.workspace_builder_configs where org_id=p_org_id for update;
  insert into public.workspace_builder_configs(org_id,configuration,updated_by) values(p_org_id,p_configuration,v_actor)
  on conflict(org_id) do update set configuration=excluded.configuration, version=workspace_builder_configs.version+1, updated_by=excluded.updated_by, updated_at=clock_timestamp();
  insert into public.workspace_ops_audit(org_id,actor_user_id,operation,entity_type,entity_id,request_id,metadata) values(p_org_id,v_actor,'builder_saved','builder_config',p_org_id,p_request_id,jsonb_build_object('tabs',jsonb_array_length(p_configuration->'tabs')));
  return jsonb_build_object('accepted',true);
end; $$;

create or replace function public.create_workspace_csv_dry_run(p_batch_id uuid, p_org_id uuid, p_board_id uuid, p_rows jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.workspace_ops_require_owner(p_org_id); v_rows integer; v_existing public.workspace_csv_batches%rowtype;
begin
  if p_batch_id is null or p_board_id is null or p_request_id is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'invalid batch' using errcode='22023'; end if;
  v_rows:=jsonb_array_length(p_rows);
  select * into v_existing from public.workspace_csv_batches where org_id=p_org_id and request_id=p_request_id for update;
  if found then
    if v_existing.id<>p_batch_id or v_existing.board_id<>p_board_id or v_existing.payload<>p_rows then raise exception 'idempotency key reuse with different batch' using errcode='22023'; end if;
    return jsonb_build_object('accepted',true,'replayed',true,'status',v_existing.status);
  end if;
  if exists(select 1 from public.workspace_csv_batches where id=p_batch_id) then raise exception 'batch id reuse with different request' using errcode='22023'; end if;
  insert into public.workspace_csv_batches(id,org_id,board_id,request_id,payload,status,row_count,created_by) values(p_batch_id,p_org_id,p_board_id,p_request_id,p_rows,'dry_run',v_rows,v_actor);
  insert into public.workspace_ops_audit(org_id,actor_user_id,operation,entity_type,entity_id,request_id,metadata) values(p_org_id,v_actor,'csv_dry_run','csv_batch',p_batch_id,p_request_id,jsonb_build_object('board_id',p_board_id,'row_count',v_rows));
  return jsonb_build_object('accepted',true,'replayed',false,'status','dry_run');
end; $$;

create or replace function public.apply_workspace_csv_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.workspace_csv_batches%rowtype; v_actor uuid; v_row jsonb; v_item_id uuid; v_item_ids jsonb := '[]'::jsonb;
begin
  select * into v_batch from public.workspace_csv_batches where id=p_batch_id for update; if not found then raise exception 'batch not found' using errcode='P0002'; end if;
  v_actor:=public.workspace_ops_require_owner(v_batch.org_id);
  if v_batch.status='applied' then return jsonb_build_object('accepted',true,'replayed',true); end if;
  if v_batch.status<>'dry_run' then raise exception 'batch is not applicable' using errcode='23514'; end if;
  for v_row in select value from jsonb_array_elements(v_batch.payload) loop
    if jsonb_typeof(v_row) <> 'object' or coalesce(nullif(btrim(v_row->>'title'),''),'') is null then
      raise exception 'invalid csv row' using errcode='22023';
    end if;
    v_item_id := gen_random_uuid();
    insert into public.items(id,org_id,board_id,title,created_at,updated_at)
      values(v_item_id,v_batch.org_id,v_batch.board_id,btrim(v_row->>'title'),clock_timestamp(),clock_timestamp());
    insert into public.item_values(org_id,item_id,column_key,value_jsonb)
      select v_batch.org_id,v_item_id,key,value from jsonb_each(coalesce(v_row->'values','{}'::jsonb));
    v_item_ids := v_item_ids || to_jsonb(v_item_id);
  end loop;
  update public.workspace_csv_batches set status='applied',applied_at=clock_timestamp(),applied_item_ids=v_item_ids where id=p_batch_id;
  insert into public.workspace_ops_audit(org_id,actor_user_id,operation,entity_type,entity_id,request_id) values(v_batch.org_id,v_actor,'csv_applied','csv_batch',p_batch_id,v_batch.request_id);
  return jsonb_build_object('accepted',true,'replayed',false);
end; $$;

create or replace function public.rollback_workspace_csv_batch(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_batch public.workspace_csv_batches%rowtype; v_actor uuid;
begin
  select * into v_batch from public.workspace_csv_batches where id=p_batch_id for update; if not found then raise exception 'batch not found' using errcode='P0002'; end if;
  v_actor:=public.workspace_ops_require_owner(v_batch.org_id);
  if v_batch.status='rolled_back' then return jsonb_build_object('accepted',true,'replayed',true); end if;
  if v_batch.status<>'applied' then raise exception 'only an applied batch can be rolled back' using errcode='23514'; end if;
  delete from public.items item using jsonb_array_elements_text(v_batch.applied_item_ids) applied(id)
    where item.id=applied.id::uuid and item.org_id=v_batch.org_id and item.board_id=v_batch.board_id;
  update public.workspace_csv_batches set status='rolled_back',rolled_back_at=clock_timestamp(),applied_item_ids='[]'::jsonb where id=p_batch_id;
  insert into public.workspace_ops_audit(org_id,actor_user_id,operation,entity_type,entity_id,request_id) values(v_batch.org_id,v_actor,'csv_rolled_back','csv_batch',p_batch_id,v_batch.request_id);
  return jsonb_build_object('accepted',true,'replayed',false);
end; $$;

create or replace function public.save_workspace_automation_draft(p_automation_id uuid,p_org_id uuid,p_board_id uuid,p_draft jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.workspace_ops_require_owner(p_org_id); v_existing public.workspace_automation_configs%rowtype;
begin
  if p_automation_id is null or p_board_id is null or p_request_id is null or jsonb_typeof(p_draft)<>'object' then raise exception 'invalid automation draft' using errcode='22023'; end if;
  select * into v_existing from public.workspace_automation_configs where org_id=p_org_id and request_id=p_request_id for update;
  if found then
    if v_existing.id<>p_automation_id or v_existing.board_id<>p_board_id or v_existing.draft<>p_draft then raise exception 'idempotency key reuse with different automation' using errcode='22023'; end if;
    return jsonb_build_object('accepted',true,'replayed',true,'state',v_existing.state);
  end if;
  if exists(select 1 from public.workspace_automation_configs where id=p_automation_id) then raise exception 'automation id reuse with different request' using errcode='22023'; end if;
  insert into public.workspace_automation_configs(id,org_id,board_id,request_id,draft,state,created_by,updated_by) values(p_automation_id,p_org_id,p_board_id,p_request_id,p_draft,'draft',v_actor,v_actor);
  insert into public.workspace_ops_audit(org_id,actor_user_id,operation,entity_type,entity_id,request_id) values(p_org_id,v_actor,'automation_draft_saved','automation',p_automation_id,p_request_id);
  return jsonb_build_object('accepted',true,'replayed',false,'state','draft');
end; $$;

create or replace function public.activate_workspace_automation(p_automation_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_record public.workspace_automation_configs%rowtype; v_actor uuid;
begin
  select * into v_record from public.workspace_automation_configs where id=p_automation_id for update; if not found then raise exception 'automation not found' using errcode='P0002'; end if;
  v_actor:=public.workspace_ops_require_owner(v_record.org_id);
  if v_record.state='active' then return jsonb_build_object('accepted',true,'replayed',true); end if;
  if v_record.state<>'draft' then raise exception 'automation is quarantined' using errcode='23514'; end if;
  update public.workspace_automation_configs set state='active',updated_by=v_actor,updated_at=clock_timestamp(),activated_at=clock_timestamp() where id=p_automation_id;
  insert into public.workspace_ops_audit(org_id,actor_user_id,operation,entity_type,entity_id,request_id) values(v_record.org_id,v_actor,'automation_activated','automation',p_automation_id,v_record.request_id);
  return jsonb_build_object('accepted',true,'replayed',false);
end; $$;

revoke all on function public.workspace_ops_require_owner(uuid), public.save_workspace_builder_config(uuid,jsonb,uuid), public.create_workspace_csv_dry_run(uuid,uuid,uuid,jsonb,uuid), public.apply_workspace_csv_batch(uuid), public.rollback_workspace_csv_batch(uuid), public.save_workspace_automation_draft(uuid,uuid,uuid,jsonb,uuid), public.activate_workspace_automation(uuid) from public, anon;
grant execute on function public.save_workspace_builder_config(uuid,jsonb,uuid), public.create_workspace_csv_dry_run(uuid,uuid,uuid,jsonb,uuid), public.apply_workspace_csv_batch(uuid), public.rollback_workspace_csv_batch(uuid), public.save_workspace_automation_draft(uuid,uuid,uuid,jsonb,uuid), public.activate_workspace_automation(uuid) to authenticated;

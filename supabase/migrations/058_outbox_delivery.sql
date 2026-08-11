-- BBE-30: provider-neutral message dispatch outbox.
-- 058 follows fresh origin/main migration 057; existing migrations are untouched.

create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  idempotency_key text not null check (length(idempotency_key) between 16 and 500),
  actor_kind text not null check (actor_kind in ('person', 'automation')),
  actor_id text not null check (length(actor_id) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'leased', 'delivered', 'retry', 'dead')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  leased_by text,
  lease_token uuid,
  delivery_started_at timestamptz,
  delivered_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  unique (message_id)
);

create index message_outbox_claim_idx
  on public.message_outbox(next_attempt_at, created_at)
  where status in ('pending', 'retry', 'leased');

create unique index message_outbox_provider_receipt_uidx
  on public.message_outbox(provider_message_id)
  where provider_message_id is not null;

create table public.message_outbox_audit (
  id bigint generated always as identity primary key,
  outbox_id uuid not null references public.message_outbox(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  event text not null check (event in ('enqueued', 'duplicate_suppressed', 'claimed', 'delivery_started', 'delivery_unknown', 'delivered', 'retry_scheduled', 'dead')),
  actor_kind text not null check (actor_kind in ('person', 'automation')),
  actor_id text not null,
  worker_id text,
  attempt_count integer not null,
  occurred_at timestamptz not null default now()
);

create index message_outbox_audit_outbox_idx
  on public.message_outbox_audit(outbox_id, occurred_at);

alter table public.message_outbox enable row level security;
alter table public.message_outbox_audit enable row level security;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'moawork_outbox_worker') then
    create role moawork_outbox_worker login password null nobypassrls noinherit;
  end if;
end $$;

create policy message_outbox_read on public.message_outbox
  for select to authenticated
  using (public.is_org_member(org_id));

create policy message_outbox_person_enqueue on public.message_outbox
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and actor_kind = 'person'
    and actor_id = (select auth.uid())::text
  );

create policy message_outbox_audit_read on public.message_outbox_audit
  for select to authenticated
  using (public.is_org_member(org_id));

create or replace function public.enqueue_message_outbox(
  p_org_id uuid,
  p_message_id uuid,
  p_source_entity_id uuid,
  p_trigger_column_key text,
  p_trigger_value_id text,
  p_template_id uuid,
  p_channel public.message_channel,
  p_actor_kind text,
  p_actor_id text
)
returns table(outbox_id uuid, inserted boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_id uuid;
  v_inserted boolean;
begin
  if p_actor_kind = 'person' then
    if p_actor_id is distinct from (select auth.uid())::text
      or not public.is_org_member(p_org_id)
    then
      raise exception '발송 요청 권한이 없어요.' using errcode = '42501';
    end if;
  elsif p_actor_kind = 'automation' and (select auth.role()) <> 'service_role' then
    raise exception '자동 발송 요청 권한이 없어요.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.messages m where m.id = p_message_id and m.org_id = p_org_id
  ) then
    raise exception '발송할 메시지를 찾을 수 없어요.' using errcode = '22023';
  end if;
  if p_source_entity_id is null
    or nullif(trim(p_trigger_column_key), '') is null
    or nullif(trim(p_trigger_value_id), '') is null
    or p_template_id is null
  then
    raise exception '업무 단위 멱등키 값이 비어 있어요.' using errcode = '22023';
  end if;
  if p_actor_kind not in ('person', 'automation') or nullif(trim(p_actor_id), '') is null then
    raise exception '발송 요청자를 확인해 주세요.' using errcode = '22023';
  end if;

  -- 트랜잭션/현재 시각/수신 정보/본문을 넣지 않는다. 다른 트랜잭션의 동일 업무도 같은 키다.
  v_key := encode(extensions.digest(concat_ws(
    E'\x1f', 'message-v1', p_org_id::text, p_source_entity_id::text,
    p_trigger_column_key, p_trigger_value_id, p_template_id::text, p_channel::text
  ), 'sha256'), 'hex');

  insert into public.message_outbox(
    org_id, message_id, idempotency_key, actor_kind, actor_id
  ) values (
    p_org_id, p_message_id, v_key, p_actor_kind, p_actor_id
  )
  on conflict (org_id, idempotency_key) do nothing
  returning id into v_id;

  v_inserted := v_id is not null;
  if not v_inserted then
    select o.id into v_id
    from public.message_outbox o
    where o.org_id = p_org_id and o.idempotency_key = v_key;
    update public.messages
    set status = 'canceled', error = '동일 업무 발송이 이미 대기열에 있어요.'
    where id = p_message_id
      and id <> (select o.message_id from public.message_outbox o where o.id = v_id);
    insert into public.message_outbox_audit(
      outbox_id, org_id, event, actor_kind, actor_id, attempt_count
    )
    select o.id, o.org_id, 'duplicate_suppressed', p_actor_kind, p_actor_id, o.attempt_count
    from public.message_outbox o where o.id = v_id;
  else
    insert into public.message_outbox_audit(
      outbox_id, org_id, event, actor_kind, actor_id, attempt_count
    ) values (v_id, p_org_id, 'enqueued', p_actor_kind, p_actor_id, 0);
  end if;
  return query select v_id, v_inserted;
end;
$$;

create or replace function public.claim_message_outbox(
  p_limit integer,
  p_worker_id text,
  p_lease_ms integer
)
returns table(
  outbox_id uuid,
  message_id uuid,
  attempt_count integer,
  actor_kind text,
  actor_id text,
  lease_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker identity가 필요해요.' using errcode = '22023';
  end if;
  -- Once a paid call may have started, an expired lease is ambiguous. Quarantine it
  -- instead of replaying and risking a second charge.
  with abandoned as (
    update public.message_outbox o
    set status='dead', last_error='delivery outcome unknown; manual reconciliation required',
        lease_expires_at=null, lease_token=null, updated_at=now()
    where o.status='leased' and o.lease_expires_at <= now() and o.delivery_started_at is not null
    returning o.*
  )
  insert into public.message_outbox_audit(
    outbox_id,org_id,event,actor_kind,actor_id,worker_id,attempt_count
  )
  select a.id,a.org_id,'delivery_unknown',a.actor_kind,a.actor_id,a.leased_by,a.attempt_count
  from abandoned a;
  return query
  with candidates as (
    select o.id
    from public.message_outbox o
    where (
      o.status in ('pending', 'retry') and o.next_attempt_at <= now()
    ) or (
      o.status = 'leased' and o.lease_expires_at <= now() and o.delivery_started_at is null
    )
    order by o.next_attempt_at, o.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  ), claimed as (
    update public.message_outbox o
    set status = 'leased',
        attempt_count = o.attempt_count + 1,
        leased_at = now(),
        lease_expires_at = now() + make_interval(secs => greatest(5, least(coalesce(p_lease_ms, 60000), 900000)) / 1000.0),
        leased_by = p_worker_id,
        lease_token = gen_random_uuid(),
        delivery_started_at = null,
        updated_at = now()
    from candidates c
    where o.id = c.id
    returning o.id, o.org_id, o.message_id, o.attempt_count, o.actor_kind, o.actor_id, o.lease_token
  ), audited as (
    insert into public.message_outbox_audit(
      outbox_id, org_id, event, actor_kind, actor_id, worker_id, attempt_count
    )
    select c.id, c.org_id, 'claimed', c.actor_kind, c.actor_id, p_worker_id, c.attempt_count
    from claimed c
  )
  select c.id, c.message_id, c.attempt_count, c.actor_kind, c.actor_id, c.lease_token from claimed c;
end;
$$;

create or replace function public.start_message_outbox_delivery(
  p_outbox_id uuid, p_worker_id text, p_lease_token uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.message_outbox%rowtype;
begin
  update public.message_outbox set delivery_started_at=now(), updated_at=now()
  where id=p_outbox_id and status='leased' and leased_by=p_worker_id
    and lease_token=p_lease_token and lease_expires_at > now()
    and delivery_started_at is null
  returning * into v_row;
  if not found then raise exception 'delivery cannot be started for this lease' using errcode='40001'; end if;
  insert into public.message_outbox_audit(outbox_id,org_id,event,actor_kind,actor_id,worker_id,attempt_count)
  values(v_row.id,v_row.org_id,'delivery_started',v_row.actor_kind,v_row.actor_id,p_worker_id,v_row.attempt_count);
end $$;

create or replace function public.complete_message_outbox(
  p_outbox_id uuid, p_provider_message_id text, p_worker_id text, p_lease_token uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.message_outbox%rowtype;
begin
  update public.message_outbox set status='delivered', delivered_at=now(), provider_message_id=p_provider_message_id,
    lease_expires_at=null, lease_token=null, updated_at=now()
  where id=p_outbox_id and status='leased' and leased_by=p_worker_id
    and lease_token=p_lease_token and lease_expires_at > now() and delivery_started_at is not null
  returning * into v_row;
  if not found then raise exception '유효한 outbox lease가 아니에요.' using errcode='40001'; end if;
  insert into public.message_outbox_audit(outbox_id,org_id,event,actor_kind,actor_id,worker_id,attempt_count)
  values(v_row.id,v_row.org_id,'delivered',v_row.actor_kind,v_row.actor_id,p_worker_id,v_row.attempt_count);
end $$;

create or replace function public.retry_message_outbox(
  p_outbox_id uuid, p_reason text, p_next_attempt_at timestamptz, p_worker_id text, p_lease_token uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.message_outbox%rowtype;
begin
  update public.message_outbox set status='retry', next_attempt_at=p_next_attempt_at, last_error=left(p_reason,300),
    lease_expires_at=null, lease_token=null, delivery_started_at=null, updated_at=now()
  where id=p_outbox_id and status='leased' and leased_by=p_worker_id
    and lease_token=p_lease_token and lease_expires_at > now()
  returning * into v_row;
  if not found then raise exception '유효한 outbox lease가 아니에요.' using errcode='40001'; end if;
  insert into public.message_outbox_audit(outbox_id,org_id,event,actor_kind,actor_id,worker_id,attempt_count)
  values(v_row.id,v_row.org_id,'retry_scheduled',v_row.actor_kind,v_row.actor_id,p_worker_id,v_row.attempt_count);
end $$;

create or replace function public.fail_message_outbox(
  p_outbox_id uuid, p_reason text, p_worker_id text, p_lease_token uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_row public.message_outbox%rowtype;
begin
  update public.message_outbox set status='dead', last_error=left(p_reason,300), lease_expires_at=null,
    lease_token=null, updated_at=now()
  where id=p_outbox_id and status='leased' and leased_by=p_worker_id
    and lease_token=p_lease_token and lease_expires_at > now()
  returning * into v_row;
  if not found then raise exception '유효한 outbox lease가 아니에요.' using errcode='40001'; end if;
  insert into public.message_outbox_audit(outbox_id,org_id,event,actor_kind,actor_id,worker_id,attempt_count)
  values(v_row.id,v_row.org_id,'dead',v_row.actor_kind,v_row.actor_id,p_worker_id,v_row.attempt_count);
end $$;

create or replace function public.load_message_outbox_payload(
  p_message_id uuid, p_worker_id text, p_lease_token uuid
)
returns table(
  id uuid,
  channel public.message_channel,
  to_addr text,
  from_addr text,
  body_snapshot text,
  template_code text,
  sender_profile_id text
)
language sql
security definer
set search_path = ''
as $$
  select m.id, m.channel, m.to_addr, m.from_addr, m.body_snapshot,
    t.code, m.sender_profile_id
  from public.message_outbox o
  join public.messages m on m.id = o.message_id and m.org_id = o.org_id
  left join public.message_templates t on t.id = m.template_id and t.org_id = m.org_id
  where o.message_id = p_message_id
    and o.status = 'leased'
    and o.leased_by = p_worker_id
    and o.lease_token = p_lease_token
    and o.lease_expires_at > now()
$$;

revoke all on public.message_outbox from anon;
revoke all on public.message_outbox_audit from anon;
revoke execute on function public.enqueue_message_outbox(uuid,uuid,uuid,text,text,uuid,public.message_channel,text,text) from public, anon;
revoke execute on function public.claim_message_outbox(integer,text,integer) from public, anon, authenticated;
revoke execute on function public.start_message_outbox_delivery(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.complete_message_outbox(uuid,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.retry_message_outbox(uuid,text,timestamptz,text,uuid) from public, anon, authenticated;
revoke execute on function public.fail_message_outbox(uuid,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.load_message_outbox_payload(uuid,text,uuid) from public, anon, authenticated, service_role;
revoke execute on function public.claim_message_outbox(integer,text,integer) from service_role;
revoke execute on function public.start_message_outbox_delivery(uuid,text,uuid) from service_role;
revoke execute on function public.complete_message_outbox(uuid,text,text,uuid) from service_role;
revoke execute on function public.retry_message_outbox(uuid,text,timestamptz,text,uuid) from service_role;
revoke execute on function public.fail_message_outbox(uuid,text,text,uuid) from service_role;
grant execute on function public.claim_message_outbox(integer,text,integer) to moawork_outbox_worker;
grant execute on function public.start_message_outbox_delivery(uuid,text,uuid) to moawork_outbox_worker;
grant execute on function public.complete_message_outbox(uuid,text,text,uuid) to moawork_outbox_worker;
grant execute on function public.retry_message_outbox(uuid,text,timestamptz,text,uuid) to moawork_outbox_worker;
grant execute on function public.fail_message_outbox(uuid,text,text,uuid) to moawork_outbox_worker;
grant execute on function public.load_message_outbox_payload(uuid,text,uuid) to moawork_outbox_worker;
grant execute on function public.enqueue_message_outbox(uuid,uuid,uuid,text,text,uuid,public.message_channel,text,text) to authenticated, service_role;

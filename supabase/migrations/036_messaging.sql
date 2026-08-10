-- BBE-114: 상태 변경 부작용 메시징 outbox, 멱등성, 수신 거부, 묶음 집계.
-- 035 is concurrently leased by PR #121/#122; re-number against latest main before merge.

alter table public.messages
  add column if not exists source_entity_id uuid,
  add column if not exists batch_id uuid,
  add column if not exists channel public.message_channel,
  add column if not exists body_snapshot text,
  add column if not exists from_addr text,
  add column if not exists sender_profile_id text,
  add column if not exists idempotency_key text,
  add column if not exists trigger_column_key text,
  add column if not exists trigger_value text,
  add column if not exists provider_message_id text,
  add column if not exists excluded_reason text,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

create unique index if not exists messages_org_idempotency_uq
  on public.messages(org_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.messaging_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  batch_key text not null,
  requested_count integer not null default 0 check (requested_count >= 0),
  queued_count integer not null default 0 check (queued_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  excluded_count integer not null default 0 check (excluded_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  unique (org_id, batch_key)
);

create table if not exists public.messaging_opt_outs (
  org_id uuid not null references public.orgs(id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{9,12}$'),
  reason text not null default '수신 거부',
  opted_out_at timestamptz not null default now(),
  primary key (org_id, phone_digits)
);

create table if not exists public.messaging_trigger_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  column_key text not null,
  trigger_value text not null,
  phone_column_key text not null,
  sender_digits text not null check (sender_digits ~ '^[0-9]{9,12}$'),
  sender_profile_id text,
  template_id uuid not null references public.message_templates(id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (board_id, column_key, trigger_value)
);

alter table public.messaging_batches enable row level security;
alter table public.messaging_opt_outs enable row level security;
alter table public.messaging_trigger_rules enable row level security;

create policy messaging_batches_read on public.messaging_batches
  for select using (public.is_org_member(org_id));
create policy messaging_opt_outs_read on public.messaging_opt_outs
  for select using (public.is_org_member(org_id));
create policy messaging_opt_outs_write on public.messaging_opt_outs
  for all using (public.org_role(org_id) in ('owner','admin'))
  with check (public.org_role(org_id) in ('owner','admin'));
create policy messaging_trigger_rules_read on public.messaging_trigger_rules
  for select using (public.is_org_member(org_id));
create policy messaging_trigger_rules_write on public.messaging_trigger_rules
  for all using (public.org_role(org_id) in ('owner','admin'))
  with check (public.org_role(org_id) in ('owner','admin'));

create or replace function public.messaging_text_value(p_value jsonb)
returns text language sql immutable as $$
  select coalesce(
    nullif(p_value #>> '{label}', ''),
    nullif(p_value #>> '{value}', ''),
    nullif(p_value #>> '{}', '')
  )
$$;

create or replace function public.enqueue_message_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.items%rowtype;
  v_rule public.messaging_trigger_rules%rowtype;
  v_template public.message_templates%rowtype;
  v_phone text;
  v_value text;
  v_batch_id uuid;
  v_message_id uuid;
  v_key text;
  v_excluded boolean;
begin
  if tg_op = 'UPDATE' and new.value_jsonb is not distinct from old.value_jsonb then
    return new;
  end if;

  v_value := public.messaging_text_value(new.value_jsonb);
  select * into v_item from public.items where id = new.item_id and org_id = new.org_id;
  if not found then return new; end if;

  select * into v_rule
  from public.messaging_trigger_rules
  where org_id = new.org_id and board_id = v_item.board_id
    and column_key = new.column_key and trigger_value = v_value and enabled
  limit 1;
  if not found then return new; end if;

  select * into v_template from public.message_templates where id = v_rule.template_id;
  select regexp_replace(public.messaging_text_value(value_jsonb), '[^0-9]', '', 'g') into v_phone
  from public.item_values
  where item_id = new.item_id and column_key = v_rule.phone_column_key;

  v_key := md5(concat_ws(':', new.org_id, new.item_id, new.column_key, v_value, txid_current()));
  insert into public.messaging_batches(org_id, batch_key, requested_count)
  values (new.org_id, 'transition:' || v_key, 1)
  on conflict (org_id, batch_key) do update set requested_count = public.messaging_batches.requested_count
  returning id into v_batch_id;

  v_excluded := exists (
    select 1 from public.messaging_opt_outs where org_id = new.org_id and phone_digits = v_phone
  );

  insert into public.messages(
    org_id, template_id, to_addr, status, source_entity_id, batch_id, channel,
    from_addr, sender_profile_id,
    body_snapshot, idempotency_key, trigger_column_key, trigger_value, error, excluded_reason
  ) values (
    new.org_id, v_template.id, coalesce(v_phone, ''),
    case when v_excluded then 'canceled'::public.message_status
         when coalesce(v_phone, '') !~ '^[0-9]{9,12}$' then 'failed'::public.message_status
         when v_template.channel = 'alimtalk' and v_template.status not in ('approved','승인') then 'failed'::public.message_status
         else 'queued'::public.message_status end,
    new.item_id, v_batch_id, v_template.channel,
    v_rule.sender_digits, v_rule.sender_profile_id,
    v_template.body, v_key,
    new.column_key, v_value,
    case when coalesce(v_phone, '') !~ '^[0-9]{9,12}$' then '전화번호를 확인해 주세요.'
         when v_template.channel = 'alimtalk' and v_template.status not in ('approved','승인') then '승인된 알림톡 템플릿이 아니에요.' end,
    case when v_excluded then '수신 거부' end
  )
  on conflict (org_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into v_message_id;

  update public.messaging_batches set
    queued_count = case when v_message_id is not null and not v_excluded and v_phone ~ '^[0-9]{9,12}$' and not (v_template.channel = 'alimtalk' and v_template.status not in ('approved','승인')) then 1 else 0 end,
    excluded_count = case when v_excluded then 1 else 0 end,
    failed_count = case when not v_excluded and (coalesce(v_phone, '') !~ '^[0-9]{9,12}$' or (v_template.channel = 'alimtalk' and v_template.status not in ('approved','승인'))) then 1 else 0 end,
    duplicate_count = case when v_message_id is null then 1 else 0 end
  where id = v_batch_id;
  return new;
end;
$$;

drop trigger if exists item_values_enqueue_message_transition on public.item_values;
create trigger item_values_enqueue_message_transition
after insert or update of value_jsonb on public.item_values
for each row execute function public.enqueue_message_transition();

create or replace function public.retry_failed_messages(p_message_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_count integer;
begin
  update public.messages
  set status = 'queued', error = null
  where id = any(p_message_ids) and status = 'failed' and public.is_org_member(org_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

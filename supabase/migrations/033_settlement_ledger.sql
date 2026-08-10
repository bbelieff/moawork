-- BBE-19: immutable settlement payment ledger + audit trail.
-- `/settlements` is a static application route. Re-state the two existing
-- checks additively so new databases and already-migrated databases agree.
alter table public.orgs
  drop constraint if exists orgs_slug_format_check;

alter table public.orgs
  add constraint orgs_slug_format_check
  check (
    slug is null
    or (
      slug = lower(slug)
      and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and char_length(slug) between 3 and 40
      and slug not in (
        '_next', 'account', 'admin', 'api', 'auth', 'boards', 'companies',
        'contract', 'dash', 'deals', 'login', 'logout', 'mode', 'newcust',
        'notices', 'onboarding', 'platform', 'policyfund', 'settings',
        'settlements', 'support', 'w', 'work', 'workspace-entry', 'workspaces', 'www'
      )
    )
  );

alter table public.workspace_entry_requests
  drop constraint if exists workspace_entry_request_shape_check;

alter table public.workspace_entry_requests
  add constraint workspace_entry_request_shape_check check (
    (
      kind = 'create'
      and desired_name is not null
      and desired_slug is not null
      and char_length(desired_name) between 1 and 80
      and char_length(desired_slug) between 3 and 40
      and desired_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      and desired_slug not in (
        '_next', 'account', 'admin', 'api', 'auth', 'boards', 'companies',
        'contract', 'dash', 'deals', 'login', 'logout', 'mode', 'newcust',
        'notices', 'onboarding', 'platform', 'policyfund', 'settings',
        'settlements', 'support', 'w', 'work', 'workspace-entry', 'workspaces', 'www'
      )
      and lookup_digest is null
      and (review_expires_at is null or review_expires_at = created_at + interval '14 days')
    )
    or (
      kind = 'join'
      and desired_name is null
      and desired_slug is null
      and lookup_digest is not null
      and (review_expires_at is null or review_expires_at = created_at + interval '14 days')
    )
  );

create table if not exists public.settlement_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  kind text not null check (kind in ('payment', 'refund', 'adjustment')),
  amount numeric(18,0) not null check (amount > 0),
  occurred_on date not null,
  source text not null default 'input' check (source in ('input', 'calculated')),
  status text not null default 'posted' check (status in ('posted', 'canceled')),
  corrected_from uuid references public.settlement_ledger_entries(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  canceled_by uuid references public.users(id),
  canceled_at timestamptz,
  unique (corrected_from)
);

create index if not exists settlement_ledger_entries_org_settlement_idx
  on public.settlement_ledger_entries(org_id, settlement_id, occurred_on desc);

create table if not exists public.settlement_ledger_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  entry_id uuid not null references public.settlement_ledger_entries(id),
  action text not null check (action in ('posted', 'canceled', 'corrected')),
  actor_user_id uuid not null references public.users(id),
  amount numeric(18,0) not null,
  occurred_on date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.settlement_export_audit (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  actor_user_id uuid not null references public.users(id),
  row_count integer not null check (row_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.settlement_ledger_entries enable row level security;
alter table public.settlement_ledger_audit enable row level security;
alter table public.settlement_export_audit enable row level security;

create or replace function public.can_read_settlement_ledger(p_settlement_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.settlements s
    left join public.deals d on d.id = s.deal_id and d.org_id = s.org_id
    where s.id = p_settlement_id
      and public.is_org_member(s.org_id)
      and (
        public.org_role(s.org_id) in ('owner', 'admin')
        or public.org_scope(s.org_id) = 'all'
        or d.assigned_to = auth.uid()
      )
  );
$$;

create policy settlement_ledger_entries_read on public.settlement_ledger_entries
  for select to authenticated using (public.can_read_settlement_ledger(settlement_id));
create policy settlement_ledger_audit_read on public.settlement_ledger_audit
  for select to authenticated using (public.can_read_settlement_ledger(settlement_id));
create policy settlement_export_audit_read on public.settlement_export_audit
  for select to authenticated using (public.org_role(org_id) in ('owner', 'admin'));

create or replace function public.get_settlement_ledger_snapshot(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(scoped) order by scoped.created_at desc), '[]'::jsonb)
  from (
    select s.id, s.fee_amount, s.total_revenue, s.created_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id, 'settlement_id', e.settlement_id, 'kind', e.kind,
          'amount', e.amount, 'occurred_on', e.occurred_on, 'source', e.source,
          'status', e.status, 'corrected_from', e.corrected_from,
          'created_at', e.created_at, 'created_by', e.created_by
        ) order by e.occurred_on desc, e.created_at desc)
        from public.settlement_ledger_entries e where e.settlement_id = s.id
      ), '[]'::jsonb) as entries
    from public.settlements s
    left join public.deals d on d.id = s.deal_id and d.org_id = s.org_id
    where s.org_id = p_org_id
      and public.is_org_member(s.org_id)
      and (
        public.org_role(s.org_id) in ('owner', 'admin')
        or public.org_scope(s.org_id) = 'all'
        or d.assigned_to = auth.uid()
      )
  ) scoped;
$$;

revoke all on public.settlement_ledger_entries from public, anon, authenticated;
revoke all on public.settlement_ledger_audit from public, anon, authenticated;
revoke all on public.settlement_export_audit from public, anon, authenticated;
grant select on public.settlement_ledger_entries to authenticated;
grant select on public.settlement_ledger_audit to authenticated;
grant select on public.settlement_export_audit to authenticated;

create or replace function public.post_settlement_ledger_entry(
  p_settlement_id uuid, p_kind text, p_amount numeric, p_occurred_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org_id uuid; v_entry_id uuid; v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required' using errcode='42501'; end if;
  select org_id into v_org_id from public.settlements where id = p_settlement_id;
  if v_org_id is null then raise exception 'settlement not found' using errcode='P0002'; end if;
  if public.org_role(v_org_id) not in ('owner', 'admin') then raise exception 'manager required' using errcode='42501'; end if;
  if p_kind not in ('payment','refund','adjustment') or p_amount <= 0 or trunc(p_amount) <> p_amount then raise exception 'invalid ledger entry' using errcode='22023'; end if;
  insert into public.settlement_ledger_entries(org_id,settlement_id,kind,amount,occurred_on,created_by)
    values(v_org_id,p_settlement_id,p_kind,p_amount,p_occurred_on,v_actor) returning id into v_entry_id;
  insert into public.settlement_ledger_audit(org_id,settlement_id,entry_id,action,actor_user_id,amount,occurred_on)
    values(v_org_id,p_settlement_id,v_entry_id,'posted',v_actor,p_amount,p_occurred_on);
  return v_entry_id;
end $$;

create or replace function public.record_settlement_csv_export(p_org_id uuid, p_row_count integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or public.org_role(p_org_id) not in ('owner','admin') then raise exception 'manager required' using errcode='42501'; end if;
  if p_row_count < 0 then raise exception 'invalid row count' using errcode='22023'; end if;
  insert into public.settlement_export_audit(org_id,actor_user_id,row_count)
    values(p_org_id,v_actor,p_row_count);
end $$;

create or replace function public.cancel_settlement_ledger_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_entry public.settlement_ledger_entries%rowtype; v_actor uuid := auth.uid();
begin
  select * into v_entry from public.settlement_ledger_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found' using errcode='P0002'; end if;
  if public.org_role(v_entry.org_id) not in ('owner','admin') then raise exception 'manager required' using errcode='42501'; end if;
  if v_entry.status <> 'posted' then raise exception 'entry already canceled' using errcode='22023'; end if;
  update public.settlement_ledger_entries set status='canceled',canceled_by=v_actor,canceled_at=clock_timestamp() where id=p_entry_id;
  insert into public.settlement_ledger_audit(org_id,settlement_id,entry_id,action,actor_user_id,amount,occurred_on)
    values(v_entry.org_id,v_entry.settlement_id,v_entry.id,'canceled',v_actor,v_entry.amount,v_entry.occurred_on);
end $$;

create or replace function public.correct_settlement_ledger_entry(
  p_entry_id uuid, p_amount numeric, p_occurred_on date
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_entry public.settlement_ledger_entries%rowtype; v_actor uuid := auth.uid(); v_new_id uuid;
begin
  select * into v_entry from public.settlement_ledger_entries where id=p_entry_id for update;
  if not found then raise exception 'entry not found' using errcode='P0002'; end if;
  if public.org_role(v_entry.org_id) not in ('owner','admin') then raise exception 'manager required' using errcode='42501'; end if;
  if v_entry.status <> 'posted' or p_amount <= 0 or trunc(p_amount) <> p_amount then raise exception 'invalid correction' using errcode='22023'; end if;
  update public.settlement_ledger_entries set status='canceled',canceled_by=v_actor,canceled_at=clock_timestamp() where id=p_entry_id;
  insert into public.settlement_ledger_entries(org_id,settlement_id,kind,amount,occurred_on,created_by,corrected_from)
    values(v_entry.org_id,v_entry.settlement_id,v_entry.kind,p_amount,p_occurred_on,v_actor,v_entry.id) returning id into v_new_id;
  insert into public.settlement_ledger_audit(org_id,settlement_id,entry_id,action,actor_user_id,amount,occurred_on)
    values(v_entry.org_id,v_entry.settlement_id,v_entry.id,'corrected',v_actor,p_amount,p_occurred_on);
  insert into public.settlement_ledger_audit(org_id,settlement_id,entry_id,action,actor_user_id,amount,occurred_on)
    values(v_entry.org_id,v_entry.settlement_id,v_new_id,'posted',v_actor,p_amount,p_occurred_on);
  return v_new_id;
end $$;

revoke all on function public.can_read_settlement_ledger(uuid), public.get_settlement_ledger_snapshot(uuid), public.post_settlement_ledger_entry(uuid,text,numeric,date), public.cancel_settlement_ledger_entry(uuid), public.correct_settlement_ledger_entry(uuid,numeric,date), public.record_settlement_csv_export(uuid,integer) from public, anon;
grant execute on function public.can_read_settlement_ledger(uuid), public.get_settlement_ledger_snapshot(uuid), public.post_settlement_ledger_entry(uuid,text,numeric,date), public.cancel_settlement_ledger_entry(uuid), public.correct_settlement_ledger_entry(uuid,numeric,date), public.record_settlement_csv_export(uuid,integer) to authenticated;

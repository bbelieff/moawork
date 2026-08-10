-- BBE-108: one deal has many accounting ledger entries (migration 035).
-- Money is authoritative here; this migration never copies a deal or writes deal.amount.
create table public.deal_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null check (kind in ('contract_deposit', 'fee')),
  amount numeric(18,0) not null check (amount > 0 and trunc(amount) = amount),
  received_amount numeric(18,0) not null default 0
    check (received_amount between 0 and amount and trunc(received_amount) = received_amount),
  occurred_on date not null,
  paid_on date,
  attribution_month date not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  check (attribution_month = date_trunc('month', attribution_month)::date),
  check ((received_amount = amount and paid_on is not null) or (received_amount < amount and paid_on is null)),
  unique (org_id, id)
);

create index deal_ledger_entries_deal_occurred_idx
  on public.deal_ledger_entries(org_id, deal_id, occurred_on desc);
create index deal_ledger_entries_attribution_idx
  on public.deal_ledger_entries(org_id, attribution_month, kind);

alter table public.deal_ledger_entries enable row level security;

create or replace function public.can_access_deal_ledger(p_deal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deals d
    where d.id = p_deal_id
      and public.is_org_member(d.org_id)
      and (
        public.org_role(d.org_id) in ('owner', 'admin')
        or public.org_scope(d.org_id) = 'all'
        or d.assigned_to = auth.uid()
      )
  );
$$;

create policy deal_ledger_entries_select on public.deal_ledger_entries
  for select to authenticated
  using (public.can_access_deal_ledger(deal_id));

create or replace function public.add_deal_ledger_entry(
  p_deal_id uuid,
  p_kind text,
  p_amount numeric,
  p_received_amount numeric,
  p_occurred_on date,
  p_paid_on date,
  p_attribution_month date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_entry_id uuid;
begin
  if auth.uid() is null or not public.can_access_deal_ledger(p_deal_id) then
    raise exception 'deal ledger access denied' using errcode = '42501';
  end if;

  select d.org_id into v_org_id from public.deals d where d.id = p_deal_id;
  if v_org_id is null then
    raise exception 'deal not found' using errcode = 'P0002';
  end if;

  insert into public.deal_ledger_entries (
    org_id, deal_id, kind, amount, received_amount, occurred_on,
    paid_on, attribution_month, created_by
  ) values (
    v_org_id, p_deal_id, p_kind, p_amount, p_received_amount, p_occurred_on,
    p_paid_on, p_attribution_month, auth.uid()
  ) returning id into v_entry_id;

  return v_entry_id;
end;
$$;

create or replace function public.delete_deal_ledger_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal_id uuid;
begin
  select e.deal_id into v_deal_id
  from public.deal_ledger_entries e
  where e.id = p_entry_id
  for update;

  if v_deal_id is null then
    raise exception 'ledger entry not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.can_access_deal_ledger(v_deal_id) then
    raise exception 'deal ledger access denied' using errcode = '42501';
  end if;

  delete from public.deal_ledger_entries where id = p_entry_id;
end;
$$;

create or replace function public.deal_ledger_summary(p_deal_id uuid)
returns table (
  deal_id uuid,
  entry_count bigint,
  ledger_total numeric,
  fee_total numeric,
  received_total numeric,
  outstanding_total numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p_deal_id,
    count(e.id),
    coalesce(sum(e.amount), 0),
    coalesce(sum(amount) filter (where kind = 'fee'), 0),
    coalesce(sum(e.received_amount), 0),
    coalesce(sum(amount - received_amount), 0)
  from public.deal_ledger_entries e
  where e.deal_id = p_deal_id
    and public.can_access_deal_ledger(p_deal_id);
$$;

revoke all on public.deal_ledger_entries from public, anon, authenticated;
grant select on public.deal_ledger_entries to authenticated;
revoke all on function public.can_access_deal_ledger(uuid),
  public.deal_ledger_summary(uuid),
  public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date),
  public.delete_deal_ledger_entry(uuid)
  from public, anon;
grant execute on function public.can_access_deal_ledger(uuid),
  public.deal_ledger_summary(uuid),
  public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date),
  public.delete_deal_ledger_entry(uuid)
  to authenticated;

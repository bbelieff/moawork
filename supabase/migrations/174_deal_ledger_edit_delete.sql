-- moa-migration-guard: logical_key=174_deal_ledger_edit_delete predecessor=173_companies_read_via_own_deal digest=867f8a7e4f4a9aa535dc71c82e2fe518a7fd327855fc1307ebfdfb87df454681 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '174_deal_ledger_edit_delete',
  p_file_name => '174_deal_ledger_edit_delete.sql',
  p_file_digest => '867f8a7e4f4a9aa535dc71c82e2fe518a7fd327855fc1307ebfdfb87df454681',
  p_expected_predecessor => '173_companies_read_via_own_deal',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 885 (belie 결정 2026-10-13 «원장 고치기·지우기 살리기») — 잘못 넣은 원장 항목을 고칠 길이 없었다.
--
--   1) 고치기: update_deal_ledger_entry. 원장 접근권 + 항목 추가·수정 권한(work.item_upsert).
--      귀속월은 발생일에서 서버가 다시 만든다. 104 의 CHECK 가 그대로 값을 검증한다.
--   2) 지우기: 035 의 delete_deal_ledger_entry 를 «지운 표시» 로 바꾼다(행을 지우지 않음).
--      원장 접근권 + (본인이 넣은 항목 또는 항목 삭제 권한 work.item_delete).
--      지운 항목은 select 정책·요약에서 빠져 모든 합계에서 사라진다.
--   3) 계약금 여러 건: 104 의 «딜당 계약금 1건» 서버 검사를 뺀다(분납·추가 계약금).
--   고치기·지우기는 딜 활동 기록(activities, type=memo)에 «무엇을 → 무엇으로» 남긴다.

alter table public.deal_ledger_entries
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid references public.users(id),
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id);

-- 지운 항목은 아무 화면에도 읽히지 않는다(연간 원장·홈·업체관리·딜 원장이 모두 이 정책으로 읽는다).
drop policy if exists deal_ledger_entries_select on public.deal_ledger_entries;
create policy deal_ledger_entries_select on public.deal_ledger_entries
  for select to authenticated
  using (deleted_at is null and public.can_access_deal_ledger(deal_id));

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
    and e.deleted_at is null
    and public.can_access_deal_ledger(p_deal_id);
$$;

-- 계약금 여러 건 — 104 와 같은 시그니처로 다시 만들되 «딜당 1건» 검사만 뺀다.
create or replace function public.add_deal_ledger_entry(
  p_deal_id uuid, p_kind text, p_amount numeric, p_received_amount numeric,
  p_occurred_on date, p_paid_on date, p_attribution_month date,
  p_vat_included boolean default false, p_tax_invoice_issued boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_org_id uuid; v_entry_id uuid;
begin
  if auth.uid() is null or not public.can_access_deal_ledger(p_deal_id) then
    raise exception 'deal ledger access denied' using errcode = '42501';
  end if;
  select d.org_id into v_org_id from public.deals d where d.id = p_deal_id;
  if v_org_id is null then raise exception 'deal not found' using errcode = 'P0002'; end if;
  insert into public.deal_ledger_entries (
    org_id, deal_id, kind, amount, received_amount, occurred_on,
    paid_on, attribution_month, created_by, vat_included, tax_invoice_issued
  ) values (
    v_org_id, p_deal_id, p_kind, p_amount, p_received_amount, p_occurred_on,
    p_paid_on, p_attribution_month, auth.uid(), p_vat_included, p_tax_invoice_issued
  ) returning id into v_entry_id;
  return v_entry_id;
end; $$;

create or replace function public.update_deal_ledger_entry(
  p_entry_id uuid,
  p_amount numeric,
  p_received_amount numeric,
  p_occurred_on date,
  p_paid_on date,
  p_vat_included boolean,
  p_tax_invoice_issued boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_before public.deal_ledger_entries;
begin
  select * into v_before from public.deal_ledger_entries e
   where e.id = p_entry_id and e.deleted_at is null
   for update;
  if v_before.id is null then
    raise exception 'ledger entry not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.can_access_deal_ledger(v_before.deal_id)
     or not public.effective_permission(v_before.org_id, 'work.item_upsert') then
    raise exception 'deal ledger access denied' using errcode = '42501';
  end if;

  update public.deal_ledger_entries set
    amount = p_amount,
    received_amount = p_received_amount,
    occurred_on = p_occurred_on,
    paid_on = p_paid_on,
    attribution_month = date_trunc('month', p_occurred_on)::date,
    vat_included = p_vat_included,
    tax_invoice_issued = p_tax_invoice_issued,
    updated_at = now(),
    updated_by = auth.uid()
  where id = p_entry_id;

  insert into public.activities (org_id, deal_id, type, content, actor)
  values (v_before.org_id, v_before.deal_id, 'memo',
    format('원장 수정 · %s %s원(발생 %s, 입금 %s원, 입금일 %s, %s) → %s원(발생 %s, 입금 %s원, 입금일 %s, %s)',
      case v_before.kind when 'contract_deposit' then '계약금' else '수수료' end,
      to_char(v_before.amount, 'FM999,999,999,999,999,999'), v_before.occurred_on, to_char(v_before.received_amount, 'FM999,999,999,999,999,999'),
      coalesce(v_before.paid_on::text, '없음'),
      concat_ws('·', case when v_before.vat_included then 'VAT포함' end, case when v_before.tax_invoice_issued then '계산서' end, case when not v_before.vat_included and not v_before.tax_invoice_issued then 'VAT없음' end),
      to_char(p_amount, 'FM999,999,999,999,999,999'), p_occurred_on, to_char(p_received_amount, 'FM999,999,999,999,999,999'),
      coalesce(p_paid_on::text, '없음'),
      concat_ws('·', case when p_vat_included then 'VAT포함' end, case when p_tax_invoice_issued then '계산서' end, case when not p_vat_included and not p_tax_invoice_issued then 'VAT없음' end)),
    auth.uid());
end; $$;

-- 035 의 하드 삭제를 «지운 표시» 로 바꾼다. 시그니처는 그대로다.
create or replace function public.delete_deal_ledger_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.deal_ledger_entries;
begin
  select * into v_entry from public.deal_ledger_entries e
   where e.id = p_entry_id and e.deleted_at is null
   for update;
  if v_entry.id is null then
    raise exception 'ledger entry not found' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.can_access_deal_ledger(v_entry.deal_id)
     or not (v_entry.created_by = auth.uid() or public.effective_permission(v_entry.org_id, 'work.item_delete')) then
    raise exception 'deal ledger access denied' using errcode = '42501';
  end if;

  update public.deal_ledger_entries
     set deleted_at = now(), deleted_by = auth.uid()
   where id = p_entry_id;

  insert into public.activities (org_id, deal_id, type, content, actor)
  values (v_entry.org_id, v_entry.deal_id, 'memo',
    format('원장 삭제 · %s %s원(%s)',
      case v_entry.kind when 'contract_deposit' then '계약금' else '수수료' end,
      to_char(v_entry.amount, 'FM999,999,999,999,999,999'), v_entry.occurred_on),
    auth.uid());
end;
$$;

revoke all on function public.update_deal_ledger_entry(uuid,numeric,numeric,date,date,boolean,boolean) from public, anon;
grant execute on function public.update_deal_ledger_entry(uuid,numeric,numeric,date,date,boolean,boolean) to authenticated;
revoke all on function public.delete_deal_ledger_entry(uuid) from public, anon;
grant execute on function public.delete_deal_ledger_entry(uuid) to authenticated;
revoke all on function public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean) from public, anon;
grant execute on function public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean) to authenticated;
revoke all on function public.deal_ledger_summary(uuid) from public, anon;
grant execute on function public.deal_ledger_summary(uuid) to authenticated;

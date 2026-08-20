-- moa-migration-guard: logical_key=103_bbe240_deal_ledger_vat_wiring predecessor=102_bbe239_board_item_files_storage digest=866de2fb1741325d0f95b53c1160b0b05cbf3f90ba2a03f1a13bb2e60fcd4f0b foundation=false

select public.begin_guarded_migration(
  p_logical_key => '103_bbe240_deal_ledger_vat_wiring',
  p_file_name => '103_bbe240_deal_ledger_vat_wiring.sql',
  p_file_digest => '866de2fb1741325d0f95b53c1160b0b05cbf3f90ba2a03f1a13bb2e60fcd4f0b',
  p_expected_predecessor => '102_bbe239_board_item_files_storage',
  p_executor => 'DC-00',
  p_thread_id => '54ccb210-7be2-4b40-bcea-8cf0d99047ee',
  p_foundation => false
);

-- BBE-240: 업무 원장에 부가세(VAT) 정보를 얹는다.
--
-- 왜: 035 의 두 CHECK(`received_amount between 0 and amount`,
-- `(received_amount=amount and paid_on is not null) or (received_amount<amount and paid_on is null)`)
-- 는 VAT 미포함 금액만 전제한다 — VAT 포함 입금액은 amount 를 초과할 수 있고, amount 와
-- «정확히 같음» 이 성립하지 않을 수 있어(부가세액 컬럼이 따로 없다) 그대로 두면 정상적인
-- VAT 입금이 두 CHECK 모두를 깬다. 035 자체는 고치지 않는다(migration.test.ts 가 원문을
-- 고정) — 여기서 컬럼을 얹고 제약을 이름으로 찾아 교체한다.

alter table public.deal_ledger_entries
  add column if not exists vat_included boolean not null default false,
  add column if not exists tax_invoice_issued boolean not null default false;

do $$
declare v_name text;
begin
  -- pg_get_constraintdef() 는 BETWEEN 을 >=/<= 로 정규화해 저장한다 — 035 원문의
  -- "between 0 and amount" 라는 리터럴은 카탈로그 어디에도 그대로 남지 않는다.
  -- 그 문자열로 찾으면 절대 못 찾는다(실제로 이 실수가 있었다 — PGlite 실행형 테스트로 발견,
  -- 문자열 pin 테스트만으로는 못 잡았다). vat_included 를 언급 안 하는 쪽으로 옛 것만 골라낸다.
  select conname into v_name from pg_constraint
   where conrelid = 'public.deal_ledger_entries'::regclass
     and pg_get_constraintdef(oid) ilike '%received_amount <= amount%'
     and pg_get_constraintdef(oid) not ilike '%vat_included%';
  if v_name is not null then execute format('alter table public.deal_ledger_entries drop constraint %I', v_name); end if;

  select conname into v_name from pg_constraint
   where conrelid = 'public.deal_ledger_entries'::regclass
     and pg_get_constraintdef(oid) ilike '%paid_on is not null%';
  if v_name is not null then execute format('alter table public.deal_ledger_entries drop constraint %I', v_name); end if;
end $$;

-- VAT 미포함 행은 원래 의미 그대로: 0 ≤ received_amount ≤ amount.
-- VAT 포함 행은 amount 를 넘는 입금을 허용한다(부가세액 컬럼이 없어 정확한 상한을 못 둔다 —
-- openRisks 참고. 미수금 계산은 애플리케이션 레이어에서 entry 단위 max(0, amount-received) 로 한다).
alter table public.deal_ledger_entries
  add constraint deal_ledger_entries_received_amount_range_chk
  check (received_amount >= 0 and trunc(received_amount) = received_amount and (vat_included or received_amount <= amount));

-- VAT 미포함 행: 완납 ⟺ received_amount = amount ⟺ paid_on 존재(원래 규약 그대로).
-- VAT 포함 행: amount 와의 정확한 일치가 구조적으로 불가능해 "조금이라도 입금됐으면 입금일 존재"
-- 로 완화한다(정확한 완납 판정은 부가세액 컬럼이 생기기 전까지 미룬다).
alter table public.deal_ledger_entries
  add constraint deal_ledger_entries_paid_on_consistency_chk
  check (
    (not vat_included and ((received_amount = amount and paid_on is not null) or (received_amount < amount and paid_on is null)))
    or
    (vat_included and ((received_amount > 0 and paid_on is not null) or (received_amount = 0 and paid_on is null)))
  );

-- add_deal_ledger_entry 에 vat_included/tax_invoice_issued 두 파라미터를 추가한다.
-- Postgres 는 함수를 전체 파라미터 타입 시그니처로 식별하므로, 기본값이 있어도 파라미터를
-- 추가하면 «다른» 오버로드가 생긴다 — 기존 7-인자 버전을 명시적으로 지워야 둘이 모호하게
-- 공존하지 않는다.
drop function if exists public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date);

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
  -- BBE-240 수용기준: 계약금 중복 입력 방지는 서버측에서 강제한다(UI 비활성화는 힌트일 뿐).
  -- 한 딜당 contract_deposit 행은 최대 1개 — 두 번째 시도는 여기서 막힌다.
  if p_kind = 'contract_deposit' and exists (
    select 1 from public.deal_ledger_entries e
    where e.deal_id = p_deal_id and e.kind = 'contract_deposit'
  ) then
    raise exception 'contract deposit already recorded for this deal' using errcode = '23505';
  end if;
  insert into public.deal_ledger_entries (
    org_id, deal_id, kind, amount, received_amount, occurred_on,
    paid_on, attribution_month, created_by, vat_included, tax_invoice_issued
  ) values (
    v_org_id, p_deal_id, p_kind, p_amount, p_received_amount, p_occurred_on,
    p_paid_on, p_attribution_month, auth.uid(), p_vat_included, p_tax_invoice_issued
  ) returning id into v_entry_id;
  return v_entry_id;
end; $$;

revoke all on function public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean) from public, anon;
grant execute on function public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean) to authenticated;

-- delete_deal_ledger_entry 와 deal_ledger_summary 는 이 마이그레이션에서 건드리지 않는다.
-- deal_ledger_summary.outstanding_total 을 VAT-aware 로 만들지 않은 이유: 앱이 그 컬럼을
-- 오늘 소비하지 않는다 — DealLedgerPanel 이 미수금을 클라이언트에서 entry 단위로 계산한다.

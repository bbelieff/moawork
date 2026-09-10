-- moa-migration-guard: logical_key=144_issue645_case_ownership_registry predecessor=143_issue662_detail_event_kinds digest=75d8cc0f6d628164c19eec0c1d5a1f54fbb8b8d8df1c69076f2b804277d27540 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '144_issue645_case_ownership_registry',
  p_file_name => '144_issue645_case_ownership_registry.sql',
  p_file_digest => '75d8cc0f6d628164c19eec0c1d5a1f54fbb8b8d8df1c69076f2b804277d27540',
  p_expected_predecessor => '143_issue662_detail_event_kinds',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- Issue #646 / #645 round 1. There is deliberately no `cases` table:
-- public.deals.id is the canonical Case id, while board items remain projections.
-- All existing customer rows are left untouched. NOT VALID constraints protect new
-- writes without scanning or rewriting legacy rows.
create unique index if not exists companies_org_id_id_uq
  on public.companies(org_id, id);
create unique index if not exists pipelines_org_id_id_uq
  on public.pipelines(org_id, id);
create unique index if not exists stages_pipeline_id_id_uq
  on public.stages(pipeline_id, id);
create unique index if not exists deals_org_id_id_company_id_uq
  on public.deals(org_id, id, company_id);
create unique index if not exists deals_org_id_id_uq
  on public.deals(org_id, id);

alter table public.deals
  add column if not exists case_version bigint not null default 0;
alter table public.deals drop constraint if exists deals_case_version_nonnegative;
alter table public.deals add constraint deals_case_version_nonnegative check(case_version >= 0) not valid;

alter table public.deals drop constraint if exists deals_org_company_case_fkey;
alter table public.deals add constraint deals_org_company_case_fkey
  foreign key (org_id, company_id) references public.companies(org_id, id)
  on delete set null (company_id) not valid;
alter table public.deals drop constraint if exists deals_org_pipeline_case_fkey;
alter table public.deals add constraint deals_org_pipeline_case_fkey
  foreign key (org_id, pipeline_id) references public.pipelines(org_id, id)
  on delete set null (pipeline_id) not valid;
alter table public.deals drop constraint if exists deals_pipeline_stage_case_fkey;
alter table public.deals add constraint deals_pipeline_stage_case_fkey
  foreign key (pipeline_id, stage_id) references public.stages(pipeline_id, id)
  on delete set null (stage_id) not valid;

alter table public.activities
  add column if not exists company_id uuid,
  add column if not exists request_id uuid,
  add column if not exists payload_digest text,
  add column if not exists type_key text,
  add column if not exists category_key text;
alter table public.activities drop constraint if exists activities_case_company_fkey;
alter table public.activities drop constraint if exists activities_org_case_fkey;
alter table public.activities add constraint activities_org_case_fkey
  foreign key (org_id, deal_id)
  references public.deals(org_id, id) on delete cascade not valid;
alter table public.activities add constraint activities_case_company_fkey
  foreign key (org_id, deal_id, company_id)
  references public.deals(org_id, id, company_id) on delete cascade not valid;
create unique index if not exists activities_org_request_uq
  on public.activities(org_id, request_id) where request_id is not null;

alter table public.deal_document_checklists
  add column if not exists company_id uuid,
  add column if not exists version bigint not null default 0;
alter table public.deal_document_checklists drop constraint if exists checklist_version_nonnegative;
alter table public.deal_document_checklists add constraint checklist_version_nonnegative check(version >= 0) not valid;
alter table public.deal_document_checklists drop constraint if exists deal_checklists_case_company_fkey;
alter table public.deal_document_checklists drop constraint if exists deal_checklists_org_case_fkey;
alter table public.deal_document_checklists add constraint deal_checklists_org_case_fkey
  foreign key (org_id, deal_id)
  references public.deals(org_id, id) on delete cascade not valid;
alter table public.deal_document_checklists add constraint deal_checklists_case_company_fkey
  foreign key (org_id, deal_id, company_id)
  references public.deals(org_id, id, company_id) on delete cascade not valid;

alter table public.deal_ledger_entries
  add column if not exists company_id uuid,
  add column if not exists kind_key text;
alter table public.deal_ledger_entries drop constraint if exists deal_ledger_kind_key_chk;
alter table public.deal_ledger_entries add constraint deal_ledger_kind_key_chk
  check(kind_key is null or kind_key ~ '^ledger\.[a-z0-9_.-]+$') not valid;
alter table public.deal_ledger_entries drop constraint if exists deal_ledger_case_company_fkey;
alter table public.deal_ledger_entries drop constraint if exists deal_ledger_org_case_fkey;
alter table public.deal_ledger_entries add constraint deal_ledger_org_case_fkey
  foreign key (org_id, deal_id)
  references public.deals(org_id, id) on delete cascade not valid;
alter table public.deal_ledger_entries add constraint deal_ledger_case_company_fkey
  foreign key (org_id, deal_id, company_id)
  references public.deals(org_id, id, company_id) on delete cascade not valid;

create table if not exists public.case_operation_receipts (
  org_id uuid not null references public.orgs(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (operation in (
    'case.create', 'case.activity.append', 'case.stage.move', 'case.checklist.mutate',
    'case.task.mutate'
  )),
  actor_id uuid not null references public.users(id) on delete restrict,
  case_id uuid not null,
  company_id uuid not null,
  payload_digest text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (org_id, request_id),
  foreign key (org_id, case_id, company_id)
    references public.deals(org_id, id, company_id) on delete restrict
);

create table if not exists public.case_option_registry (
  domain text not null,
  option_id text not null,
  label text not null,
  legacy_aliases text[] not null default '{}',
  retired boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}',
  primary key (domain, option_id),
  check (domain in ('activity.type', 'activity.category', 'ledger.kind')),
  check (option_id ~ '^[a-z][a-z0-9_.-]*$')
);

insert into public.case_option_registry(
  domain, option_id, label, legacy_aliases, retired, sort_order, metadata
) values
  ('activity.type','activity.status','상태 변경',array['status'],false,10,'{}'),
  ('activity.type','activity.call','통화',array['call'],false,20,'{}'),
  ('activity.type','activity.meeting','미팅',array['meeting'],false,30,'{}'),
  ('activity.type','activity.memo','메모',array['memo'],false,40,'{}'),
  ('activity.type','activity.assignment','담당자 변경',array['assignment'],false,50,'{}'),
  ('activity.type','activity.customer_message','고객 메시지',array[]::text[],false,60,
    '{"provider_dispatch":false,"round":3}'::jsonb),
  ('activity.category','activity.category.workflow','워크플로',array['workflow'],false,10,'{}'),
  ('activity.category','activity.category.conversation','대화',array['conversation'],false,20,'{}'),
  ('activity.category','activity.category.note','메모',array['note'],false,30,'{}'),
  ('activity.category','activity.category.ownership','담당',array['ownership'],false,40,'{}'),
  ('activity.category','activity.category.customer_message','고객 메시지',array[]::text[],false,50,
    '{"provider_dispatch":false,"round":3}'::jsonb),
  ('ledger.kind','ledger.contract_deposit','계약금',array['contract_deposit'],false,10,'{}'),
  ('ledger.kind','ledger.fee','수수료',array['fee'],false,20,'{}')
on conflict (domain, option_id) do update set
  label = excluded.label,
  legacy_aliases = excluded.legacy_aliases,
  retired = excluded.retired,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata;

alter table public.case_operation_receipts enable row level security;
alter table public.case_operation_receipts force row level security;
alter table public.case_option_registry enable row level security;
alter table public.case_option_registry force row level security;
revoke all on table public.case_operation_receipts from public, anon, authenticated, service_role;
revoke all on table public.case_option_registry from public, anon, authenticated, service_role;
grant select on table public.case_option_registry to authenticated;

drop policy if exists case_option_registry_read on public.case_option_registry;
create policy case_option_registry_read on public.case_option_registry
  for select to authenticated using ((select auth.uid()) is not null);

-- Keep the role matrix executable contract in sync with app/src/lib/perm/matrix.ts.
-- These are permission seams only; this migration does not create a new money write.
create or replace function public.perm_baseline()
returns table(
  perm_group text, scope_key text, label text, is_danger boolean,
  allowed_owner boolean, allowed_admin boolean,
  allowed_team_lead boolean, allowed_member boolean
)
language sql immutable
set search_path = ''
as $$
  values
    ('업무','work.view_tabs','탭 보기',false,true,true,true,true),
    ('업무','work.item_upsert','항목 추가·수정',false,true,true,true,true),
    ('업무','work.assign_owner','담당자 지정',false,true,true,true,false),
    ('업무','work.item_delete','항목 삭제',false,true,true,false,false),
    ('업무','work.edit_others_items','다른 사람 담당 건 수정',false,true,true,true,false),
    ('구조','structure.column_manage','컬럼 추가·삭제',false,true,true,false,false),
    ('구조','structure.section_manage','아이템 추가·삭제',false,true,true,false,false),
    ('구조','structure.preset_edit','프리셋 편집',false,true,true,false,false),
    ('구조','structure.shared_view_save','공용 뷰 저장',false,true,true,true,false),
    ('구조','structure.tab_manage','탭 순서·이름',false,true,true,false,false),
    ('자동화 · 발송','automation.view','자동화 규칙 보기',false,true,true,true,true),
    ('자동화 · 발송','automation.edit','자동화 규칙 편집',false,true,true,false,false),
    ('자동화 · 발송','automation.send_message','문자·알림톡 발송',false,true,true,true,false),
    ('자동화 · 발송','automation.template_edit','발송 템플릿 편집',false,true,true,false,false),
    ('조직 · 공지','org.view_chart','조직도 보기',false,true,true,true,true),
    ('조직 · 공지','org.member_manage','조직원 초대·이동',false,true,true,false,false),
    ('조직 · 공지','org.grant_permission','권한 부여',false,true,true,false,false),
    ('조직 · 공지','org.dept_notice','부서 공지 발송',false,true,true,true,false),
    ('조직 · 공지','org.company_notice','전사 공지 발송',false,true,true,false,false),
    ('위험','danger.csv_export','CSV 내보내기',true,true,true,false,false),
    ('위험','danger.bulk_edit_delete','일괄 수정·삭제',true,true,false,false,false),
    ('위험','danger.view_accounting_amount','회계 금액 보기',true,true,true,true,false),
    ('위험','danger.year_end_archive','연말 아카이빙',true,true,false,false,false),
    ('위험','danger.data_import','데이터 가져오기·이관',true,true,false,false,false),
    ('재무','finance.ledger_read','원장 보기',true,true,true,true,false),
    ('재무','finance.ledger_manage','원장 관리',true,true,true,false,false)
$$;

create or replace function public.can_read_case(p_org_id uuid, p_case_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.deals d
      join public.org_members m
        on m.org_id = d.org_id and m.user_id = auth.uid() and m.status = 'active'
      join public.orgs o on o.id = d.org_id and o.status = 'active'
     where d.org_id = p_org_id and d.id = p_case_id
       and public.effective_permission(p_org_id, 'work.view_tabs')
       and (m.role::text in ('owner','admin') or m.scope::text = 'all' or d.assigned_to = auth.uid())
  )
$$;

create or replace function public.can_manage_case(p_org_id uuid, p_case_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.can_read_case(p_org_id, p_case_id)
     and public.effective_permission(p_org_id, 'work.item_upsert')
$$;

-- Preserve the legacy UI entry point during the expand window, but move its
-- authorization and parent/projection integrity to the canonical Case boundary.
create or replace function public.reassign_deal_with_activity(
  p_org_id uuid,
  p_deal_id uuid,
  p_assigned_to uuid
) returns public.deals
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_deal public.deals%rowtype;
  v_from_name text;
  v_to_name text;
begin
  if v_actor is null or not exists (
    select 1
      from public.org_members m
      join public.orgs o on o.id=m.org_id and o.status='active'
     where m.org_id=p_org_id and m.user_id=v_actor and m.status='active'
       and (m.role::text in ('owner','admin') or m.scope::text='all')
  ) then
    raise exception 'deal reassignment is not allowed' using errcode='42501';
  end if;
  if p_assigned_to is not null and not exists (
    select 1 from public.org_members m
     where m.org_id=p_org_id and m.user_id=p_assigned_to and m.status='active'
  ) then
    raise exception 'assignee is not an active member of this organization' using errcode='42501';
  end if;

  select d.* into v_deal
    from public.deals d
    join public.companies c
      on c.org_id=d.org_id and c.id=d.company_id and c.merged_into is null
   where d.org_id=p_org_id and d.id=p_deal_id
     and public.can_manage_case(p_org_id,p_deal_id)
     and (select count(*) from public.items i
           where i.org_id=p_org_id and i.deal_id=p_deal_id and i.deleted_at is null)=1
   for update of d;
  if not found then
    raise exception 'case unavailable' using errcode='42501';
  end if;
  if v_deal.assigned_to is not distinct from p_assigned_to then return v_deal; end if;

  select u.name into v_from_name from public.users u where u.id=v_deal.assigned_to;
  select u.name into v_to_name from public.users u where u.id=p_assigned_to;
  update public.deals set assigned_to=p_assigned_to,updated_at=now()
   where org_id=p_org_id and id=p_deal_id returning * into v_deal;
  insert into public.activities(
    org_id,deal_id,company_id,type,type_key,category_key,content,actor
  ) values (
    p_org_id,p_deal_id,v_deal.company_id,'assignment','activity.assignment',
    'activity.category.ownership',
    '담당자: ' || coalesce(v_from_name,'미배정') || ' → ' || coalesce(v_to_name,'미배정'),
    v_actor
  );
  return v_deal;
end
$$;
revoke all on function public.reassign_deal_with_activity(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reassign_deal_with_activity(uuid,uuid,uuid) to authenticated;

create or replace function public.can_read_case_ledger(p_org_id uuid, p_case_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.can_read_case(p_org_id, p_case_id)
     and public.effective_permission(p_org_id, 'finance.ledger_read')
$$;

create or replace function public.can_manage_case_ledger(p_org_id uuid, p_case_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.can_read_case(p_org_id, p_case_id)
     and public.effective_permission(p_org_id, 'finance.ledger_manage')
$$;

-- PR-A is expand-compatible: old authenticated clients may still use direct Activity/
-- Checklist writes until hardening migration 145, but those writes inherit the parent Case scope.
alter table public.activities enable row level security;
alter table public.activities force row level security;
drop policy if exists activities_rw on public.activities;
drop policy if exists case_activities_read on public.activities;
drop policy if exists case_activities_insert on public.activities;
drop policy if exists case_activities_update on public.activities;
drop policy if exists case_activities_delete on public.activities;
create policy case_activities_read on public.activities for select to authenticated
  using (public.can_read_case(org_id, deal_id));
create policy case_activities_insert on public.activities for insert to authenticated
  with check (public.can_manage_case(org_id, deal_id));
create policy case_activities_update on public.activities for update to authenticated
  using (public.can_manage_case(org_id, deal_id))
  with check (public.can_manage_case(org_id, deal_id));
create policy case_activities_delete on public.activities for delete to authenticated
  using (public.can_manage_case(org_id, deal_id));
revoke all on table public.activities from public, anon, service_role;

alter table public.deal_document_checklists enable row level security;
alter table public.deal_document_checklists force row level security;
drop policy if exists deal_checklists_org on public.deal_document_checklists;
drop policy if exists case_checklists_read on public.deal_document_checklists;
drop policy if exists case_checklists_insert on public.deal_document_checklists;
drop policy if exists case_checklists_update on public.deal_document_checklists;
drop policy if exists case_checklists_delete on public.deal_document_checklists;
create policy case_checklists_read on public.deal_document_checklists for select to authenticated
  using (public.can_read_case(org_id, deal_id));
create policy case_checklists_insert on public.deal_document_checklists for insert to authenticated
  with check (public.can_manage_case(org_id, deal_id));
create policy case_checklists_update on public.deal_document_checklists for update to authenticated
  using (public.can_manage_case(org_id, deal_id))
  with check (public.can_manage_case(org_id, deal_id));
create policy case_checklists_delete on public.deal_document_checklists for delete to authenticated
  using (public.can_manage_case(org_id, deal_id));
revoke all on table public.deal_document_checklists from public, anon, service_role;

alter table public.deal_ledger_entries enable row level security;
alter table public.deal_ledger_entries force row level security;
drop policy if exists deal_ledger_entries_select on public.deal_ledger_entries;
create policy deal_ledger_entries_select on public.deal_ledger_entries for select to authenticated
  using (public.can_read_case_ledger(org_id, deal_id));
revoke all on table public.deal_ledger_entries from public, anon, service_role;

-- Mixed old/new clients cannot bypass optimistic concurrency: legacy direct writes
-- advance the same versions, while canonical RPCs supply exactly old+1.
create or replace function public.case_version_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.case_version <> 0 then
      raise exception 'case version must start at zero' using errcode='42501';
    end if;
  elsif (new.company_id,new.pipeline_id,new.stage_id,new.assigned_to)
       is distinct from (old.company_id,old.pipeline_id,old.stage_id,old.assigned_to) then
    if new.case_version <= old.case_version then new.case_version := old.case_version + 1;
    elsif new.case_version <> old.case_version + 1 then
      raise exception 'case version must advance exactly once' using errcode='40001';
    end if;
  elsif new.case_version is distinct from old.case_version then
    raise exception 'case version is server managed' using errcode='42501';
  end if;
  return new;
end
$$;
drop trigger if exists case_version_before_update on public.deals;
create trigger case_version_before_update before insert or update
  on public.deals for each row execute function public.case_version_before_update();

create or replace function public.checklist_version_before_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.version not in (0,1) then
      raise exception 'checklist version must start at one' using errcode='42501';
    end if;
    new.version := 1;
  elsif (new.company_id,new.product_id,new.items_jsonb) is distinct from (old.company_id,old.product_id,old.items_jsonb) then
    if new.version <= old.version then new.version := old.version + 1;
    elsif new.version <> old.version + 1 then
      raise exception 'checklist version must advance exactly once' using errcode='40001';
    end if;
  elsif new.version is distinct from old.version then
    raise exception 'checklist version is server managed' using errcode='42501';
  end if;
  return new;
end
$$;
drop trigger if exists checklist_version_before_write on public.deal_document_checklists;
create trigger checklist_version_before_write before insert or update
  on public.deal_document_checklists for each row execute function public.checklist_version_before_write();

-- Compatibility read alias now means read only. Existing money mutation RPCs are
-- narrowed to the manage seam without adding a new money operation.
create or replace function public.can_access_deal_ledger(p_deal_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.deals d
     where d.id=p_deal_id and public.can_read_case_ledger(d.org_id,d.id)
  )
$$;

create or replace function public.add_deal_ledger_entry(
  p_deal_id uuid, p_kind text, p_amount numeric, p_received_amount numeric,
  p_occurred_on date, p_paid_on date, p_attribution_month date,
  p_vat_included boolean default false, p_tax_invoice_issued boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_case public.deals%rowtype; v_entry_id uuid; v_kind text; v_kind_key text;
begin
  select d.* into v_case from public.deals d where d.id=p_deal_id for update;
  if not found or auth.uid() is null or v_case.company_id is null
     or not public.can_manage_case_ledger(v_case.org_id,p_deal_id) then
    raise exception 'deal ledger manage denied' using errcode='42501';
  end if;
  select o.option_id,coalesce(o.legacy_aliases[1],o.option_id) into v_kind_key,v_kind
    from public.case_option_registry o
   where o.domain='ledger.kind' and not o.retired
     and (o.option_id=p_kind or p_kind=any(o.legacy_aliases));
  if v_kind is null then raise exception 'ledger kind unavailable' using errcode='22023'; end if;
  if v_kind='contract_deposit' and exists (
    select 1 from public.deal_ledger_entries e where e.deal_id=p_deal_id and e.kind='contract_deposit'
  ) then raise exception 'contract deposit already recorded for this deal' using errcode='23505'; end if;
  insert into public.deal_ledger_entries(
    org_id,deal_id,company_id,kind,kind_key,amount,received_amount,occurred_on,paid_on,
    attribution_month,created_by,vat_included,tax_invoice_issued
  ) values (
    v_case.org_id,p_deal_id,v_case.company_id,v_kind,v_kind_key,p_amount,p_received_amount,p_occurred_on,p_paid_on,
    p_attribution_month,auth.uid(),p_vat_included,p_tax_invoice_issued
  ) returning id into v_entry_id;
  return v_entry_id;
end
$$;

create or replace function public.delete_deal_ledger_entry(p_entry_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org_id uuid; v_case_id uuid;
begin
  select e.org_id,e.deal_id into v_org_id,v_case_id
    from public.deal_ledger_entries e where e.id=p_entry_id for update;
  if not found then raise exception 'ledger entry not found' using errcode='P0002'; end if;
  if auth.uid() is null or not public.can_manage_case_ledger(v_org_id,v_case_id) then
    raise exception 'deal ledger manage denied' using errcode='42501';
  end if;
  delete from public.deal_ledger_entries where id=p_entry_id;
end
$$;

create or replace function public.deal_ledger_summary(p_deal_id uuid)
returns table(deal_id uuid,entry_count bigint,ledger_total numeric,fee_total numeric,received_total numeric,outstanding_total numeric)
language sql stable security definer set search_path = '' as $$
  select p_deal_id,count(e.id),coalesce(sum(e.amount),0),
    coalesce(sum(e.amount) filter(where e.kind='fee'),0),coalesce(sum(e.received_amount),0),
    coalesce(sum(e.amount-e.received_amount),0)
    from public.deal_ledger_entries e
   where e.deal_id=p_deal_id and public.can_read_case_ledger(e.org_id,e.deal_id)
$$;

create or replace function public.read_case(p_org_id uuid, p_case_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_projection_count bigint;
begin
  if auth.uid() is null or not public.can_read_case(p_org_id, p_case_id) then
    raise exception 'case unavailable' using errcode = '42501';
  end if;
  select count(*) into v_projection_count
    from public.items i
   where i.org_id = p_org_id and i.deal_id = p_case_id and i.deleted_at is null;
  if v_projection_count > 1 then
    raise exception 'case active projection invariant violated' using errcode = '23514';
  end if;
  select jsonb_build_object(
    'case_id', d.id, 'company_id', d.company_id, 'org_id', d.org_id,
    'pipeline_id', d.pipeline_id, 'stage_id', d.stage_id,
    'assigned_to', d.assigned_to, 'title', d.title,
    'version', d.case_version, 'item_id', (
      select i.id from public.items i
       where i.org_id=d.org_id and i.deal_id=d.id and i.deleted_at is null
       limit 1
    )
  ) into v_result
    from public.deals d
   where d.org_id = p_org_id and d.id = p_case_id;
  return v_result;
end
$$;

create or replace function public.create_company_case(
  p_org_id uuid,
  p_company_id uuid,
  p_request_id uuid,
  p_group_id uuid default null
) returns table(case_id uuid, item_id uuid, version bigint, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_company public.companies%rowtype;
  v_projection_count bigint;
  v_payload jsonb;
  v_digest text;
  v_receipt public.case_operation_receipts%rowtype;
  v_old public.company_work_start_requests%rowtype;
  v_old_group uuid;
  v_started record;
begin
  if v_actor is null or p_org_id is null or p_company_id is null or p_request_id is null then
    raise exception 'case create input required' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object('company_id', p_company_id, 'group_id', p_group_id);
  v_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text, 'utf8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));

  select m.role::text, m.scope::text into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id=m.org_id and o.status='active'
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active';
  if not found or not public.effective_permission(p_org_id, 'work.item_upsert') then
    raise exception 'case create permission denied' using errcode='42501';
  end if;
  select c.* into v_company
    from public.companies c
   where c.org_id=p_org_id and c.id=p_company_id and c.merged_into is null
     and (v_role in ('owner','admin') or v_scope='all' or c.assigned_to=v_actor);
  if not found then
    raise exception 'company unavailable' using errcode='42501';
  end if;

  select r.* into v_receipt from public.case_operation_receipts r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    if v_receipt.operation <> 'case.create' or v_receipt.actor_id <> v_actor
       or v_receipt.company_id <> p_company_id or v_receipt.payload_digest <> v_digest then
      raise exception 'case create request mismatch' using errcode = '22023';
    end if;
    select count(*) into v_projection_count
      from public.deals d
      join public.items i on i.org_id=d.org_id and i.deal_id=d.id and i.deleted_at is null
       and i.id=(v_receipt.result->>'item_id')::uuid
     where d.org_id=p_org_id and d.id=v_receipt.case_id and d.company_id=p_company_id
       and not exists (
         select 1 from public.items other
          where other.org_id=d.org_id and other.deal_id=d.id and other.deleted_at is null
            and other.id<>i.id
       );
    if v_projection_count <> 1 then
      raise exception 'case create replay unavailable' using errcode='42501';
    end if;
    return query select v_receipt.case_id,
      (v_receipt.result->>'item_id')::uuid,
      (v_receipt.result->>'version')::bigint, true;
    return;
  end if;

  -- If the rollout-safe v2 request already exists, bind it to its actual group;
  -- never reinterpret the old receipt with a different caller payload.
  select r.* into v_old from public.company_work_start_requests r
   where r.org_id = p_org_id and r.request_id = p_request_id;
  if found then
    select i.group_id into v_old_group from public.items i
     where i.org_id = p_org_id and i.id = v_old.item_id;
    if v_old.actor_id <> v_actor or v_old.company_id <> p_company_id
       or (p_group_id is not null and v_old_group is distinct from p_group_id) then
      raise exception 'case create legacy request mismatch' using errcode = '22023';
    end if;
    select count(*) into v_projection_count
      from public.deals d
      join public.items i on i.org_id=d.org_id and i.deal_id=d.id and i.deleted_at is null
       and i.id=v_old.item_id
     where d.org_id=p_org_id and d.id=v_old.deal_id and d.company_id=p_company_id
       and not exists (
         select 1 from public.items other
          where other.org_id=d.org_id and other.deal_id=d.id and other.deleted_at is null
            and other.id<>i.id
       );
    if v_projection_count <> 1 then
      raise exception 'case create legacy replay unavailable' using errcode='42501';
    end if;
  end if;

  select * into v_started
    from public.start_company_work_v2(p_org_id, p_company_id, p_request_id, p_group_id);
  insert into public.case_operation_receipts(
    org_id, request_id, operation, actor_id, case_id, company_id, payload_digest, result
  ) values (
    p_org_id, p_request_id, 'case.create', v_actor, v_started.deal_id, p_company_id,
    v_digest, jsonb_build_object('item_id', v_started.item_id, 'version', 0)
  );
  return query select v_started.deal_id, v_started.item_id, 0::bigint, v_started.replayed;
end
$$;

create or replace function public.append_case_activity(
  p_org_id uuid,
  p_case_id uuid,
  p_request_id uuid,
  p_type_id text,
  p_category_id text,
  p_content text default null
) returns table(activity_id uuid, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.deals%rowtype;
  v_payload jsonb;
  v_digest text;
  v_receipt public.case_operation_receipts%rowtype;
  v_activity_id uuid;
  v_legacy_type text;
begin
  if v_actor is null or p_request_id is null or p_case_id is null then
    raise exception 'activity input required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select d.* into v_case from public.deals d
   where d.org_id = p_org_id and d.id = p_case_id for update;
  if not found or not exists (
    select 1 from public.companies c where c.org_id=p_org_id and c.id=v_case.company_id and c.merged_into is null
  ) or (select count(*) from public.items i where i.org_id=p_org_id and i.deal_id=p_case_id and i.deleted_at is null) <> 1
    or not public.can_manage_case(p_org_id, p_case_id) then
    raise exception 'case unavailable' using errcode = '42501';
  end if;
  v_payload := jsonb_build_object('case_id',p_case_id,'type_id',p_type_id,'category_id',p_category_id,'content',p_content);
  v_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  select r.* into v_receipt from public.case_operation_receipts r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_receipt.operation <> 'case.activity.append' or v_receipt.actor_id <> v_actor
       or v_receipt.case_id <> p_case_id or v_receipt.company_id <> v_case.company_id
       or v_receipt.payload_digest <> v_digest then
      raise exception 'activity request mismatch' using errcode = '22023';
    end if;
    return query select (v_receipt.result->>'activity_id')::uuid, true;
    return;
  end if;
  if not exists (select 1 from public.case_option_registry o where o.domain='activity.type' and o.option_id=p_type_id and not o.retired)
     or not exists (select 1 from public.case_option_registry o where o.domain='activity.category' and o.option_id=p_category_id and not o.retired) then
    raise exception 'activity option unavailable' using errcode = '22023';
  end if;
  select coalesce(o.legacy_aliases[1], o.option_id) into v_legacy_type
    from public.case_option_registry o where o.domain='activity.type' and o.option_id=p_type_id;
  insert into public.activities(
    org_id,deal_id,company_id,type,type_key,category_key,content,actor,request_id,payload_digest
  ) values (
    p_org_id,p_case_id,v_case.company_id,v_legacy_type,p_type_id,p_category_id,p_content,v_actor,p_request_id,v_digest
  ) returning id into v_activity_id;
  insert into public.case_operation_receipts(
    org_id,request_id,operation,actor_id,case_id,company_id,payload_digest,result
  ) values (
    p_org_id,p_request_id,'case.activity.append',v_actor,p_case_id,v_case.company_id,v_digest,
    jsonb_build_object('activity_id',v_activity_id)
  );
  return query select v_activity_id, false;
end
$$;

create or replace function public.move_case_stage_with_activity(
  p_org_id uuid,
  p_case_id uuid,
  p_stage_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_content text default null
) returns table(case_id uuid, version bigint, activity_id uuid, stage_id uuid, pipeline_id uuid, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.deals%rowtype;
  v_payload jsonb;
  v_digest text;
  v_receipt public.case_operation_receipts%rowtype;
  v_activity record;
  v_content text;
  v_pipeline_id uuid;
begin
  if v_actor is null or p_request_id is null or p_expected_version is null then
    raise exception 'case move input required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select d.* into v_case from public.deals d
   where d.org_id=p_org_id and d.id=p_case_id for update;
  if not found or not exists (
    select 1 from public.companies c where c.org_id=p_org_id and c.id=v_case.company_id and c.merged_into is null
  ) or (select count(*) from public.items i where i.org_id=p_org_id and i.deal_id=p_case_id and i.deleted_at is null) <> 1
    or not public.can_manage_case(p_org_id,p_case_id) then
    raise exception 'case unavailable' using errcode='42501';
  end if;
  -- p_content is a compatibility input only. Retry identity is immutable even if the
  -- caller rereads the already-moved Case after a committed response is lost.
  v_payload := jsonb_build_object('case_id',p_case_id,'stage_id',p_stage_id,'expected_version',p_expected_version);
  v_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  select r.* into v_receipt from public.case_operation_receipts r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_receipt.operation <> 'case.stage.move' or v_receipt.actor_id <> v_actor
       or v_receipt.case_id <> p_case_id or v_receipt.company_id <> v_case.company_id
       or v_receipt.payload_digest <> v_digest then
      raise exception 'case move request mismatch' using errcode='22023';
    end if;
    return query select p_case_id,(v_receipt.result->>'version')::bigint,
      (v_receipt.result->>'activity_id')::uuid,(v_receipt.result->>'stage_id')::uuid,
      (v_receipt.result->>'pipeline_id')::uuid,true;
    return;
  end if;
  select s.pipeline_id into v_pipeline_id
    from public.stages s join public.pipelines p on p.id=s.pipeline_id
   where s.id=p_stage_id and p.org_id=p_org_id;
  if v_pipeline_id is null then raise exception 'case stage unavailable' using errcode='42501'; end if;
  if v_case.case_version <> p_expected_version then
    raise exception 'case version conflict' using errcode='40001';
  end if;
  select coalesce((select s.name from public.stages s where s.id=v_case.stage_id),'미지정')
         || ' → ' || s.name into v_content
    from public.stages s where s.id=p_stage_id;
  update public.deals set stage_id=p_stage_id, pipeline_id=v_pipeline_id,
    case_version=case_version+1,updated_at=now()
   where org_id=p_org_id and id=p_case_id;
  select * into v_activity from public.append_case_activity(
    p_org_id,p_case_id,gen_random_uuid(),'activity.status','activity.category.workflow',v_content
  );
  insert into public.case_operation_receipts(
    org_id,request_id,operation,actor_id,case_id,company_id,payload_digest,result
  ) values (
    p_org_id,p_request_id,'case.stage.move',v_actor,p_case_id,v_case.company_id,v_digest,
    jsonb_build_object('version',p_expected_version+1,'activity_id',v_activity.activity_id,
      'stage_id',p_stage_id,'pipeline_id',v_pipeline_id)
  );
  return query select p_case_id,p_expected_version+1,v_activity.activity_id,p_stage_id,v_pipeline_id,false;
end
$$;

create or replace function public.mutate_case_checklist(
  p_org_id uuid,
  p_case_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_product_id text,
  p_items jsonb
) returns table(case_id uuid, version bigint, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.deals%rowtype;
  v_current_version bigint;
  v_current_company uuid;
  v_current_product text;
  v_current_items jsonb := '[]'::jsonb;
  v_has_checklist boolean := false;
  v_result_version bigint;
  v_payload jsonb;
  v_digest text;
  v_receipt public.case_operation_receipts%rowtype;
begin
  if v_actor is null or p_request_id is null or p_expected_version is null
     or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'case checklist input required' using errcode='22023';
  end if;
  if jsonb_array_length(p_items) > 200 or length(coalesce(p_product_id,'')) > 200
     or exists (
       select 1 from jsonb_array_elements(p_items) e
        where jsonb_typeof(e) <> 'object'
           or (select count(*) from jsonb_object_keys(e)) <> 4
           or exists (select 1 from jsonb_object_keys(e) k where k not in ('id','label','checked','order'))
           or jsonb_typeof(e->'id') <> 'string' or length(e->>'id') not between 1 and 200
           or jsonb_typeof(e->'label') <> 'string' or length(trim(e->>'label')) not between 1 and 500
           or jsonb_typeof(e->'checked') <> 'boolean'
           or jsonb_typeof(e->'order') <> 'number' or (e->>'order') !~ '^[0-9]+$'
           or (e->>'order')::integer not between 0 and 199
     ) or (select count(distinct e->>'id') from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items)
       or (select count(distinct (e->>'order')::integer) from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items)
       or (jsonb_array_length(p_items) > 0 and (
         (select min((e->>'order')::integer) from jsonb_array_elements(p_items) e) <> 0
         or (select max((e->>'order')::integer) from jsonb_array_elements(p_items) e) <> jsonb_array_length(p_items)-1
       )) then
    raise exception 'case checklist schema invalid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select d.* into v_case from public.deals d where d.org_id=p_org_id and d.id=p_case_id for update;
  if not found or not exists (
    select 1 from public.companies c where c.org_id=p_org_id and c.id=v_case.company_id and c.merged_into is null
  ) or (select count(*) from public.items i where i.org_id=p_org_id and i.deal_id=p_case_id and i.deleted_at is null) <> 1
    or not public.can_manage_case(p_org_id,p_case_id) then
    raise exception 'case unavailable' using errcode='42501';
  end if;
  v_payload := jsonb_build_object('case_id',p_case_id,'expected_version',p_expected_version,'product_id',p_product_id,'items',p_items);
  v_digest := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_payload::text,'utf8'),'sha256'),'hex');
  select r.* into v_receipt from public.case_operation_receipts r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_receipt.operation <> 'case.checklist.mutate' or v_receipt.actor_id <> v_actor
       or v_receipt.case_id <> p_case_id or v_receipt.company_id <> v_case.company_id
       or v_receipt.payload_digest <> v_digest then
      raise exception 'case checklist request mismatch' using errcode='22023';
    end if;
    return query select p_case_id,(v_receipt.result->>'version')::bigint,true;
    return;
  end if;
  select c.version,c.company_id,c.product_id,c.items_jsonb
    into v_current_version,v_current_company,v_current_product,v_current_items
    from public.deal_document_checklists c
   where c.org_id=p_org_id and c.deal_id=p_case_id for update;
  v_has_checklist := found;
  v_current_version := coalesce(v_current_version,0);
  if v_current_version <> p_expected_version then
    raise exception 'case checklist version conflict' using errcode='40001';
  end if;
  if v_has_checklist and v_current_company is not distinct from v_case.company_id
     and v_current_product is not distinct from p_product_id and v_current_items = p_items then
    v_result_version := v_current_version;
  elsif v_has_checklist then
    update public.deal_document_checklists set
      company_id=v_case.company_id,product_id=p_product_id,items_jsonb=p_items,
      version=v_current_version+1,updated_at=now()
     where org_id=p_org_id and deal_id=p_case_id;
    v_result_version := v_current_version+1;
  elsif p_product_id is null and p_items = '[]'::jsonb then
    v_result_version := 0;
  else
    insert into public.deal_document_checklists(
      org_id,deal_id,company_id,product_id,items_jsonb,version,updated_at
    ) values (p_org_id,p_case_id,v_case.company_id,p_product_id,p_items,1,now());
    v_result_version := 1;
  end if;
  insert into public.case_operation_receipts(
    org_id,request_id,operation,actor_id,case_id,company_id,payload_digest,result
  ) values (
    p_org_id,p_request_id,'case.checklist.mutate',v_actor,p_case_id,v_case.company_id,v_digest,
    jsonb_build_object('version',v_result_version)
  );
  return query select p_case_id,v_result_version,false;
end
$$;

create or replace function public.mutate_case_task_with_activity(
  p_org_id uuid,
  p_case_id uuid,
  p_request_id uuid,
  p_patch jsonb
) returns table(activity_id uuid, replayed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_case public.deals%rowtype;
  v_payload jsonb;
  v_digest text;
  v_receipt public.case_operation_receipts%rowtype;
  v_activity_id uuid;
  v_content text;
  v_store_patch jsonb;
  v_due_date text;
begin
  if v_actor is null or p_org_id is null or p_case_id is null
     or p_request_id is null or p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'case task input required' using errcode='22023';
  end if;

  if (select count(*) from jsonb_object_keys(p_patch)) = 1
     and p_patch->>'task_status' = 'done'
     and not (p_patch ? 'due_date')
     and not (p_patch ? 'task_completed_at') then
    v_store_patch := p_patch || jsonb_build_object(
      'task_completed_at', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    v_content := '오늘 할 일을 완료했어요';
  elsif (select count(*) from jsonb_object_keys(p_patch)) = 3
     and jsonb_typeof(p_patch->'due_date') = 'string'
     and p_patch->'task_status' = 'null'::jsonb
     and p_patch->'task_completed_at' = 'null'::jsonb then
    v_due_date := p_patch->>'due_date';
    if v_due_date !~ '^\d{4}-\d{2}-\d{2}$'
       or to_char(v_due_date::date, 'YYYY-MM-DD') <> v_due_date then
      raise exception 'case task patch invalid' using errcode='22023';
    end if;
    v_store_patch := p_patch;
    v_content := '오늘 할 일을 ' || v_due_date || '로 연기했어요';
  else
    raise exception 'case task patch invalid' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || ':' || p_request_id::text, 0));
  select d.* into v_case
    from public.deals d
    join public.companies c
      on c.org_id=d.org_id and c.id=d.company_id and c.merged_into is null
   where d.org_id=p_org_id and d.id=p_case_id
     and public.can_manage_case(p_org_id,p_case_id)
     and (select count(*) from public.items i
           where i.org_id=p_org_id and i.deal_id=p_case_id and i.deleted_at is null)=1
   for update of d;
  if not found then
    raise exception 'case unavailable' using errcode='42501';
  end if;

  v_payload := jsonb_build_object('case_id',p_case_id,'patch',p_patch);
  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_payload::text,'utf8'),'sha256'),
    'hex'
  );
  select r.* into v_receipt from public.case_operation_receipts r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_receipt.operation <> 'case.task.mutate' or v_receipt.actor_id <> v_actor
       or v_receipt.case_id <> p_case_id or v_receipt.company_id <> v_case.company_id
       or v_receipt.payload_digest <> v_digest then
      raise exception 'case task request mismatch' using errcode='22023';
    end if;
    return query select (v_receipt.result->>'activity_id')::uuid, true;
    return;
  end if;

  update public.deals
     set custom=coalesce(custom,'{}'::jsonb) || v_store_patch,
         updated_at=now()
   where org_id=p_org_id and id=p_case_id;
  insert into public.activities(
    org_id,deal_id,company_id,type,type_key,category_key,content,actor,request_id,payload_digest
  ) values (
    p_org_id,p_case_id,v_case.company_id,'status','activity.status',
    'activity.category.workflow',v_content,v_actor,p_request_id,v_digest
  ) returning id into v_activity_id;
  insert into public.case_operation_receipts(
    org_id,request_id,operation,actor_id,case_id,company_id,payload_digest,result
  ) values (
    p_org_id,p_request_id,'case.task.mutate',v_actor,p_case_id,v_case.company_id,v_digest,
    jsonb_build_object('activity_id',v_activity_id)
  );
  return query select v_activity_id, false;
end
$$;

revoke all on function public.can_read_case(uuid,uuid), public.can_manage_case(uuid,uuid),
  public.can_read_case_ledger(uuid,uuid), public.can_manage_case_ledger(uuid,uuid),
  public.read_case(uuid,uuid), public.create_company_case(uuid,uuid,uuid,uuid),
  public.append_case_activity(uuid,uuid,uuid,text,text,text),
  public.move_case_stage_with_activity(uuid,uuid,uuid,bigint,uuid,text),
  public.mutate_case_checklist(uuid,uuid,bigint,uuid,text,jsonb),
  public.mutate_case_task_with_activity(uuid,uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.case_version_before_update(),
  public.checklist_version_before_write(),
  public.can_access_deal_ledger(uuid),
  public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean),
  public.delete_deal_ledger_entry(uuid), public.deal_ledger_summary(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.can_read_case(uuid,uuid), public.can_manage_case(uuid,uuid),
  public.can_read_case_ledger(uuid,uuid), public.can_manage_case_ledger(uuid,uuid),
  public.read_case(uuid,uuid), public.create_company_case(uuid,uuid,uuid,uuid),
  public.append_case_activity(uuid,uuid,uuid,text,text,text),
  public.move_case_stage_with_activity(uuid,uuid,uuid,bigint,uuid,text),
  public.mutate_case_checklist(uuid,uuid,bigint,uuid,text,jsonb),
  public.mutate_case_task_with_activity(uuid,uuid,uuid,jsonb)
  to authenticated;
grant execute on function public.can_access_deal_ledger(uuid),
  public.add_deal_ledger_entry(uuid,text,numeric,numeric,date,date,date,boolean,boolean),
  public.delete_deal_ledger_entry(uuid), public.deal_ledger_summary(uuid)
  to authenticated;

do $$
begin
  if (select count(*) from public.case_option_registry) <> 13 then
    raise exception '144: stable option registry cardinality mismatch';
  end if;
  if not exists (select 1 from public.perm_baseline() where scope_key='finance.ledger_read')
     or not exists (select 1 from public.perm_baseline() where scope_key='finance.ledger_manage') then
    raise exception '144: finance permission seam missing';
  end if;
end
$$;

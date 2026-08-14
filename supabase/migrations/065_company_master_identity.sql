-- BBE-125: company master identity and atomic contract handoff.
-- Additive only. Existing companies/deals rows and historic migrations stay untouched.

alter table public.companies
  add column if not exists biz_no text,
  add column if not exists business_type text,
  add column if not exists industry text,
  add column if not exists region_sido text,
  add column if not exists region_sigungu text,
  add column if not exists merged_into uuid references public.companies(id) on delete restrict,
  add column if not exists created_from text not null default 'manual',
  add column if not exists normalized_name text generated always as (
    lower(regexp_replace(
      replace(replace(replace(name, '주식회사', ''), '㈜', ''), '(주)', ''),
      '[[:space:]]+', '', 'g'
    ))
  ) stored,
  add column if not exists normalized_biz_no text generated always as (
    nullif(regexp_replace(coalesce(biz_no, ''), '[^0-9]', '', 'g'), '')
  ) stored;

alter table public.companies
  drop constraint if exists companies_created_from_check;
alter table public.companies
  add constraint companies_created_from_check
  check (created_from in ('contract_handoff', 'manual', 'import'));

alter table public.companies
  drop constraint if exists companies_biz_no_format_check;
alter table public.companies
  add constraint companies_biz_no_format_check
  check (normalized_biz_no is null or length(normalized_biz_no) = 10);

create unique index if not exists companies_org_biz_no_active_uidx
  on public.companies(org_id, normalized_biz_no)
  where normalized_biz_no is not null and merged_into is null;

create index if not exists companies_org_normalized_name_owner_idx
  on public.companies(org_id, normalized_name, lower(btrim(owner_name)))
  where merged_into is null;

create table if not exists public.company_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source_company_id uuid not null references public.companies(id) on delete cascade,
  candidate_company_id uuid not null references public.companies(id) on delete restrict,
  status text not null default 'needs_review'
    check (status in ('needs_review', 'distinct', 'merged')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.users(id),
  unique(source_company_id, candidate_company_id),
  check (source_company_id <> candidate_company_id)
);

alter table public.company_duplicate_reviews enable row level security;
drop policy if exists company_duplicate_reviews_select on public.company_duplicate_reviews;
create policy company_duplicate_reviews_select
  on public.company_duplicate_reviews for select
  to authenticated
  using (
    public.is_org_member(org_id)
    and (
      public.org_role(org_id) in ('owner', 'admin')
      or public.org_scope(org_id) = 'all'
      or (
        exists (
          select 1 from public.companies source_company
           where source_company.id = source_company_id
             and source_company.org_id = org_id
             and source_company.assigned_to = auth.uid()
        )
        and exists (
          select 1 from public.companies candidate_company
           where candidate_company.id = candidate_company_id
             and candidate_company.org_id = org_id
             and candidate_company.assigned_to = auth.uid()
        )
      )
    )
  );

revoke all on table public.company_duplicate_reviews from public, anon, authenticated;
grant select on table public.company_duplicate_reviews to authenticated;

create or replace function public.handoff_company_to_work(
  p_org_id uuid,
  p_deal_id uuid,
  p_name text,
  p_biz_no text default null,
  p_owner_name text default null,
  p_business_type text default null,
  p_industry text default null,
  p_region_sido text default null,
  p_region_sigungu text default null,
  p_phone text default null,
  p_founded_on date default null,
  p_revenue numeric default null,
  p_company_id uuid default null
) returns table(deal_id uuid, company_id uuid, mode text, duplicate_candidate_ids uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_assigned_to uuid;
  v_deal_id uuid := p_deal_id;
  v_company_id uuid;
  v_candidates uuid[] := '{}'::uuid[];
  v_biz_no text := nullif(regexp_replace(coalesce(p_biz_no, ''), '[^0-9]', '', 'g'), '');
  v_normalized_name text := lower(regexp_replace(
    replace(replace(replace(coalesce(p_name, ''), '주식회사', ''), '㈜', ''), '(주)', ''),
    '[[:space:]]+', '', 'g'
  ));
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'company name required' using errcode = '22023';
  end if;
  if v_biz_no is not null and length(v_biz_no) <> 10 then
    raise exception 'business registration number must contain 10 digits' using errcode = '22023';
  end if;

  select m.role::text, m.scope::text
    into v_role, v_scope
    from public.org_members m
   where m.org_id = p_org_id
     and m.user_id = v_actor
     and m.status = 'active';
  if not found then
    raise exception 'active membership required' using errcode = '42501';
  end if;

  if v_deal_id is null then
    insert into public.deals(org_id, assigned_to, title)
    values (p_org_id, v_actor, btrim(p_name))
    returning id, assigned_to into v_deal_id, v_assigned_to;
  else
    select d.assigned_to
      into v_assigned_to
      from public.deals d
     where d.id = v_deal_id
       and d.org_id = p_org_id
     for update;
    if not found or not (
      v_role in ('owner', 'admin') or v_scope = 'all' or v_assigned_to = v_actor
    ) then
      raise exception 'deal unavailable' using errcode = '42501';
    end if;
  end if;

  if p_company_id is not null then
    select c.id
      into v_company_id
      from public.companies c
     where c.id = p_company_id
       and c.org_id = p_org_id
       and c.merged_into is null
       and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor);
    if not found then
      raise exception 'company unavailable' using errcode = '42501';
    end if;
    update public.deals set company_id = v_company_id where id = v_deal_id and org_id = p_org_id;
    return query select v_deal_id, v_company_id, 'existing'::text, v_candidates;
    return;
  end if;

  if v_biz_no is not null then
    select c.id
      into v_company_id
      from public.companies c
     where c.org_id = p_org_id
       and c.normalized_biz_no = v_biz_no
       and c.merged_into is null
       and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor)
     order by c.created_at, c.id
     limit 1;

    if v_company_id is null and exists (
      select 1
        from public.companies c
       where c.org_id = p_org_id
         and c.normalized_biz_no = v_biz_no
         and c.merged_into is null
    ) then
      raise exception 'company unavailable' using errcode = '42501';
    end if;
  end if;

  if v_company_id is not null then
    update public.deals set company_id = v_company_id where id = v_deal_id and org_id = p_org_id;
    return query select v_deal_id, v_company_id, 'existing'::text, v_candidates;
    return;
  end if;

  if nullif(btrim(p_owner_name), '') is not null then
    -- Serialize suspected-identity discovery across different deals. The deal row lock
    -- above is insufficient because two handoffs can target different deals. Locking
    -- the tenant row keeps D40's separate-company behavior while ensuring the second
    -- transaction observes the first company and records a review relation.
    perform 1
      from public.orgs o
     where o.id = p_org_id
       for update;

    select coalesce(array_agg(c.id order by c.created_at, c.id), '{}'::uuid[])
      into v_candidates
      from public.companies c
     where c.org_id = p_org_id
       and c.normalized_name = v_normalized_name
       and lower(btrim(c.owner_name)) = lower(btrim(p_owner_name))
       and c.merged_into is null
       and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor);
  end if;

  begin
    insert into public.companies(
      org_id, name, biz_no, business_type, industry, biz_type,
      region_sido, region_sigungu, region, owner_name, phone,
      founded_on, revenue, assigned_to, created_from
    ) values (
      p_org_id, btrim(p_name), p_biz_no, p_business_type, p_industry, p_industry,
      p_region_sido, p_region_sigungu,
      nullif(concat_ws(' ', nullif(btrim(p_region_sido), ''), nullif(btrim(p_region_sigungu), '')), ''),
      p_owner_name, p_phone, p_founded_on, p_revenue, coalesce(v_assigned_to, v_actor),
      'contract_handoff'
    ) returning id into v_company_id;
  exception when unique_violation then
    select c.id
      into v_company_id
      from public.companies c
     where c.org_id = p_org_id
       and c.normalized_biz_no = v_biz_no
       and c.merged_into is null
       and (v_role in ('owner', 'admin') or v_scope = 'all' or c.assigned_to = v_actor)
     order by c.created_at, c.id
     limit 1;
    if v_company_id is null then raise; end if;
    update public.deals set company_id = v_company_id where id = v_deal_id and org_id = p_org_id;
    return query select v_deal_id, v_company_id, 'existing'::text, '{}'::uuid[];
    return;
  end;

  insert into public.company_duplicate_reviews(org_id, source_company_id, candidate_company_id)
  select p_org_id, v_company_id, candidate_id
    from unnest(v_candidates) candidate_id
  on conflict (source_company_id, candidate_company_id) do nothing;

  update public.deals set company_id = v_company_id where id = v_deal_id and org_id = p_org_id;
  return query select
    v_deal_id,
    v_company_id,
    case when cardinality(v_candidates) > 0 then 'created_needs_review' else 'created' end,
    v_candidates;
end;
$$;

revoke all on function public.handoff_company_to_work(
  uuid, uuid, text, text, text, text, text, text, text, text, date, numeric, uuid
) from public, anon, service_role;
grant execute on function public.handoff_company_to_work(
  uuid, uuid, text, text, text, text, text, text, text, text, date, numeric, uuid
) to authenticated;

comment on function public.handoff_company_to_work(
  uuid, uuid, text, text, text, text, text, text, text, text, date, numeric, uuid
) is 'BBE-125 atomic deal create/company upsert/link. Exact biz number reuses; ambiguous name+owner creates a separate review record and never auto-merges.';

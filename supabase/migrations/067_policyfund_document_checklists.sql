create table if not exists public.policyfund_checklist_presets (org_id uuid not null references public.orgs(id) on delete cascade,product_id text not null,items_jsonb jsonb not null default '[]'::jsonb,updated_at timestamptz not null default now(),primary key(org_id,product_id));
create table if not exists public.deal_document_checklists (org_id uuid not null references public.orgs(id) on delete cascade,deal_id uuid not null references public.deals(id) on delete cascade,product_id text,items_jsonb jsonb not null default '[]'::jsonb,updated_at timestamptz not null default now(),primary key(org_id,deal_id));
alter table public.policyfund_checklist_presets enable row level security;
alter table public.deal_document_checklists enable row level security;
create policy checklist_presets_org on public.policyfund_checklist_presets for all to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create policy deal_checklists_org on public.deal_document_checklists for all to authenticated using(public.is_org_member(org_id) and exists(select 1 from public.deals d where d.id=deal_id and d.org_id=org_id)) with check(public.is_org_member(org_id) and exists(select 1 from public.deals d where d.id=deal_id and d.org_id=org_id));
grant select,insert,update,delete on public.policyfund_checklist_presets,public.deal_document_checklists to authenticated;

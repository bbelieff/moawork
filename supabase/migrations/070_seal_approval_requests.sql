-- BBE-105: idempotent, audited seal approval requests.
create table if not exists public.seal_approval_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references public.users(id),
  approver_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  unique (org_id, request_id)
);

alter table public.seal_approval_requests enable row level security;
revoke all on public.seal_approval_requests from anon, authenticated;

create or replace function public.request_deal_seal_approval(
  p_org_id uuid,
  p_deal_id uuid,
  p_request_id uuid
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_scope text;
  v_assigned uuid;
  v_approver uuid;
  v_inserted uuid;
begin
  if v_actor is null then raise exception 'seal approval unavailable' using errcode='42501'; end if;
  select m.role,m.scope into v_role,v_scope from public.org_members m
   where m.org_id=p_org_id and m.user_id=v_actor;
  select d.assigned_to into v_assigned from public.deals d
   where d.id=p_deal_id and d.org_id=p_org_id;
  if not found or v_role is null or not (v_role in ('owner','admin') or v_scope='all' or v_assigned=v_actor) then
    raise exception 'seal approval unavailable' using errcode='42501';
  end if;

  select m.user_id into v_approver from public.org_members m
   where m.org_id=p_org_id and m.role in ('owner','admin') and m.user_id<>v_actor
   order by case m.role when 'owner' then 0 else 1 end,m.user_id limit 1;
  if v_approver is null then return 'no_approver'; end if;

  insert into public.seal_approval_requests(org_id,deal_id,request_id,actor_id,approver_id)
  values(p_org_id,p_deal_id,p_request_id,v_actor,v_approver)
  on conflict(org_id,request_id) do nothing returning id into v_inserted;
  if v_inserted is null then return 'already_sent'; end if;

  insert into public.notifications(org_id,user_id,type,title,body,target_type,target_id,actor_id,is_action)
  values(p_org_id,v_approver,'requested','대표 직인 승인 요청이 도착했습니다',
    '업무관리 이관 전에 대표 직인 승인이 필요합니다. 딜 상세에서 확인해 주세요.',
    'deal',p_deal_id,v_actor,true);
  return 'sent';
end $$;

revoke all on function public.request_deal_seal_approval(uuid,uuid,uuid) from public;
grant execute on function public.request_deal_seal_approval(uuid,uuid,uuid) to authenticated;

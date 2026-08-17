-- moa-migration-guard: logical_key=095_bbe172_new_lead_contact_transition predecessor=094_migration_apply_guard digest=bb22a996e9ee9dcbaff4d89039b3fb4439911eedad38efabf3e945a5bbd4a599 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '095_bbe172_new_lead_contact_transition',
  p_file_name => '095_bbe172_new_lead_contact_transition.sql',
  p_file_digest => 'bb22a996e9ee9dcbaff4d89039b3fb4439911eedad38efabf3e945a5bbd4a599',
  p_expected_predecessor => '094_migration_apply_guard',
  p_executor => 'DG-03',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- The BBE-173 three-argument overload remains the canonical deal transition.
-- This item overload is the board consumer: it resolves the canonical deal,
-- delegates the stage/receipt/activity write, then moves the same item into the
-- contact board in the same transaction.
create or replace function public.advance_new_lead_to_contact(
  p_item_id uuid,
  p_request_id uuid
)
returns table(status text, deal_id uuid, company_id uuid, reason text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_org uuid;
  v_deal uuid;
  v_assigned uuid;
  v_source text;
  v_role text;
  v_scope text;
  v_destination uuid;
  v_destination_count bigint;
  v_group uuid;
  v_status text;
  v_company uuid;
  v_reason text;
  v_existing public.contact_pipeline_transitions%rowtype;
begin
  if v_actor is null then
    raise exception 'new lead advance denied' using errcode = '42501';
  end if;

  select i.org_id, i.deal_id, i.assigned_to, b.source
    into v_org, v_deal, v_assigned, v_source
    from public.items i
    join public.boards b on b.org_id = i.org_id and b.id = i.board_id
   where i.id = p_item_id and i.deleted_at is null
   for update of i;

  if not found or v_deal is null then
    raise exception 'new lead item unavailable' using errcode = '22023';
  end if;

  select m.role::text, m.scope::text
    into v_role, v_scope
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = v_org
     and m.user_id = v_actor
     and m.status = 'active'
     and o.status = 'active';

  if not found
     or not public.effective_permission(v_org, 'work.item_upsert')
     or not (v_role in ('owner', 'admin') or v_scope = 'all' or v_assigned = v_actor) then
    raise exception 'new lead advance denied' using errcode = '42501';
  end if;

  select count(*), (array_agg(b.id order by b.id))[1]
    into v_destination_count, v_destination
    from public.boards b
   where b.org_id = v_org and b.source = 'core.default-tab/contact';

  if v_destination_count <> 1 then
    raise exception 'contact destination unavailable' using errcode = '22023';
  end if;

  select g.id into v_group
    from public.board_groups g
   where g.org_id = v_org and g.board_id = v_destination
   order by g.sort_order, g.id
   limit 1;

  if v_group is null then
    raise exception 'contact destination group unavailable' using errcode = '22023';
  end if;

  select * into v_existing
    from public.contact_pipeline_transitions t
   where t.org_id = v_org and t.request_id = p_request_id;

  if found then
    if v_existing.kind <> 'lead_to_contact'
       or v_existing.deal_id is distinct from v_deal
       or (v_existing.source_item_id is not null and v_existing.source_item_id <> p_item_id) then
      raise exception 'transition request target mismatch' using errcode = '22023';
    end if;
    if v_existing.status = 'committed' then
      if v_source <> 'core.default-tab/contact' then
        raise exception 'committed transition destination mismatch' using errcode = '22023';
      end if;
      return query select v_existing.status, v_existing.deal_id,
        (select d.company_id from public.deals d where d.org_id = v_org and d.id = v_deal),
        null::text;
      return;
    end if;
  end if;

  if v_source <> 'core.default-tab/new-lead' then
    raise exception 'new lead source unavailable' using errcode = '22023';
  end if;

  select t.status, t.deal_id, t.company_id, t.reason
    into v_status, v_deal, v_company, v_reason
    from public.advance_new_lead_to_contact(v_org, v_deal, p_request_id) t;

  if v_status = 'committed' then
    update public.contact_pipeline_transitions t
       set source_item_id = p_item_id
     where t.org_id = v_org and t.request_id = p_request_id;

    update public.items i
       set board_id = v_destination, group_id = v_group, updated_at = now()
     where i.org_id = v_org and i.id = p_item_id;

    if not found then
      raise exception 'new lead item move failed' using errcode = 'P0001';
    end if;
  end if;

  return query select v_status, v_deal, v_company, v_reason;
end;
$function$;

revoke all on function public.advance_new_lead_to_contact(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.advance_new_lead_to_contact(uuid, uuid) to authenticated;

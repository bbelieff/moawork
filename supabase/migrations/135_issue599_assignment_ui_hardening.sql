-- moa-migration-guard: logical_key=135_issue599_assignment_ui_hardening predecessor=134_issue599_assignment_lineage_core digest=3e4ba856cc5fdd677f2e24809c697e54da09e61f029dd88de683e6af70f19425 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '135_issue599_assignment_ui_hardening',
  p_file_name => '135_issue599_assignment_ui_hardening.sql',
  p_file_digest => '3e4ba856cc5fdd677f2e24809c697e54da09e61f029dd88de683e6af70f19425',
  p_expected_predecessor => '134_issue599_assignment_lineage_core',
  p_executor => 'DG',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

-- Preserve migration 120's non-owner metadata behavior behind a private helper,
-- while making every legacy assignee/owner write fail before any audit/projection
-- row can change. All assignee changes must use reassign_deal_with_lineage.
alter function public.update_new_lead_intake_meta(uuid, uuid, uuid, jsonb)
  rename to update_new_lead_intake_meta_non_owner_legacy;

revoke all on function public.update_new_lead_intake_meta_non_owner_legacy(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.update_new_lead_intake_meta(
  p_org_id uuid,
  p_deal_id uuid,
  p_request_id uuid,
  p_patch jsonb
) returns table(deal_id uuid, item_id uuid, changed_fields text[], replayed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'new lead meta input invalid' using errcode = '22023';
  end if;
  if p_patch ?| array['owner', 'assigned_to', 'assignee'] then
    raise exception 'assignment owner writes require lineage' using errcode = '42501';
  end if;
  return query
    select *
      from public.update_new_lead_intake_meta_non_owner_legacy(
        p_org_id,
        p_deal_id,
        p_request_id,
        p_patch
      );
end;
$$;

revoke all on function public.update_new_lead_intake_meta(uuid, uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.update_new_lead_intake_meta(uuid, uuid, uuid, jsonb)
  to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.update_new_lead_intake_meta(uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'unsafe_issue599_legacy_wrapper_acl';
  end if;
  if has_function_privilege('anon', 'public.update_new_lead_intake_meta_non_owner_legacy(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.update_new_lead_intake_meta_non_owner_legacy(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.update_new_lead_intake_meta_non_owner_legacy(uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'unsafe_issue599_legacy_helper_acl';
  end if;
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'update_new_lead_intake_meta'
       and p.prosecdef
       and p.proconfig @> array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'unsafe_issue599_legacy_wrapper_search_path';
  end if;
end;
$$;

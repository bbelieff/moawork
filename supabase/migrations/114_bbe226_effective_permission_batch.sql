-- moa-migration-guard: logical_key=114_bbe226_effective_permission_batch predecessor=113_bbe232_notification_replay_dedupe digest=cdd1a2cbe30bec13e94f88887d528afa9ea18ca1286cb944bab1b778d77c9fe3 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '114_bbe226_effective_permission_batch',
  p_file_name => '114_bbe226_effective_permission_batch.sql',
  p_file_digest => 'cdd1a2cbe30bec13e94f88887d528afa9ea18ca1286cb944bab1b778d77c9fe3',
  p_expected_predecessor => '113_bbe232_notification_replay_dedupe',
  p_executor => 'DG-03',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

create or replace function public.effective_permissions(
  p_org_id uuid,
  p_scope_keys text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.member_role;
  v_result jsonb;
begin
  if v_actor is null or p_org_id is null or p_scope_keys is null
     or cardinality(p_scope_keys) = 0 or cardinality(p_scope_keys) > 64 then
    raise exception 'authenticated permission batch required' using errcode = '42501';
  end if;

  select m.role into v_role
    from public.org_members m
    join public.orgs o on o.id = m.org_id
   where m.org_id = p_org_id
     and m.user_id = v_actor
     and m.status = 'active'
     and o.status = 'active';

  if v_role is null then
    raise exception 'active workspace membership required' using errcode = '42501';
  end if;

  with requested as (
    select distinct btrim(value) as scope_key
      from unnest(p_scope_keys) as value
     where nullif(btrim(value), '') is not null
  ), resolved as (
    select r.scope_key,
           case
             when b.scope_key is null then false
             when v_role = 'owner' then true
             when e.decision = 'deny' then false
             when e.decision = 'allow' then true
             else coalesce(o.allowed,
               case v_role
                 when 'admin' then b.allowed_admin
                 when 'team_lead' then b.allowed_team_lead
                 else b.allowed_member
               end)
           end as allowed
      from requested r
      left join public.perm_baseline() b on b.scope_key = r.scope_key
      left join public.org_role_permission_overrides o
        on o.org_id = p_org_id and o.role = v_role and o.scope_key = r.scope_key
      left join public.member_scoped_permission_bindings e
        on e.org_id = p_org_id and e.subject_user_id = v_actor and e.scope_key = r.scope_key
  )
  select coalesce(jsonb_object_agg(scope_key, allowed order by scope_key), '{}'::jsonb)
    into v_result
    from resolved;

  return v_result;
end;
$$;

revoke all on function public.effective_permissions(uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.effective_permissions(uuid, text[]) to authenticated;

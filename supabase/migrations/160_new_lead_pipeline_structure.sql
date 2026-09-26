-- moa-migration-guard: logical_key=160_new_lead_pipeline_structure predecessor=159_row_order_validator_access digest=0a6e75d3b1884eb928a71a7cf2ca52121c5793ffb1039838225b57c72f200379 foundation=false
select public.begin_guarded_migration(
  p_logical_key => '160_new_lead_pipeline_structure', p_file_name => '160_new_lead_pipeline_structure.sql',
  p_file_digest => '0a6e75d3b1884eb928a71a7cf2ca52121c5793ffb1039838225b57c72f200379', p_expected_predecessor => '159_row_order_validator_access',
  p_executor => 'Codex', p_thread_id => 'v17-new-lead-pipeline-structure', p_foundation => false
);

-- Only the branch that INSERTs a brand-new pipeline gets the full structure.
-- An existing pipeline's name is not provenance: never infer or backfill it.
-- Preserve both canonical intake bodies, current auth, receipts and projection guards.
do $patch$
declare
  v_sig text; v_before text; v_after text;
  v_anchor text := $anchor$insert into public.pipelines(org_id,name) values(p_org_id,'기본 파이프라인') returning id into v_pipeline;$anchor$;
begin
  foreach v_sig in array array[
    'public.create_new_lead(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[])',
    'public.create_new_lead_with_founded_month(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,text,uuid[],text)'
  ] loop
    if not exists(select 1 from pg_proc where oid=v_sig::regprocedure and proowner='postgres'::regrole and prosecdef) then
      raise exception 'canonical intake owner boundary changed: %', v_sig;
    end if;
    v_before := pg_get_functiondef(v_sig::regprocedure);
    if (length(v_before)-length(replace(v_before,v_anchor,'')))/length(v_anchor) <> 1 then
      raise exception 'canonical intake pipeline initializer changed: %', v_sig;
    end if;
    v_after := replace(v_before,'v_stage uuid; v_pipeline uuid;', 'v_stage uuid; v_pipeline uuid; v_created_pipeline boolean := false;');
    if v_after = v_before then raise exception 'canonical intake declarations changed'; end if;
    v_after := replace(v_after,v_anchor,v_anchor || $add$
      v_created_pipeline := true;
      insert into public.stages(pipeline_id,name,sort_order,kind) values
        (v_pipeline,'상담',1,'meeting'::public.stage_kind),
        (v_pipeline,'실무',2,'work'::public.stage_kind);$add$);
    -- Marketing is appended by the unchanged initializer; keep its order first.
    v_after := replace(v_after,
      $old$select v_pipeline,'신규고객',coalesce(max(s.sort_order)+1,0),'marketing'::public.stage_kind$old$,
      $new$select v_pipeline,'신규고객',case when v_created_pipeline then 0 else coalesce(max(s.sort_order)+1,0) end,'marketing'::public.stage_kind$new$);
    execute v_after;
  end loop;
end
$patch$;

-- Explicit administrator repair, tied to the selected current new-lead row.
-- Preview performs no writes. Apply only appends the displayed missing kinds;
-- it never moves a deal, changes IDs, renames stages or relaxes any transition.
create or replace function public.repair_new_lead_pipeline_structure(
  p_org_id uuid, p_item_id uuid, p_apply boolean default false,
  p_expected_pipeline_id uuid default null, p_expected_missing text[] default null
) returns table(pipeline_id uuid, pipeline_name text, missing_kinds text[], added_kinds text[])
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := auth.uid(); v_pipeline uuid; v_name text; v_stage uuid;
  v_missing text[] := '{}'; v_added text[] := '{}'; v_kind text; v_order int;
begin
  if v_actor is null or p_apply is null or not exists (
    select 1 from public.org_members m join public.orgs o on o.id=m.org_id
    where m.org_id=p_org_id and m.user_id=v_actor and m.status='active'
      and m.role::text in ('owner','admin') and o.status='active'
  ) or not public.effective_permission(p_org_id,'work.item_upsert')
    or not public.effective_permission(p_org_id,'work.view_tabs') then
    raise exception 'pipeline structure repair denied' using errcode='42501';
  end if;
  select d.pipeline_id,d.stage_id into v_pipeline,v_stage
    from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
    join public.deals d on d.id=i.deal_id and d.org_id=i.org_id
    where i.id=p_item_id and i.org_id=p_org_id and i.deleted_at is null and i.archived_at is null
      and b.source='core.default-tab/new-lead'
    for update of i,d;
  if not found then raise exception 'new lead repair target unavailable' using errcode='22023'; end if;
  if p_apply and p_expected_pipeline_id is distinct from v_pipeline then
    raise exception 'pipeline changed; preview again' using errcode='40001';
  end if;
  -- Row lock serializes two repairs of different items on the same pipeline.
  select p.name into v_name from public.pipelines p where p.id=v_pipeline and p.org_id=p_org_id for update;
  if not found then raise exception 'pipeline unavailable' using errcode='22023'; end if;
  if (select count(*) from public.stages s where s.pipeline_id=v_pipeline and s.kind::text='marketing') <> 1
    or not exists(select 1 from public.stages s where s.id=v_stage and s.pipeline_id=v_pipeline and s.kind::text='marketing')
    or exists(select 1 from public.stages s where s.pipeline_id=v_pipeline and s.kind::text in ('meeting','work') group by s.kind having count(*) > 1) then
    raise exception 'pipeline stages ambiguous or current stage invalid' using errcode='22023';
  end if;
  foreach v_kind in array array['meeting','work'] loop
    if not exists(select 1 from public.stages s where s.pipeline_id=v_pipeline and s.kind::text=v_kind) then
      v_missing := array_append(v_missing,v_kind);
    end if;
  end loop;
  if p_apply and cardinality(v_missing)>0 and v_missing is distinct from p_expected_missing then
    raise exception 'missing stages changed; preview again' using errcode='40001';
  end if;
  if p_apply then
    select coalesce(max(s.sort_order)+1,0) into v_order from public.stages s where s.pipeline_id=v_pipeline;
    foreach v_kind in array v_missing loop
      insert into public.stages(pipeline_id,name,sort_order,kind)
      values(v_pipeline,case v_kind when 'meeting' then '상담' else '실무' end,v_order,v_kind::public.stage_kind);
      v_order := v_order+1;
    end loop;
    v_added := v_missing; v_missing := '{}';
  end if;
  return query select v_pipeline,v_name,v_missing,v_added;
end $$;
revoke all on function public.repair_new_lead_pipeline_structure(uuid,uuid,boolean,uuid,text[]) from public,anon,service_role;
grant execute on function public.repair_new_lead_pipeline_structure(uuid,uuid,boolean,uuid,text[]) to authenticated;

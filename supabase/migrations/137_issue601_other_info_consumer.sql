-- moa-migration-guard: logical_key=137_issue601_other_info_consumer predecessor=136_issue620_app_meta_internal digest=6f6ea28722d007b2fa1f5f9273988055e139f63b74026c0a05ac9cb5982c7526 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '137_issue601_other_info_consumer',
  p_file_name => '137_issue601_other_info_consumer.sql',
  p_file_digest => '6f6ea28722d007b2fa1f5f9273988055e139f63b74026c0a05ac9cb5982c7526',
  p_expected_predecessor => '136_issue620_app_meta_internal',
  p_executor => 'DG-05',
  p_thread_id => '019fe78c-cb3f-79f1-92e5-ea72b7d222e0',
  p_foundation => false
);

alter type public.field_type add value if not exists 'other_info';

-- Keep the existing item_values trigger/RLS path and add only the strict
-- structured branch. No customer rows are rewritten or backfilled.
create or replace function public.board_column_value_is_valid(
  p_org_id uuid, p_item_id uuid, p_column_key text, p_value jsonb
) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_col public.board_columns; v_missing boolean; v_board_source text;
begin
  if p_column_key='__notice_reader_ids' then
    select b.source into v_board_source
      from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
     where i.id=p_item_id and i.org_id=p_org_id;
    if not found or v_board_source<>'core.default-tab/notice' or jsonb_typeof(p_value)<>'array' then return false; end if;
    return not exists(
      select 1 from jsonb_array_elements(p_value) v
       where jsonb_typeof(v)<>'string'
          or not (v#>>'{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
  end if;

  if p_column_key='address_detail' then
    select b.source into v_board_source
      from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
     where i.id=p_item_id and i.org_id=p_org_id;
    return found
      and v_board_source='core.default-tab/new-lead'
      and (p_value is null or p_value='null'::jsonb or jsonb_typeof(p_value)='string');
  end if;

  select c.* into v_col from public.items i join public.board_columns c
    on c.org_id=i.org_id and c.board_id=i.board_id and c.key=p_column_key
   where i.id=p_item_id and i.org_id=p_org_id and c.archived_at is null;
  if not found then return false; end if;
  v_missing:=p_value is null or p_value='null'::jsonb
    or (jsonb_typeof(p_value)='string' and btrim(p_value#>>'{}')='');
  if v_missing then return not v_col.is_required; end if;

  if v_col.type::text='other_info' then
    return jsonb_typeof(p_value)='object'
      and p_value->'version'='1'::jsonb
      and (select count(*) from jsonb_object_keys(p_value))=6
      and p_value ?& array['version','closedHistory','export','intellectualProperty','certifications','otherBusinesses']
      and not exists(
        select 1
          from unnest(array['closedHistory','export','intellectualProperty','certifications','otherBusinesses']) as field(key)
         where jsonb_typeof(p_value->field.key)<>'object'
            or (select count(*) from jsonb_object_keys(p_value->field.key))<>2
            or not (p_value->field.key ?& array['checked','text'])
            or jsonb_typeof(p_value->field.key->'checked')<>'boolean'
            or jsonb_typeof(p_value->field.key->'text')<>'string'
      );
  end if;

  if v_col.validation_jsonb?'minLength' and (jsonb_typeof(p_value)<>'string' or char_length(p_value#>>'{}')<(v_col.validation_jsonb->>'minLength')::int) then return false; end if;
  if v_col.validation_jsonb?'maxLength' and (jsonb_typeof(p_value)<>'string' or char_length(p_value#>>'{}')>(v_col.validation_jsonb->>'maxLength')::int) then return false; end if;
  if v_col.validation_jsonb?'min' and (jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')::numeric<(v_col.validation_jsonb->>'min')::numeric) then return false; end if;
  if v_col.validation_jsonb?'max' and (jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')::numeric>(v_col.validation_jsonb->>'max')::numeric) then return false; end if;
  if v_col.validation_jsonb?'pattern' and (jsonb_typeof(p_value)<>'string' or not (p_value#>>'{}') ~ (v_col.validation_jsonb->>'pattern')) then return false; end if;
  if v_col.validation_jsonb?'allowedValues' and not (v_col.validation_jsonb->'allowedValues' @> jsonb_build_array(p_value)) then return false; end if;
  if v_col.validation_jsonb?'dateMin' and (jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')::timestamptz<(v_col.validation_jsonb->>'dateMin')::timestamptz) then return false; end if;
  if v_col.validation_jsonb?'dateMax' and (jsonb_typeof(p_value)<>'string' or (p_value#>>'{}')::timestamptz>(v_col.validation_jsonb->>'dateMax')::timestamptz) then return false; end if;
  return true;
exception when invalid_regular_expression then return false;
end $$;

revoke all on function public.board_column_value_is_valid(uuid,uuid,text,jsonb)
  from public,anon,authenticated,service_role;

do $$
declare v_proc oid:=to_regprocedure('public.board_column_value_is_valid(uuid,uuid,text,jsonb)');
begin
  if v_proc is null
    or exists(select 1 from pg_proc where oid=v_proc and (not prosecdef or proconfig is distinct from array['search_path=public, pg_temp']::text[]))
    or has_function_privilege('authenticated',v_proc,'EXECUTE')
    or has_function_privilege('anon',v_proc,'EXECUTE')
    or has_function_privilege('service_role',v_proc,'EXECUTE')
    or exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=v_proc and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'unexpected board_column_value_is_valid execution boundary';
  end if;
end $$;

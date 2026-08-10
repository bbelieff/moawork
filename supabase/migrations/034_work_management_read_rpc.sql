-- BBE-29 Phase 1: expose the minimum read-only work-management snapshot.
-- This migration intentionally creates no work tables and no write RPC.

create or replace function public.read_work_management_board(p_org_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_member_role public.member_role;
  v_member_scope public.member_scope;
  v_work_role text;
  v_members jsonb;
begin
  if p_org_id is null
     or auth.uid() is null
     or not public.is_org_member(p_org_id) then
    raise exception 'active workspace membership required'
      using errcode = '42501';
  end if;

  select membership.role, membership.scope
    into strict v_member_role, v_member_scope
  from public.org_members membership
  join public.orgs organization on organization.id = membership.org_id
  where membership.org_id = p_org_id
    and membership.user_id = auth.uid()
    and membership.status = 'active'
    and organization.status = 'active';

  v_work_role := case
    when v_member_role in ('owner', 'admin') then 'manager'
    when v_member_scope = 'all' then 'viewer'
    else 'assignee'
  end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membershipId', membership.org_id::text || ':' || membership.user_id::text,
        'orgId', membership.org_id::text,
        'userId', membership.user_id::text,
        'displayName', coalesce(nullif(btrim(account.name), ''), '구성원'),
        'active', true
      )
      order by
        case membership.role when 'owner' then 0 when 'admin' then 1 else 2 end,
        membership.created_at,
        membership.user_id
    ),
    '[]'::jsonb
  )
    into v_members
  from public.org_members membership
  join public.users account on account.id = membership.user_id
  where membership.org_id = p_org_id
    and membership.status = 'active';

  return jsonb_build_object(
    'board', jsonb_build_object(
      'id', 'work-management:' || p_org_id::text,
      'orgId', p_org_id::text,
      'title', '업무관리',
      'icon', 'work',
      'templateKey', 'work-management',
      'templateVersion', 1,
      'baselineFingerprint', '26a391cc33608c1d87b3d25843745b1d443bc8de4bb2fee6ccab0f094e55012c',
      'currentFingerprint', 'd6b98446a4ec4999753c7b258bc5b6b24cb53f99e5b97176221750b82761f67a'
    ),
    'groups', jsonb_build_array(
      jsonb_build_object('id', 'preparation', 'name', '준비단계', 'color', 'blue', 'count', 0),
      jsonb_build_object('id', 'in-progress', 'name', '진행중', 'color', 'violet', 'count', 0),
      jsonb_build_object('id', 'done', 'name', '완료', 'color', 'teal', 'count', 0)
    ),
    'columns', $columns$[
      {"key":"title","label":"태스크","kind":"title","legacyOrder":1},
      {"key":"assigned_to","label":"담당자","kind":"person","legacyOrder":2},
      {"key":"company","label":"회사명","kind":"virtual","legacyOrder":3,"readOnly":true},
      {"key":"homepage","label":"홈페이지","kind":"virtual","legacyOrder":4,"readOnly":true},
      {"key":"business_type","label":"사업자유형","kind":"select","legacyOrder":5},
      {"key":"founded_year","label":"창업년도","kind":"year","legacyOrder":6},
      {"key":"files","label":"파일","kind":"file","legacyOrder":7},
      {"key":"link","label":"링크","kind":"url","legacyOrder":8},
      {"key":"annual_revenue","label":"연 매출액","kind":"amount","legacyOrder":9},
      {"key":"representative","label":"대표자명","kind":"virtual","legacyOrder":10,"readOnly":true},
      {"key":"email","label":"이메일","kind":"virtual","legacyOrder":11,"readOnly":true},
      {"key":"phone","label":"전화번호","kind":"virtual","legacyOrder":12,"readOnly":true},
      {"key":"industry","label":"업종/업태","kind":"select","legacyOrder":13},
      {"key":"regions","label":"지역","kind":"multiselect","legacyOrder":14},
      {"key":"institution","label":"진행 기관","kind":"select","legacyOrder":15},
      {"key":"product","label":"진행 상품","kind":"select","legacyOrder":16},
      {"key":"workflow_status","label":"진행상황","kind":"select","legacyOrder":17,"sourceAliases":["진행상항"]},
      {"key":"due_date","label":"마감일","kind":"system_date","legacyOrder":null,"system":true},
      {"key":"visit_application_date","label":"방문 및 신청 일","kind":"date","legacyOrder":18},
      {"key":"review_period","label":"예상 심사기간","kind":"date_range","legacyOrder":19},
      {"key":"inspection_date","label":"실사일","kind":"date","legacyOrder":20},
      {"key":"guidance","label":"지도내용","kind":"longtext","legacyOrder":21},
      {"key":"execution_amount","label":"실행액","kind":"amount","legacyOrder":22},
      {"key":"fee_percent","label":"수수료(%)","kind":"percent","legacyOrder":23},
      {"key":"fee_amount","label":"수수료(원)","kind":"amount","legacyOrder":24},
      {"key":"fee_paid_on","label":"수수료 입금일","kind":"date","legacyOrder":25,"sourceAliases":["수수료_입금일"]},
      {"key":"total_revenue","label":"총 매출액","kind":"amount","legacyOrder":26},
      {"key":"reapply_date","label":"재신청 안내일","kind":"date","legacyOrder":27},
      {"key":"d180","label":"D+180","kind":"date","legacyOrder":28},
      {"key":"d365","label":"D+365","kind":"date","legacyOrder":29},
      {"key":"deposit","label":"계약금","kind":"amount","legacyOrder":30},
      {"key":"deposit_paid_on","label":"계약금 입금일","kind":"date","legacyOrder":31,"sourceAliases":["계약금_입금일"]}
    ]$columns$::jsonb,
    'items', '[]'::jsonb,
    'members', v_members,
    'views', jsonb_build_array(
      jsonb_build_object('id', 'main-table', 'name', '메인 테이블', 'kind', 'table', 'shared', true, 'isDefault', true, 'version', 1, 'predicate', '{}'::jsonb),
      jsonb_build_object('id', 'calendar', 'name', '캘린더', 'kind', 'calendar', 'shared', true, 'isDefault', false, 'version', 1, 'predicate', '{}'::jsonb),
      jsonb_build_object('id', 'gantt', 'name', '간트', 'kind', 'gantt', 'shared', true, 'isDefault', false, 'version', 1, 'predicate', '{}'::jsonb)
    ),
    'virtualBindings', jsonb_build_array(
      jsonb_build_object('columnKey', 'company', 'source', 'company', 'attribute', 'name', 'readOnly', true),
      jsonb_build_object('columnKey', 'homepage', 'source', 'company', 'attribute', 'homepage', 'readOnly', true),
      jsonb_build_object('columnKey', 'representative', 'source', 'company', 'attribute', 'representative', 'readOnly', true),
      jsonb_build_object('columnKey', 'email', 'source', 'contact', 'attribute', 'email', 'readOnly', true),
      jsonb_build_object('columnKey', 'phone', 'source', 'contact', 'attribute', 'phone', 'readOnly', true)
    ),
    'role', v_work_role,
    'filesEnabled', false
  );
exception
  when no_data_found then
    raise exception 'active workspace membership required'
      using errcode = '42501';
end;
$$;

revoke all on function public.read_work_management_board(uuid) from public;
revoke all on function public.read_work_management_board(uuid) from anon;
grant execute on function public.read_work_management_board(uuid) to authenticated;

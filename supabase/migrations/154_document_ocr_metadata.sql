-- moa-migration-guard: logical_key=154_document_ocr_metadata predecessor=153_item_operations_draft digest=9634b559f285f4a0b5b7917fab5abafca7470e95fb4f43210b750dfacc23c4c4 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '154_document_ocr_metadata',
  p_file_name => '154_document_ocr_metadata.sql',
  p_file_digest => '9634b559f285f4a0b5b7917fab5abafca7470e95fb4f43210b750dfacc23c4c4',
  p_expected_predecessor => '153_item_operations_draft',
  p_executor => 'DG',
  p_thread_id => 'moawork-v17-ocr-protected-integration-20260927',
  p_foundation => false
);

-- =====================================================================
-- DRAFT 154 — OCR pre-company intake meta + linked company identity sync
--             + OCR-internal handoff integration.
--
-- 상태: 미적용 초안 (UNAPPLIED). 이 디렉터리(supabase/migrations-draft/)는
-- `supabase db push` 대상이 아니다. supabase/migrations/ 로 옮기려면
-- 부모(독립 SQL 리뷰)의 명시 승인이 필요하며, 옮길 때는 guarded chain의
-- 다음 순번·predecessor 규칙과 151/152(상담 소유)·153(행조작 예약)을
-- 먼저 확인할 것. 기존 150 이하 파일은 절대 고치지 않는다.
--
-- SSOT-repair (2026-09-26, moawork-v17-ocr-ssot-repair-20260926):
-- - P1 null-auth: 세 RPC의 `NOT(역할 OR 범위 OR 담당)` 판정은 담당 미지정
--   행에서 NULL이 되어 `IF(NOT NULL)` = 미실행 → 본인 멤버의 쓰기를
--   허용했다(business_item 재현). 전부 `v_allowed IS NOT TRUE` 형태의
--   fail-closed 판정으로 고쳤다. effective_permission도 `IS NOT TRUE`로
--   감싼다 (revoked feature = false/NULL 모두 거부).
-- - P1 preview: `ocr_precompany_handoff_preview`는 일반 owner 뷰라 RLS를
--   우회했다(거부 상태 deals 0행인데 뷰 3행). `security_invoker=true` +
--   최소 grant(select→authenticated만, public/anon/service_role revoke)로
--   호출자 RLS를 그대로 적용한다. 쓰기가 없는 읽기 전용이다.
-- - P2 회사명 정정: 구 `ocr_sync_linked_company_name`은 기존 이름이
--   비어 있을 때만 채워 OCR 정정 의도(틀린 회사명 고치기)를 버렸다.
--   이제 사용자 선택 확정(p_confirmed) + 관찰된 이전값 CAS(p_expected)를
--   요구하고, 다르면 원본 회사명을 갱신한다. 생성·재연계·자동 병합 없음.
--   같은 회사 다중 deal은 같은 원본을 보므로 일관되게 보인다.
--   회사 쓰기는 deal 권한 AND 회사 권한(065와 같은 모양)을 모두 요구한다.
-- - P2 protected integration (2026-09-27): old ocr_handoff_precompany_to_work direct-065 bypass REMOVED. Wrapper around protected execute_contact_pipeline_transition preserves 151/087/069/065; after committed enriches SAME company blank-only; unlinked intake biz_no is p_biz_no default only when explicit absent.
--
-- 배경: 사업자등록증 OCR 필수 7종 중 생년월일·종목·사업자등록번호(미연계)·
-- 상호(연계 회사명)는 기존 정본 RPC(087 update · 110 title · 120 meta)의
-- allow-list에 없어 저장 경로가 없었다. 이 초안은 그 셋을
-- "회사 생기기 전 intake meta"와 "이미 연계된 회사 원본"에만 둔다:
-- - 회사 신규 생성·재연계·자동 병합 없음 (OCR 필드 저장은 protected chain을 호출하지 않는다; 7절 wrapper가 commit 후 같은 회사에만 빈칸 enrich).
-- - 같은 회사 다중 deal은 deal별 intake에 따로 남는다 (일관된 투영, 병합 없음).
-- - 사업자번호는 비어 있거나 정규화 동일할 때만 멱등 기록, 다르면 22023 충돌.
-- - 회사명은 사용자 확정 + CAS 일치가 있을 때 갱신한다 (아래 4절).
-- - 영수증(new_lead_requests, PK(org,request_id))은 payload/operation에
--   묶인 불변 기록이다. 같은 ID+다른 payload는 22023, 같은 payload는 replay.
-- - 권한은 기존 정본과 같은 모양이다: effective_permission(work.item_upsert)
--   + owner/admin/scope-all/담당자 — 단 전부 fail-closed (`IS NOT TRUE`).
--   회사 원본 쓰기는 deal 권한 AND 회사 가시성(065와 같은 모양)을 요구한다.
-- - OCR 원문·문서 전체는 어디에도 저장하지 않는다. 필드 변경만
--   deal_intake_field_audit의 정상 감사로 남는다.
-- =====================================================================

-- -- 1. intake meta 확장 (회사 생기기 전 임시 보관, handoff 전달용). --------
alter table public.deal_intake
  add column if not exists birthdate date,
  add column if not exists business_item text,
  add column if not exists biz_no text;

-- -- 2. OCR intake meta 원자 저장 -------------------------------------------
-- allow: birthdate(YYYY-MM-DD 실재 날짜만) · business_item(비어 있지 않은
-- 최대 60자) · biz_no(숫자 10자리). 셋 다 값 검증을 통과해야 기록된다.
create or replace function public.update_new_lead_ocr_meta(
  p_org_id uuid, p_deal_id uuid, p_request_id uuid, p_patch jsonb,
  p_value_source text default 'manual'
) returns table(deal_id uuid, item_id uuid, changed_fields text[], replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid;
  v_item uuid; v_board uuid; v_item_assigned uuid;
  v_payload jsonb; v_patch jsonb:=coalesce(p_patch,'{}'::jsonb);
  v_prior public.new_lead_requests%rowtype;
  v_key text; v_new jsonb; v_old jsonb; v_changed text[]:='{}';
  v_allowed constant text[]:=array['birthdate','business_item','biz_no'];
  v_permitted boolean;
  v_digits text; v_sum int; v_i int; v_weights int[]:=array[1,3,7,1,3,7,1,3,5];
begin
  if v_actor is null or p_request_id is null or jsonb_typeof(v_patch)<>'object'
     or p_value_source not in ('manual','automation','import') then
    raise exception 'ocr meta input invalid' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(v_patch) k where not (k=any(v_allowed))) then
    raise exception 'ocr meta field unsupported' using errcode='22023';
  end if;
  -- 값 검증: 통과하지 못하면 아무것도 쓰지 않는다.
  -- 날짜 캐스트는 정규식을 통과한 뒤에만 한다 (SQL OR는 양쪽을 먼저
  -- 평가할 수 있어 주민번호 같은 입력이 cast 오류로 샐 수 있다).
  if v_patch ? 'birthdate' then
    if v_patch->>'birthdate' !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
      raise exception 'ocr birthdate invalid' using errcode='22023';
    end if;
    -- 존재하지 않는 날짜(02-30 등)의 캐스트 오류도 같은 22023으로 묶는다.
    begin
      if ((v_patch->>'birthdate')::date)::text <> v_patch->>'birthdate' then
        raise exception 'ocr birthdate invalid' using errcode='22023';
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'ocr birthdate invalid' using errcode='22023';
    end;
  end if;
  if v_patch ? 'business_item' then
    if nullif(btrim(v_patch->>'business_item'),'') is null
       or char_length(btrim(v_patch->>'business_item')) > 60 then
      raise exception 'ocr business_item invalid' using errcode='22023';
    end if;
  end if;
  if v_patch ? 'biz_no' then
    v_digits:=regexp_replace(coalesce(v_patch->>'biz_no',''), '[^0-9]', '', 'g');
    if char_length(v_digits) <> 10 or v_digits ~ '^([0-9])\1{9}$' then
      raise exception 'ocr biz_no invalid' using errcode='22023';
    end if;
    v_sum:=0;
    for v_i in 1..9 loop
      v_sum:=v_sum + substring(v_digits from v_i for 1)::int * v_weights[v_i];
    end loop;
    v_sum:=v_sum + ((substring(v_digits from 9 for 1)::int * 5) / 10)::int;
    if ((10 - (v_sum % 10)) % 10) <> substring(v_digits from 10 for 1)::int then
      raise exception 'ocr biz_no checksum mismatch' using errcode='22023';
    end if;
  end if;
  select m.role::text,m.scope::text,d.assigned_to into v_role,v_scope,v_assigned
    from public.org_members m join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active'
   for update of d;
  -- P1 fail-closed: `NOT(역할 OR 범위 OR 담당)`은 미지정 행에서 NULL이 되어
  -- 검사를 통과시켰다. `IS NOT TRUE`는 true가 아닌 모든 경우(NULL 포함)를
  -- 거부한다. effective_permission도 revoked(false/NULL)면 거부한다.
  v_permitted:=(v_role in ('owner','admin')) or (v_scope='all') or (v_assigned=v_actor);
  if not found
     or (public.effective_permission(p_org_id,'work.view_tabs') is not true)
     or (public.effective_permission(p_org_id,'work.item_upsert') is not true)
     or (v_permitted is not true) then
    raise exception 'ocr meta denied' using errcode='42501';
  end if;
  -- A public RPC must prove the current live projection, not trust an earlier
  -- action read. Lock it before receipt replay and retain its validated ID.
  select i.id,i.board_id,i.assigned_to into v_item,v_board,v_item_assigned
    from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
   where i.org_id=p_org_id and i.deal_id=p_deal_id
     and i.deleted_at is null and i.archived_at is null
     and b.source='core.default-tab/new-lead'
   for update of i,b;
  if not found or ((v_role in ('owner','admin')) or v_scope='all' or v_item_assigned=v_actor) is not true then
    raise exception 'ocr current projection denied' using errcode='42501';
  end if;
  perform 1 from public.deal_intake i where i.org_id=p_org_id and i.deal_id=p_deal_id for update;
  if not found then raise exception 'ocr intake unavailable' using errcode='22023'; end if;
  v_payload:=jsonb_build_object('deal_id',p_deal_id,'ocr_patch',v_patch,'value_source',p_value_source);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation is distinct from 'update' or v_prior.payload is distinct from v_payload or v_prior.actor_id is distinct from v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023'; end if;
    return query select p_deal_id,v_item,array(select a.field_key from public.deal_intake_field_audit a where a.org_id=p_org_id and a.request_id=p_request_id order by a.field_key),true; return;
  end if;
  for v_key,v_new in select key,value from jsonb_each(v_patch) loop
    if p_value_source='automation' and exists(select 1 from public.deal_intake_field_audit a
       where a.org_id=p_org_id and a.deal_id=p_deal_id and a.field_key=v_key and a.value_source='manual') then
      raise exception 'manual correction conflict: %',v_key using errcode='40001';
    end if;
    select to_jsonb(i)->v_key into v_old from public.deal_intake i where i.org_id=p_org_id and i.deal_id=p_deal_id;
    if v_old is distinct from v_new then
      insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
        values(p_org_id,p_deal_id,v_key,v_old,v_new,p_value_source,v_actor,p_request_id);
      v_changed:=array_append(v_changed,v_key);
    end if;
  end loop;
  update public.deal_intake i set
    birthdate=case when v_patch?'birthdate' then (v_patch->>'birthdate')::date else i.birthdate end,
    business_item=case when v_patch?'business_item' then nullif(btrim(v_patch->>'business_item'),'') else i.business_item end,
    biz_no=case when v_patch?'biz_no' then v_digits else i.biz_no end,
    updated_at=now() where i.org_id=p_org_id and i.deal_id=p_deal_id;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'update',p_deal_id,v_item,v_actor,v_payload);
  return query select p_deal_id,v_item,v_changed,false;
end $$;

revoke all on function public.update_new_lead_ocr_meta(uuid,uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.update_new_lead_ocr_meta(uuid,uuid,uuid,jsonb,text) to authenticated;

-- -- 3. 연계 회사 사업자번호 동기화 (연계된 원본에만, 생성·재연계 없음) -------
-- muerte: deal.company_id가 비어 있으면 22023(연계 없음 — intake meta에 둔다).
-- p_confirmed가 true가 아니면 22023(사용자 명시 확정 없이 저장하지 않는다).
-- 기존 번호가 비어 있거나 정규화 동일하면 멱등 기록, 다르면 22023 충돌
-- (실재 번호를 OCR이 조용히 덮지 않는다 — 수동 해소).
-- 회사 쓰기는 deal 권한 AND 회사 가시성(065와 같은 모양)을 모두 요구한다.
create or replace function public.ocr_update_linked_company_biz_no(
  p_org_id uuid, p_deal_id uuid, p_request_id uuid, p_biz_no text, p_confirmed boolean default false
) returns table(deal_id uuid, company_id uuid, replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid;
  v_company uuid; v_company_assigned uuid;
  v_item uuid; v_board uuid; v_item_assigned uuid;
  v_existing text; v_existing_norm text;
  v_digits text; v_sum int; v_i int; v_weights int[]:=array[1,3,7,1,3,7,1,3,5];
  v_payload jsonb; v_prior public.new_lead_requests%rowtype;
  v_deal_permitted boolean; v_company_permitted boolean;
begin
  if v_actor is null or p_request_id is null or coalesce(p_confirmed,false) is not true then
    raise exception 'ocr company biz_no confirm required' using errcode='22023';
  end if;
  v_digits:=regexp_replace(coalesce(p_biz_no,''), '[^0-9]', '', 'g');
  if char_length(v_digits) <> 10 or v_digits ~ '^([0-9])\1{9}$' then
    raise exception 'ocr biz_no invalid' using errcode='22023';
  end if;
  v_sum:=0;
  for v_i in 1..9 loop
    v_sum:=v_sum + substring(v_digits from v_i for 1)::int * v_weights[v_i];
  end loop;
  v_sum:=v_sum + ((substring(v_digits from 9 for 1)::int * 5) / 10)::int;
  if ((10 - (v_sum % 10)) % 10) <> substring(v_digits from 10 for 1)::int then
    raise exception 'ocr biz_no checksum mismatch' using errcode='22023';
  end if;
  select m.role::text,m.scope::text,d.assigned_to,d.company_id into v_role,v_scope,v_assigned,v_company
    from public.org_members m join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active'
   for update of d;
  -- P1 fail-closed (`IS NOT TRUE` — NULL도 거부).
  v_deal_permitted:=(v_role in ('owner','admin')) or (v_scope='all') or (v_assigned=v_actor);
  if not found
     or (public.effective_permission(p_org_id,'work.view_tabs') is not true)
     or (public.effective_permission(p_org_id,'work.item_upsert') is not true)
     or (v_deal_permitted is not true) then
    raise exception 'ocr company biz_no denied' using errcode='42501';
  end if;
  -- A public RPC must prove the current live projection, not trust an earlier
  -- action read. Lock it before receipt replay and retain its validated ID.
  select i.id,i.board_id,i.assigned_to into v_item,v_board,v_item_assigned
    from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
   where i.org_id=p_org_id and i.deal_id=p_deal_id
     and i.deleted_at is null and i.archived_at is null
     and b.source='core.default-tab/new-lead'
   for update of i,b;
  if not found or ((v_role in ('owner','admin')) or v_scope='all' or v_item_assigned=v_actor) is not true then
    raise exception 'ocr current projection denied' using errcode='42501';
  end if;
  if v_company is null then
    raise exception 'ocr company not linked' using errcode='22023';
  end if;
  select c.biz_no,c.assigned_to into v_existing,v_company_assigned from public.companies c
   where c.org_id=p_org_id and c.id=v_company and c.merged_into is null for update;
  if not found then raise exception 'ocr company unavailable' using errcode='22023'; end if;
  -- 065와 같은 회사 가시성: owner/admin/scope-all 또는 회사 담당자.
  v_company_permitted:=(v_role in ('owner','admin')) or (v_scope='all') or (v_company_assigned=v_actor);
  if (v_company_permitted is not true) then
    raise exception 'ocr company biz_no denied' using errcode='42501';
  end if;
  v_existing_norm:=nullif(regexp_replace(coalesce(v_existing,''), '[^0-9]', '', 'g'),'');
  if v_existing_norm is not null and v_existing_norm <> v_digits then
    raise exception 'ocr company biz_no conflict' using errcode='22023';
  end if;
  v_payload:=jsonb_build_object('deal_id',p_deal_id,'company_id',v_company,'biz_no',v_digits);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation is distinct from 'update' or v_prior.payload is distinct from v_payload or v_prior.actor_id is distinct from v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023'; end if;
    return query select p_deal_id,v_company,true; return;
  end if;
  if v_existing_norm is distinct from v_digits then
    insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
      values(p_org_id,p_deal_id,'linked_company_biz_no',to_jsonb(v_existing),to_jsonb(v_digits),'manual',v_actor,p_request_id);
    update public.companies set biz_no=v_digits where org_id=p_org_id and id=v_company;
  end if;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'update',p_deal_id,v_item,v_actor,v_payload);
  return query select p_deal_id,v_company,false;
end $$;

revoke all on function public.ocr_update_linked_company_biz_no(uuid,uuid,uuid,text,boolean) from public,anon,service_role;
grant execute on function public.ocr_update_linked_company_biz_no(uuid,uuid,uuid,text,boolean) to authenticated;

-- -- 4. 연계 회사명 정정 (사용자 확정 + 이전값 CAS, 원본 갱신) -----------------
-- OCR의 목적은 "틀린 회사명을 바로잡는" 것이다. 구 fill-if-blank는 기존
-- 이름이 하나라도 있으면 정정을 버려 title만 바뀌고 companies.name은 틀린
-- 채로 남았다. 이제 p_confirmed(사용자 선택 확정)와 p_expected(비교 화면에서
-- 본 이전 회사명 — 빈 문자열은 "비어 있었음" 관찰)를 요구한다:
-- - confirmed가 true가 아니면 22023 (선택 없이 저장하지 않는다).
-- - p_expected가 null이면 22023 (비교 기준 없이 저장하지 않는다 — blind 금지).
-- - 회사 현재값이 p_expected와 다르면 22023 충돌 (그 사이 바뀜 — 재확인 필요).
-- - 현재값과 새 title이 정규화 동일하면 skipped=true 멱등 (영수증은 남긴다).
-- - 다르면 companies.name을 갱신하고 감사한다. 생성·재연계·자동 병합 없음.
-- - 같은 회사 다중 deal은 같은 원본을 읽으므로 정정 후 일관되게 보인다.
-- - 회사 쓰기는 deal 권한 AND 회사 가시성(065와 같은 모양)을 요구하며,
--   EAV(item_values) 우회가 아니라 이 RPC의 판정을 거친다.
-- 구 4-arg 시그니처(fill-if-blank)가 남아 있으면 걷어낸다. 초안은 미적용이라
-- 운영에 남은 잔재는 없지만, PGlite 재적용·로컬 검증에서 overload가 쌓이지 않게.
drop function if exists public.ocr_sync_linked_company_name(uuid,uuid,uuid,text);
create or replace function public.ocr_sync_linked_company_name(
  p_org_id uuid, p_deal_id uuid, p_request_id uuid, p_title text,
  p_expected text default null, p_confirmed boolean default false
) returns table(deal_id uuid, company_id uuid, skipped boolean, replayed boolean)
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_role text; v_scope text; v_assigned uuid;
  v_company uuid; v_company_assigned uuid;
  v_item uuid; v_board uuid; v_item_assigned uuid;
  v_existing text; v_title text:=nullif(btrim(coalesce(p_title,'')),'');
  v_expected_norm text;
  v_payload jsonb; v_prior public.new_lead_requests%rowtype;
  v_deal_permitted boolean; v_company_permitted boolean;
  v_skipped boolean;
begin
  if v_actor is null or p_request_id is null or v_title is null then
    raise exception 'ocr company name input invalid' using errcode='22023';
  end if;
  if coalesce(p_confirmed,false) is not true then
    raise exception 'ocr company name confirm required' using errcode='22023';
  end if;
  if p_expected is null then
    raise exception 'ocr company name expected required' using errcode='22023';
  end if;
  select m.role::text,m.scope::text,d.assigned_to,d.company_id into v_role,v_scope,v_assigned,v_company
    from public.org_members m join public.orgs o on o.id=m.org_id
    join public.deals d on d.org_id=m.org_id and d.id=p_deal_id
   where m.org_id=p_org_id and m.user_id=v_actor and m.status='active' and o.status='active'
   for update of d;
  -- P1 fail-closed (`IS NOT TRUE` — NULL도 거부).
  v_deal_permitted:=(v_role in ('owner','admin')) or (v_scope='all') or (v_assigned=v_actor);
  if not found
     or (public.effective_permission(p_org_id,'work.view_tabs') is not true)
     or (public.effective_permission(p_org_id,'work.item_upsert') is not true)
     or (v_deal_permitted is not true) then
    raise exception 'ocr company name denied' using errcode='42501';
  end if;
  -- A public RPC must prove the current live projection, not trust an earlier
  -- action read. Lock it before receipt replay and retain its validated ID.
  select i.id,i.board_id,i.assigned_to into v_item,v_board,v_item_assigned
    from public.items i join public.boards b on b.id=i.board_id and b.org_id=i.org_id
   where i.org_id=p_org_id and i.deal_id=p_deal_id
     and i.deleted_at is null and i.archived_at is null
     and b.source='core.default-tab/new-lead'
   for update of i,b;
  if not found or ((v_role in ('owner','admin')) or v_scope='all' or v_item_assigned=v_actor) is not true then
    raise exception 'ocr current projection denied' using errcode='42501';
  end if;
  if v_company is null then
    raise exception 'ocr company not linked' using errcode='22023';
  end if;
  select c.name,c.assigned_to into v_existing,v_company_assigned from public.companies c
   where c.org_id=p_org_id and c.id=v_company and c.merged_into is null for update;
  if not found then raise exception 'ocr company unavailable' using errcode='22023'; end if;
  -- 065와 같은 회사 가시성: owner/admin/scope-all 또는 회사 담당자.
  v_company_permitted:=(v_role in ('owner','admin')) or (v_scope='all') or (v_company_assigned=v_actor);
  if (v_company_permitted is not true) then
    raise exception 'ocr company name denied' using errcode='42501';
  end if;
  v_payload:=jsonb_build_object('deal_id',p_deal_id,'company_id',v_company,'title',v_title,'expected',p_expected);
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  select * into v_prior from public.new_lead_requests r where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation is distinct from 'update' or v_prior.payload is distinct from v_payload or v_prior.actor_id is distinct from v_actor then
      raise exception 'new lead idempotency key reuse' using errcode='22023'; end if;
    -- replay는 CAS보다 먼저 — 같은 요청의 재시도는 관찰값이 낡아 보여도
    -- 성공해야 하며, 첫 실행과 같은 skipped를 돌려준다 (감사 행 기준).
    select not exists(select 1 from public.deal_intake_field_audit a
      where a.org_id=p_org_id and a.request_id=p_request_id and a.field_key='linked_company_name')
      into v_skipped;
    return query select p_deal_id,v_company,v_skipped,true; return;
  end if;
  -- CAS: 관찰된 이전값과 다르면 someone changed — 덮지 않고 충돌.
  v_expected_norm:=nullif(btrim(coalesce(p_expected,'')),'');
  if nullif(btrim(coalesce(v_existing,'')),'') is distinct from v_expected_norm then
    raise exception 'ocr company name conflict: reload and confirm again' using errcode='22023';
  end if;
  if v_expected_norm is null then
    -- 비어 있었음 관찰 + 확정 → 채운다 (구 fill-if-blank와 같은 결과).
    v_skipped:=false;
  elsif v_expected_norm = v_title then
    v_skipped:=true;
  else
    v_skipped:=false;
  end if;
  if not v_skipped then
    insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
      values(p_org_id,p_deal_id,'linked_company_name',to_jsonb(v_existing),to_jsonb(v_title),'manual',v_actor,p_request_id);
    update public.companies set name=v_title where org_id=p_org_id and id=v_company;
  end if;
  insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
    values(p_org_id,p_request_id,'update',p_deal_id,v_item,v_actor,v_payload);
  return query select p_deal_id,v_company,v_skipped,false;
end $$;

revoke all on function public.ocr_sync_linked_company_name(uuid,uuid,uuid,text,text,boolean) from public,anon,service_role;
grant execute on function public.ocr_sync_linked_company_name(uuid,uuid,uuid,text,text,boolean) to authenticated;

-- -- 5. handoff 전달용 회사 보관 칸 (없을 때만 추가) --------------------------
-- 생년월일(대표자)·종목은 intake에만 있어 handoff가 회사로 전달해도 둘 곳이
-- 없었다. 최소 보관 칸만 둔다. 자동 덮어쓰기가 아니라 "비어 있을 때만 채움"
-- (아래 7절)이라 기존 원본을 해치지 않는다.
alter table public.companies
  add column if not exists business_item text,
  add column if not exists owner_birthdate date;

-- -- 6. 명시적 handoff 전달용 읽기 (쓰기 없음, security_invoker) -------------
-- handoff_company_to_work를 "나중에 명시적으로" 호출할 때 전달할 값을
-- deal 단위로 미리 보여준다. 이 뷰가 회사를 만들거나 옮기지 않는다.
-- 매핑: p_name ← company_name(연계 있으면 그 이름, 없으면 deal title)
--        p_biz_no ← linked_biz_no(연계 있으면), 없으면 intake_biz_no
--        p_owner_name ← representative_name · p_industry ← industry
--        (+business_item·birthdate는 아래 7절이 회사 빈 칸에만 전달)
--
-- P1: 구 일반 뷰는 owner 정의자 권한으로 RLS를 우회했다 (거부 상태 deals
-- 0행인데 뷰 3행). security_invoker=true라 호출자 RLS가 그대로 적용되며,
-- select는 authenticated에만 준다 (public/anon/service_role revoke).
create or replace view public.ocr_precompany_handoff_preview
with (security_invoker=true) as
select
  d.org_id, d.id as deal_id, d.title as deal_title, d.company_id,
  c.name as company_name, nullif(regexp_replace(coalesce(c.biz_no,''), '[^0-9]', '', 'g'),'') as linked_biz_no,
  c.business_item as company_business_item, c.owner_birthdate as company_owner_birthdate,
  i.representative_name, i.industry, i.business_item, i.birthdate,
  nullif(regexp_replace(coalesce(i.biz_no,''), '[^0-9]', '', 'g'),'') as intake_biz_no
from public.deals d
left join public.companies c on c.org_id=d.org_id and c.id=d.company_id and c.merged_into is null
left join public.deal_intake i on i.org_id=d.org_id and i.deal_id=d.id;

revoke all on table public.ocr_precompany_handoff_preview from public,anon,authenticated,service_role;
grant select on table public.ocr_precompany_handoff_preview to authenticated;

-- -- 7. OCR metadata integration INTO protected chain (no second workflow) --
-- 2026-09-27 protected-integration: old `ocr_handoff_precompany_to_work`
-- direct-065 bypass is REMOVED. OCR metadata flows only through the existing
-- protected `execute_contact_pipeline_transition` chain (065/069/087/151).
-- No second user workflow, no independent company handoff button.
--
-- Shape (narrow wrapper, no wholesale 151 copy):
-- - Preserve whatever the current protected chain is (069+087, or +151 when
--   consultation lands) by renaming it to
--   `execute_contact_pipeline_transition_pre_ocr_154`. The 151 body/ACL is
--   never copied here; the rename keeps it complete. Direct calls to the
--   inner name are revoked so all normal entrypoints use the wrapper.
-- - Wrapper passes every argument through unchanged EXCEPT p_biz_no default:
--   when kind='contact_to_work' and explicit p_biz_no is absent (null/blank),
--   the unlinked stored intake biz_no (deal_intake.biz_no for the resolved
--   deal) is used as default. Explicit p_biz_no always wins. Identity
--   (deal/company IDs), receipt (request_id binding), permission, and
--   gates (checklist/seal/stage) are untouched -- inner owns them.
-- - Only AFTER inner returns 'committed' does the wrapper enrich the SAME
--   authoritative company_id with intake business_item/birthdate, blank-only
--   (no overwrite). Blocked/error returns with zero company write (no
--   premature metadata write). No new company, no duplicate, no title/name
--   change here (name CAS fix stays in section 4 RPC).
-- - Same-request retry with changed intent (different deal/item/kind) is
--   denied by inner before any enrichment (stale write impossible).
--   company null->linked mutation between first commit and replay returns the
--   same company via inner receipts; enrichment is blank-only idempotent.
--
-- Old bypass route removal (publicly callable RPC):
drop function if exists public.ocr_handoff_precompany_to_work(uuid,uuid,uuid);

do $$
begin
  if to_regprocedure('public.execute_contact_pipeline_transition_pre_ocr_154(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)') is null
     and to_regprocedure('public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)') is not null then
    alter function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric)
      rename to execute_contact_pipeline_transition_pre_ocr_154;
  end if;
end $$;

create or replace function public.execute_contact_pipeline_transition(
  p_org_id uuid, p_deal_id uuid, p_source_item_id uuid, p_request_id uuid, p_kind text,
  p_company_id uuid default null, p_company_name text default null,
  p_biz_no text default null, p_owner_name text default null,
  p_business_type text default null, p_industry text default null,
  p_region_sido text default null, p_region_sigungu text default null,
  p_phone text default null, p_founded_on date default null,
  p_revenue numeric default null
) returns table(status text, deal_id uuid, company_id uuid, reason text)
language plpgsql security definer set search_path='' as $$
declare
  v_effective_biz text:=p_biz_no;
  v_resolved_deal uuid:=p_deal_id;
  v_intake_biz text;
  v_status text; v_out_deal uuid; v_out_company uuid; v_out_reason text;
  v_item text; v_birth date;
  v_intent jsonb;
  v_was_committed boolean;
  v_prior public.new_lead_requests%rowtype;
begin
  if p_kind is distinct from 'contact_to_work' then
    return query select * from public.execute_contact_pipeline_transition_pre_ocr_154(
      p_org_id,p_deal_id,p_source_item_id,p_request_id,p_kind,
      p_company_id,p_company_name,p_biz_no,p_owner_name,p_business_type,p_industry,
      p_region_sido,p_region_sigungu,p_phone,p_founded_on,p_revenue);
    return;
  end if;
  -- Serialize one intent, but leave all authorization and contract gates to 151.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_request_id::text,0));
  v_intent:=jsonb_build_object(
    'kind',p_kind,'deal_id',p_deal_id,'source_item_id',p_source_item_id,
    'company_name',p_company_name,'biz_no',p_biz_no,'owner_name',p_owner_name,
    'business_type',p_business_type,'industry',p_industry,
    'region_sido',p_region_sido,'region_sigungu',p_region_sigungu,
    'phone',p_phone,'founded_on',p_founded_on,'revenue',p_revenue);
  if nullif(btrim(coalesce(v_effective_biz,'')),'') is null then
    if v_resolved_deal is null and p_source_item_id is not null then
      select i.deal_id into v_resolved_deal from public.items i
       where i.id=p_source_item_id and i.org_id=p_org_id;
    end if;
    if v_resolved_deal is not null then
      select nullif(regexp_replace(coalesce(i.biz_no,''), '[^0-9]', '', 'g'),'')
        into v_intake_biz from public.deal_intake i
       where i.org_id=p_org_id and i.deal_id=v_resolved_deal;
      if v_intake_biz is not null then
        v_effective_biz:=v_intake_biz;
      end if;
    end if;
  end if;
  select exists(select 1 from public.contact_pipeline_transitions t
    where t.org_id=p_org_id and t.request_id=p_request_id and t.status='committed')
    into v_was_committed;
  select r.status,r.deal_id,r.company_id,r.reason
    into v_status,v_out_deal,v_out_company,v_out_reason
    from public.execute_contact_pipeline_transition_pre_ocr_154(
      p_org_id,p_deal_id,p_source_item_id,p_request_id,p_kind,
      p_company_id,p_company_name,v_effective_biz,p_owner_name,p_business_type,p_industry,
      p_region_sido,p_region_sigungu,p_phone,p_founded_on,p_revenue) r;
  -- Only read the OCR receipt after 151 has authenticated the current actor,
  -- row, feature permission and target. Any mismatch rolls the whole transition back.
  select * into v_prior from public.new_lead_requests r
   where r.org_id=p_org_id and r.request_id=p_request_id;
  if found then
    if v_prior.operation is distinct from 'update'
       or v_prior.actor_id is distinct from auth.uid()
       or v_prior.payload->>'operation' is distinct from 'ocr_protected_handoff'
       or v_prior.payload->'intent' is distinct from v_intent
       or v_prior.deal_id is distinct from v_out_deal
       or (p_company_id is not null and p_company_id is distinct from v_out_company) then
      raise exception 'OCR handoff request intent mismatch' using errcode='22023';
    end if;
    -- A committed replay is read-only: later intake edits must not create new
    -- effects or audit entries under the old request ID.
    return query select v_status,v_out_deal,v_out_company,v_out_reason;
    return;
  end if;
  -- Receipts committed before this migration have no OCR receipt. Do not
  -- retroactively attach new effects to an old successful transition.
  if v_was_committed then
    return query select v_status,v_out_deal,v_out_company,v_out_reason;
    return;
  end if;
  if v_status = 'committed' and v_out_company is not null and v_out_deal is not null then
    select i.business_item,i.birthdate into v_item,v_birth from public.deal_intake i
     where i.org_id=p_org_id and i.deal_id=v_out_deal;
    if v_item is not null then
      update public.companies set business_item=v_item
       where org_id=p_org_id and id=v_out_company and business_item is null;
      if found then
        if not exists(select 1 from public.deal_intake_field_audit a
          where a.org_id=p_org_id and a.request_id=p_request_id and a.field_key='company_business_item') then
          insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
            values(p_org_id,v_out_deal,'company_business_item',null,to_jsonb(v_item),'manual',auth.uid(),p_request_id);
        end if;
      end if;
    end if;
    if v_birth is not null then
      update public.companies set owner_birthdate=v_birth
       where org_id=p_org_id and id=v_out_company and owner_birthdate is null;
      if found then
        if not exists(select 1 from public.deal_intake_field_audit a
          where a.org_id=p_org_id and a.request_id=p_request_id and a.field_key='company_owner_birthdate') then
          insert into public.deal_intake_field_audit(org_id,deal_id,field_key,old_value,new_value,value_source,actor_id,request_id)
            values(p_org_id,v_out_deal,'company_owner_birthdate',null,to_jsonb(v_birth),'manual',auth.uid(),p_request_id);
        end if;
      end if;
    end if;
    insert into public.new_lead_requests(org_id,request_id,operation,deal_id,item_id,actor_id,payload)
      values(p_org_id,p_request_id,'update',v_out_deal,p_source_item_id,auth.uid(),
        jsonb_build_object('operation','ocr_protected_handoff','intent',v_intent,'company_id',v_out_company));
  end if;
  return query select v_status,v_out_deal,v_out_company,v_out_reason;
end $$;

revoke all on function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) from public,anon,service_role;
grant execute on function public.execute_contact_pipeline_transition(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) to authenticated;
revoke all on function public.execute_contact_pipeline_transition_pre_ocr_154(uuid,uuid,uuid,uuid,text,uuid,text,text,text,text,text,text,text,text,date,numeric) from public,anon,authenticated,service_role;

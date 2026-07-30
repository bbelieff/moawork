-- =====================================================================
-- 018_platform_admin_direct_create.sql
--   플랫폼 관리자의 회사 만들기는 승인 절차를 타지 않는다
--
-- 이유: 회사 만들기 요청의 승인자는 플랫폼 관리자다(resolve_workspace_create_request 가
--       is_platform_admin() 을 요구). 따라서 플랫폼 관리자가 요청하면 **자기 요청을 자기가
--       승인**하는 구조가 되어 절차에 의미가 없고, 소속 0인 관리자는 회사를 만들 때마다
--       불필요하게 대기 화면을 거친다.
--
-- 조치: submit_workspace_create_request 에 자동승인 분기를 추가한다.
--       요청자가 플랫폼 관리자면 pending 을 남기지 않고 즉시 orgs + owner 멤버십을 만들고,
--       감사 이벤트에 **'플랫폼 관리자 직접 생성'** 으로 구분해 남긴다.
--       일반 사용자 경로는 한 글자도 바뀌지 않는다(기존 pending → 승인 절차 유지).
--
-- 설계 메모
--  · 검증(이름/주소 길이·형식·예약어), 멱등(request_id + payload_digest 재사용 검사),
--    advisory lock 은 기존과 동일하게 유지한다. 자동승인은 그 **뒤에** 붙는다.
--  · 반환 계약은 하위호환: 기존 `{accepted:true}` 에 필드만 **추가**한다
--    (`auto_approved`, `status`, `org_id`, `slug`). 기존 호출부는 accepted 만 보므로 안전하다.
--  · 재호출(같은 request_id)로 두 번 프로비저닝되지 않도록, 이미 approved 인 요청은
--    기존 결과를 그대로 돌려준다(replay).
--  · slug 선점 경쟁은 승인 경로와 같은 키로 advisory lock 을 잡아 막는다.
--
-- 성격: 함수 1개 재정의. 테이블·RLS 정책·is_org_member() 무수정.
--       017 의 is_platform_admin() 수정이 선행돼야 관리자 판정이 실제로 true 가 된다.
-- =====================================================================

create or replace function public.submit_workspace_create_request(
  p_request_id uuid,
  p_name text,
  p_slug text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = public, extensions, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := public.normalize_workspace_slug(coalesce(p_slug, ''));
  v_payload_digest bytea;
  v_existing public.workspace_entry_requests%rowtype;
  v_inserted integer;
  v_is_platform_admin boolean;
  v_org_id uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request id required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = v_user_id) then
    raise exception 'profile required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 80 then
    raise exception 'workspace name length invalid' using errcode = '22023';
  end if;
  if char_length(v_slug) not between 3 and 40
     or v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or v_slug in (
       '_next', 'account', 'admin', 'api', 'auth', 'boards', 'contract',
       'dash', 'login', 'logout', 'newcust', 'notices', 'onboarding',
       'platform', 'policyfund', 'settings', 'support', 'w', 'work',
       'workspace-entry', 'workspaces', 'www'
     ) then
    raise exception 'workspace address invalid' using errcode = '22023';
  end if;

  v_payload_digest := digest(
    convert_to('create:' || v_name || ':' || v_slug, 'utf8'),
    'sha256'
  );
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':' || p_request_id::text, 0));

  insert into public.workspace_entry_requests (
    id, requester_user_id, kind, desired_name, desired_slug, payload_digest
  ) values (
    p_request_id, v_user_id, 'create', v_name, v_slug, v_payload_digest
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  select * into v_existing
  from public.workspace_entry_requests
  where id = p_request_id;

  if v_existing.requester_user_id <> v_user_id
     or v_existing.kind <> 'create'
     or v_existing.payload_digest <> v_payload_digest then
    raise exception 'idempotency key reuse with different request'
      using errcode = '22023';
  end if;

  if v_inserted = 1 then
    insert into public.workspace_entry_events (
      request_id, actor_user_id, event_type, outcome, metadata
    ) values (
      p_request_id, v_user_id, 'create_request_submitted', 'accepted',
      jsonb_build_object('kind', 'create')
    );
  end if;

  -- ── 여기까지 기존 동작과 동일 ──────────────────────────────────────────
  -- 아래부터가 018 의 추가분: 요청자가 플랫폼 관리자면 즉시 생성한다.

  v_is_platform_admin := public.is_platform_admin();

  if not v_is_platform_admin then
    -- 일반 사용자: 기존 계약 그대로(pending 유지, 승인 대기).
    return jsonb_build_object('accepted', true);
  end if;

  -- 재호출 방어: 이미 처리된 요청은 다시 프로비저닝하지 않고 기존 결과를 돌려준다.
  if v_existing.status = 'approved' then
    return jsonb_build_object(
      'accepted', true, 'auto_approved', true, 'replayed', true,
      'status', 'approved', 'org_id', v_existing.target_org_id, 'slug', v_slug
    );
  end if;
  if v_existing.status <> 'pending' then
    -- 취소·거절된 요청 id 를 재사용한 경우. 조용히 생성하지 않는다.
    raise exception 'request already resolved with a different outcome'
      using errcode = '23505';
  end if;

  -- 승인 경로와 **같은 키**로 slug 선점 경쟁을 막는다.
  perform pg_advisory_xact_lock(hashtextextended('workspace-slug:' || v_slug, 0));

  insert into public.orgs (name, slug, status)
  values (v_name, v_slug, 'active')
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role, scope, status)
  values (v_org_id, v_user_id, 'owner', 'all', 'active');

  update public.workspace_entry_requests
  set status = 'approved',
      target_org_id = v_org_id,
      decision_code = 'platform_admin_direct_create',
      resolved_by = v_user_id,
      resolved_at = now()
  where id = p_request_id;

  -- 감사로그: 일반 승인과 **구분되는** 이벤트로 남긴다.
  -- 승인자와 요청자가 동일인이라는 사실을 metadata 에 명시해 사후 감사에서 오해가 없게 한다.
  insert into public.workspace_entry_events (
    request_id, org_id, actor_user_id, event_type, outcome, metadata
  ) values (
    p_request_id, v_org_id, v_user_id, 'create_request_resolved', 'approved',
    jsonb_build_object(
      'owner_created', true,
      'platform_admin_direct_create', true,
      'reason', '플랫폼 관리자 직접 생성 — 승인 절차 없이 즉시 생성',
      'self_approved', true
    )
  );

  return jsonb_build_object(
    'accepted', true, 'auto_approved', true, 'replayed', false,
    'status', 'approved', 'org_id', v_org_id, 'slug', v_slug
  );
end;
$$;

-- 006 과 동일한 접근 통제를 재확인(멱등).
revoke all on function public.submit_workspace_create_request(uuid, text, text) from public, anon;
grant execute on function public.submit_workspace_create_request(uuid, text, text) to authenticated;

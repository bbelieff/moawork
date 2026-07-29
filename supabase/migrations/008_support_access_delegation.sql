-- =====================================================================
-- 008_support_access_delegation.sql — T08 지원(1:1 문의) + 접근위임
-- 성격 : 001~007 위에 **additive**. 기존 파일·기존 정책 무수정.
-- 불변식(belie 지시 2026-07-28):
--   1) `public.is_org_member()` 를 **수정하지 않는다**. 위임 접근은 `has_active_grant()`
--      기반의 **별도 permissive 정책**으로 OR 추가만 한다(기존 격리 로직 무손상).
--   2) 홈택스(hometax_consents/hometax_docs)는 **위임 중에도 항상 차단** — 재수탁 개인정보.
--      단순히 "정책을 안 만든다"에 의존하지 않고 RESTRICTIVE 정책으로 못을 박는다.
--   3) 멤버가 개시한 위임은 **읽기 전용 고정**(mode='write' 는 owner/admin 만).
--   4) 회사(조직)당 **활성 위임 1건**.
--   5) scope='assigned' 멤버가 개시한 위임은 **그 멤버 담당 건만** 보인다(RLS 상속).
-- 선행 : 001 → 002 → 003 → 004 → 005 → 006 → 007
-- =====================================================================

-- =====================================================================
-- 0. ENUM
-- =====================================================================
create type support_thread_status as enum ('open', 'answered', 'closed');
create type support_author_kind   as enum ('customer', 'operator');
create type access_grant_mode     as enum ('read', 'write');
create type access_event_action   as enum ('view', 'export', 'update', 'download');
create type support_notify_kind   as enum ('support_reply', 'grant_started', 'grant_ended');

-- =====================================================================
-- 1. 1:1 문의 — 자체 인앱 스레드 (외부 상담 벤더 미사용)
-- =====================================================================
create table support_threads (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references orgs(id) on delete cascade,
  opened_by       uuid not null references users(id) on delete cascade,
  subject         text not null,
  status          support_thread_status not null default 'open',
  -- 진단용 컨텍스트 **화이트리스트**. 고객사명·대표자명·연락처·금액은 담지 않는다.
  -- 허용 키 외 다른 키가 하나라도 있으면 INSERT/UPDATE 가 실패한다.
  diag_jsonb      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint support_threads_diag_whitelist check (
    diag_jsonb - array[
      'path', 'org_slug', 'role', 'app_version', 'browser', 'last_error_id'
    ]::text[] = '{}'::jsonb
  )
);
create index on support_threads(org_id, last_message_at desc);
create index on support_threads(opened_by);

create table support_messages (
  id                uuid primary key default gen_random_uuid(),
  thread_id         uuid not null references support_threads(id) on delete cascade,
  org_id            uuid not null references orgs(id) on delete cascade,
  author_id         uuid references users(id) on delete set null,
  author_kind       support_author_kind not null,
  body              text not null,
  attachments_jsonb jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);
create index on support_messages(thread_id, created_at);

-- 숫자 뱃지 원천. "내가 볼 일" = read_at is null 인 행 수.
create table support_notifications (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  kind       support_notify_kind not null,
  thread_id  uuid references support_threads(id) on delete cascade,
  grant_id   uuid,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index on support_notifications(user_id, read_at);

-- =====================================================================
-- 2. 접근위임 — 고객이 직접 열어주는 방식(기본 경로)
-- =====================================================================
create table access_grants (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  granted_by    uuid not null references users(id) on delete cascade,
  -- null = 특정 운영자 지정 없음(플랫폼 관리자 누구나). 고객 개시 위임의 기본값.
  grantee_admin uuid references users(id) on delete set null,
  reason        text,
  mode          access_grant_mode not null default 'read',
  granted_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by    uuid references users(id) on delete set null,
  constraint access_grants_window check (expires_at > granted_at)
);
create index on access_grants(org_id, revoked_at, expires_at);

-- 불변식 4: 회사당 활성 위임 1건. 만료분은 아래 트리거가 revoked_at 을 채워
-- 비활성으로 떨어뜨리므로, 이 부분 유니크 인덱스가 "활성 1건"과 동치가 된다.
create unique index access_grants_one_active_per_org
  on access_grants(org_id) where revoked_at is null;

create table access_events (
  id           uuid primary key default gen_random_uuid(),
  grant_id     uuid not null references access_grants(id) on delete cascade,
  at           timestamptz not null default now(),
  action       access_event_action not null,
  target_table text,
  target_id    uuid
);
create index on access_events(grant_id, at);

alter table support_notifications
  add constraint support_notifications_grant_fk
  foreign key (grant_id) references access_grants(id) on delete cascade;

-- =====================================================================
-- 3. 위임 규칙 트리거 (DB 가 최종 방어선 — 앱 코드 우회 불가)
-- =====================================================================

-- 만료분 자동 마감: 새 위임 INSERT 직전에 같은 조직의 만료된 활성 행을 닫는다.
-- 이렇게 해야 "활성 1건" 유니크 인덱스가 만료 위임 때문에 막히지 않는다.
create or replace function public.close_expired_access_grants()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update access_grants
     set revoked_at = expires_at
   where org_id = new.org_id
     and revoked_at is null
     and expires_at <= now();
  return new;
end $$;

create trigger trg_access_grants_close_expired
  before insert on access_grants
  for each row execute function public.close_expired_access_grants();

-- 불변식 3: 멤버(role='member')가 개시한 위임은 읽기 전용으로 강제 고정한다.
-- "보기+고치기"는 owner/admin 만 고를 수 있다. 앱 UI 가 아니라 여기서 못 박는다.
create or replace function public.pin_member_grant_readonly()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role member_role;
begin
  select role into v_role
    from org_members
   where org_id = new.org_id and user_id = new.granted_by;

  if v_role is null then
    raise exception '위임 개시자가 해당 조직의 멤버가 아닙니다';
  end if;

  if v_role = 'member' then
    new.mode := 'read';
  end if;

  return new;
end $$;

create trigger trg_access_grants_pin_readonly
  before insert on access_grants
  for each row execute function public.pin_member_grant_readonly();

-- =====================================================================
-- 4. 위임 판정 헬퍼
--    ⚠ is_org_member()/org_role()/org_scope() 는 **수정하지 않는다**. 아래는 전부 신규.
-- =====================================================================

-- 활성 위임으로 이 조직을 볼 수 있는가. 수임자는 **반드시 플랫폼 관리자**여야 한다
-- (아니면 멤버가 임의의 외부 계정에 조직을 열어줄 수 있게 된다).
create or replace function public.has_active_grant(p_org uuid)
  returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$
  select public.is_platform_admin() and exists (
    select 1
      from public.access_grants g
     where g.org_id = p_org
       and g.revoked_at is null
       and g.expires_at > now()
       and (g.grantee_admin is null or g.grantee_admin = auth.uid())
  );
$$;

-- 쓰기까지 허용된 활성 위임인가(mode='write').
create or replace function public.has_active_grant_write(p_org uuid)
  returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$
  select public.is_platform_admin() and exists (
    select 1
      from public.access_grants g
     where g.org_id = p_org
       and g.revoked_at is null
       and g.expires_at > now()
       and g.mode = 'write'
       and (g.grantee_admin is null or g.grantee_admin = auth.uid())
  );
$$;

-- 불변식 5: 담당범위 상속. 개시자가 scope='assigned' 멤버면 **그 사람 담당 행만**
-- 수임자에게 보인다. owner/admin 또는 scope='all' 개시자면 조직 전체.
create or replace function public.grant_sees_assignee(p_org uuid, p_assigned uuid)
  returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.access_grants g
      join public.org_members granter
        on granter.org_id = g.org_id and granter.user_id = g.granted_by
     where g.org_id = p_org
       and g.revoked_at is null
       and g.expires_at > now()
       and (g.grantee_admin is null or g.grantee_admin = auth.uid())
       and (
            granter.role in ('owner', 'admin')
         or granter.scope = 'all'
         or p_assigned = g.granted_by
       )
  );
$$;

revoke all on function public.has_active_grant(uuid) from public;
revoke all on function public.has_active_grant_write(uuid) from public;
revoke all on function public.grant_sees_assignee(uuid, uuid) from public;
revoke execute on function public.has_active_grant(uuid) from anon;
revoke execute on function public.has_active_grant_write(uuid) from anon;
revoke execute on function public.grant_sees_assignee(uuid, uuid) from anon;
grant execute on function public.has_active_grant(uuid) to authenticated;
grant execute on function public.has_active_grant_write(uuid) to authenticated;
grant execute on function public.grant_sees_assignee(uuid, uuid) to authenticated;

-- =====================================================================
-- 5. 위임 수명주기 RPC (규칙을 한 곳에 모은다)
-- =====================================================================

-- 개시. 오너 승인 없이 **즉시 발효**. 대신 규칙은 전부 여기서 강제된다.
create or replace function public.create_access_grant(
  p_org uuid,
  p_minutes int,
  p_mode access_grant_mode default 'read',
  p_reason text default null,
  p_grantee uuid default null
) returns access_grants
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grant access_grants;
  v_owner uuid;
begin
  if not public.is_org_member(p_org) then
    raise exception '이 조직의 멤버가 아닙니다';
  end if;
  if p_minutes is null or p_minutes <= 0 or p_minutes > 1440 then
    raise exception '위임 기간은 1분~24시간(1440분) 사이여야 합니다';
  end if;

  insert into access_grants(org_id, granted_by, grantee_admin, reason, mode, expires_at)
  values (p_org, auth.uid(), p_grantee, p_reason, coalesce(p_mode, 'read'),
          now() + make_interval(mins => p_minutes))
  returning * into v_grant;

  -- 즉시 오너 알림(숫자 뱃지 원천).
  for v_owner in
    select user_id from org_members
     where org_id = p_org and role = 'owner' and user_id <> auth.uid()
  loop
    insert into support_notifications(org_id, user_id, kind, grant_id)
    values (p_org, v_owner, 'grant_started', v_grant.id);
  end loop;

  -- 감사로그(001 audit_logs).
  insert into audit_logs(org_id, actor, action, target_type, target_id, meta)
  values (p_org, auth.uid(), 'access_grant.created', 'access_grants', v_grant.id,
          jsonb_build_object('mode', v_grant.mode, 'expires_at', v_grant.expires_at,
                             'reason', v_grant.reason));

  return v_grant;
end $$;

-- 종료. 오너/관리자는 어떤 위임이든 강제 종료, 멤버는 **자기 위임만** 종료.
create or replace function public.revoke_access_grant(p_grant uuid)
  returns access_grants
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_grant access_grants;
  v_role  member_role;
  v_owner uuid;
begin
  select * into v_grant from access_grants where id = p_grant;
  if v_grant.id is null then
    raise exception '위임을 찾을 수 없습니다';
  end if;
  if v_grant.revoked_at is not null then
    return v_grant;
  end if;
  if not public.is_org_member(v_grant.org_id) then
    raise exception '이 조직의 멤버가 아닙니다';
  end if;

  v_role := public.org_role(v_grant.org_id);
  if v_role = 'member' and v_grant.granted_by <> auth.uid() then
    raise exception '자기가 개시한 위임만 종료할 수 있습니다';
  end if;

  update access_grants
     set revoked_at = now(), revoked_by = auth.uid()
   where id = p_grant
  returning * into v_grant;

  for v_owner in
    select user_id from org_members
     where org_id = v_grant.org_id and role = 'owner' and user_id <> auth.uid()
  loop
    insert into support_notifications(org_id, user_id, kind, grant_id)
    values (v_grant.org_id, v_owner, 'grant_ended', v_grant.id);
  end loop;

  insert into audit_logs(org_id, actor, action, target_type, target_id, meta)
  values (v_grant.org_id, auth.uid(), 'access_grant.revoked', 'access_grants', v_grant.id,
          jsonb_build_object('revoked_at', v_grant.revoked_at));

  return v_grant;
end $$;

-- 수임자 행위 기록. 감사로그 누락 0을 위해 조회/수정 경로가 이 함수를 호출한다.
create or replace function public.log_access_event(
  p_grant uuid,
  p_action access_event_action,
  p_target_table text default null,
  p_target_id uuid default null
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
begin
  select org_id into v_org from access_grants where id = p_grant;
  if v_org is null then
    raise exception '위임을 찾을 수 없습니다';
  end if;
  if not (public.has_active_grant(v_org) or public.is_org_member(v_org)) then
    raise exception '이 위임에 대한 기록 권한이 없습니다';
  end if;

  insert into access_events(grant_id, action, target_table, target_id)
  values (p_grant, p_action, p_target_table, p_target_id);
end $$;

revoke all on function public.create_access_grant(uuid, int, access_grant_mode, text, uuid) from public;
revoke all on function public.revoke_access_grant(uuid) from public;
revoke all on function public.log_access_event(uuid, access_event_action, text, uuid) from public;
grant execute on function public.create_access_grant(uuid, int, access_grant_mode, text, uuid) to authenticated;
grant execute on function public.revoke_access_grant(uuid) to authenticated;
grant execute on function public.log_access_event(uuid, access_event_action, text, uuid) to authenticated;

-- =====================================================================
-- 6. RLS — 신규 테이블
-- =====================================================================
alter table support_threads       enable row level security;
alter table support_messages      enable row level security;
alter table support_notifications enable row level security;
alter table access_grants         enable row level security;
alter table access_events         enable row level security;

-- 문의 스레드: 개시자 본인 + 조직 owner/admin + 운영자(플랫폼 관리자).
create or replace function public.can_see_support_thread(p_thread uuid)
  returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.support_threads t
     where t.id = p_thread
       and (
            public.is_platform_admin()
         or (public.is_org_member(t.org_id) and (
               public.org_role(t.org_id) in ('owner', 'admin')
               or t.opened_by = auth.uid()
            ))
       )
  );
$$;
revoke all on function public.can_see_support_thread(uuid) from public;
grant execute on function public.can_see_support_thread(uuid) to authenticated;

create policy support_threads_select on support_threads for select
  using (
    public.is_platform_admin()
    or (public.is_org_member(org_id) and (
          public.org_role(org_id) in ('owner', 'admin') or opened_by = auth.uid()
       ))
  );

create policy support_threads_insert on support_threads for insert
  with check (public.is_org_member(org_id) and opened_by = auth.uid());

-- 상태 갱신(답변완료/종료)은 스레드가 보이는 사람만.
create policy support_threads_update on support_threads for update
  using (public.can_see_support_thread(id))
  with check (public.can_see_support_thread(id));

create policy support_messages_select on support_messages for select
  using (public.can_see_support_thread(thread_id));

-- 고객 메시지는 조직 멤버가, 운영자 메시지는 플랫폼 관리자가 쓴다.
create policy support_messages_insert on support_messages for insert
  with check (
    author_id = auth.uid()
    and public.can_see_support_thread(thread_id)
    and (
      (author_kind = 'customer' and public.is_org_member(org_id))
      or (author_kind = 'operator' and public.is_platform_admin())
    )
  );

create policy support_notifications_own on support_notifications for select
  using (user_id = auth.uid());
create policy support_notifications_read on support_notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 위임 원장: 조직 멤버는 자기 조직 것, 운영자는 자기에게 열린 것.
create policy access_grants_select on access_grants for select
  using (public.is_org_member(org_id) or public.has_active_grant(org_id));

-- INSERT/UPDATE 는 정책을 열지 않는다 — 생성·종료는 위 RPC 로만 (규칙 우회 방지).

-- 감사 이벤트: append-only. UPDATE/DELETE 정책을 만들지 않는다(= 거부).
create policy access_events_select on access_events for select
  using (exists (
    select 1 from access_grants g
     where g.id = access_events.grant_id
       and (public.is_org_member(g.org_id) or public.has_active_grant(g.org_id))
  ));
create policy access_events_insert on access_events for insert
  with check (exists (
    select 1 from access_grants g
     where g.id = access_events.grant_id
       and (public.is_org_member(g.org_id) or public.has_active_grant(g.org_id))
  ));

revoke update, delete on access_events from authenticated;
revoke update, delete on access_events from anon;

-- =====================================================================
-- 7. 위임 접근 정책 — 기존 정책 **무수정**, permissive 정책을 OR 로 추가만 한다.
--    (기존 `*_rw` 정책은 그대로 남아 조직 멤버 격리를 계속 담당한다)
-- =====================================================================

-- ── 담당범위 상속이 필요한 테이블(assigned_to 보유) ──
create policy companies_grant_read on companies for select
  using (public.has_active_grant(org_id) and public.grant_sees_assignee(org_id, assigned_to));
create policy companies_grant_write on companies for update
  using (public.has_active_grant_write(org_id) and public.grant_sees_assignee(org_id, assigned_to))
  with check (public.has_active_grant_write(org_id) and public.grant_sees_assignee(org_id, assigned_to));

create policy deals_grant_read on deals for select
  using (public.has_active_grant(org_id) and public.grant_sees_assignee(org_id, assigned_to));
create policy deals_grant_write on deals for update
  using (public.has_active_grant_write(org_id) and public.grant_sees_assignee(org_id, assigned_to))
  with check (public.has_active_grant_write(org_id) and public.grant_sees_assignee(org_id, assigned_to));

create policy items_grant_read on items for select
  using (public.has_active_grant(org_id) and public.grant_sees_assignee(org_id, assigned_to));
create policy items_grant_write on items for update
  using (public.has_active_grant_write(org_id) and public.grant_sees_assignee(org_id, assigned_to))
  with check (public.has_active_grant_write(org_id) and public.grant_sees_assignee(org_id, assigned_to));

-- ── 조직 스코프 테이블(담당범위는 상위 행에서 통제 — 기존 정책과 동일 수준) ──
create policy pipelines_grant_read   on pipelines           for select using (public.has_active_grant(org_id));
create policy activities_grant_read  on activities          for select using (public.has_active_grant(org_id));
create policy fielddefs_grant_read   on field_defs          for select using (public.has_active_grant(org_id));
create policy fieldvals_grant_read   on field_values        for select using (public.has_active_grant(org_id));
create policy savedviews_grant_read  on saved_views         for select using (public.has_active_grant(org_id));
create policy settlements_grant_read on settlements         for select using (public.has_active_grant(org_id));
create policy boards_grant_read      on boards              for select using (public.has_active_grant(org_id));
create policy bgroups_grant_read     on board_groups        for select using (public.has_active_grant(org_id));
create policy bcols_grant_read       on board_columns       for select using (public.has_active_grant(org_id));
create policy itemvals_grant_read    on item_values         for select using (public.has_active_grant(org_id));
create policy bviews_grant_read      on board_views         for select using (public.has_active_grant(org_id));
create policy orgs_grant_read        on orgs                for select using (public.has_active_grant(id));

create policy stages_grant_read on stages for select
  using (exists (
    select 1 from pipelines p
     where p.id = stages.pipeline_id and public.has_active_grant(p.org_id)
  ));

create policy fieldvals_grant_write on field_values for update
  using (public.has_active_grant_write(org_id)) with check (public.has_active_grant_write(org_id));
create policy itemvals_grant_write on item_values for update
  using (public.has_active_grant_write(org_id)) with check (public.has_active_grant_write(org_id));

-- =====================================================================
-- 8. 홈택스 차단 — 위임 범위에서도 **항상** 안 보인다 (재수탁 개인정보)
--    RESTRICTIVE 정책은 모든 permissive 정책과 AND 로 묶인다. 즉 나중에 누가
--    실수로 hometax 에 위임 정책을 추가해도 실제 조직 멤버가 아니면 통과 못 한다.
-- =====================================================================
create policy htconsent_no_grant on hometax_consents as restrictive for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));
create policy htdocs_no_grant on hometax_docs as restrictive for all
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

comment on policy htconsent_no_grant on hometax_consents is
  'T08: 홈택스 위임동의는 재수탁 개인정보 — access_grants 위임으로도 열리지 않는다.';
comment on policy htdocs_no_grant on hometax_docs is
  'T08: 홈택스 수집서류는 재수탁 개인정보 — access_grants 위임으로도 열리지 않는다.';

-- =====================================================================
-- 끝.
-- =====================================================================

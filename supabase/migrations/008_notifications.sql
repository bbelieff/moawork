-- 008_notifications.sql — mod.notify 인앱 알림(뱃지·소식창)
--
-- 설계 핵심: "봤다(read_at)" 와 "했다(resolved_at)" 를 **다른 컬럼**으로 분리한다.
--   숫자 뱃지 = 내가 할 일 = is_action AND resolved_at IS NULL  → 화면에 들어가도 사라지지 않는다.
--   점   뱃지 = 안 본 변화                                      → 화면에 들어가면(워터마크 갱신) 사라진다.
-- read_at 하나로 둘을 겸하면 "화면만 열어도 할 일이 사라지는" 사고가 난다.
--
-- 회사 소식(피드)은 새 테이블을 만들지 않고 기존 audit_logs 를 재사용한다
-- (001_schema_v1.sql: org_id·actor·action·target_type·target_id·meta·at + index(org_id, at)).
-- activities 는 deal_id 종속(딜 단위)이라 조직 피드로는 부적합해 채택하지 않았다.

-- =====================================================================
-- 1. notifications — 개인 인박스(내 알림)
-- =====================================================================
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  -- 수신자. 조직 멤버십과 함께 RLS 로 이중 격리한다.
  user_id     uuid not null references users(id) on delete cascade,
  type        text not null,                 -- join_request / assigned / mention / ...
  title       text not null,
  body        text,
  target_type text,                          -- deal / member_approval / notice ...
  target_id   uuid,
  actor_id    uuid references users(id) on delete set null,
  -- true = 행동이 필요한 항목(숫자 뱃지 대상)
  is_action   boolean not null default false,
  -- 봤다: 점 소거용. 숫자에는 영향을 주지 않는다.
  read_at     timestamptz,
  -- 했다: 숫자 소거용. is_action 항목은 이 값이 있어야만 카운트에서 빠진다.
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);

-- 뱃지 집계(미해결 액션 / 미열람)용. 부분 인덱스로 실제 조회 패턴만 좁게 태운다.
create index if not exists notifications_user_open_actions_idx
  on notifications(user_id, org_id)
  where is_action and resolved_at is null;
create index if not exists notifications_user_unread_idx
  on notifications(user_id, org_id)
  where read_at is null;
-- 패널 목록(최신순).
create index if not exists notifications_user_recent_idx
  on notifications(user_id, org_id, created_at desc);

alter table notifications enable row level security;

-- 남의 알림은 조회·수정 불가. 조직 멤버십까지 함께 확인해 타 조직 혼입을 막는다.
create policy notifications_select_own on notifications for select
  using (user_id = auth.uid() and public.is_org_member(org_id));
-- 갱신은 읽음/처리 표시만 필요하므로 select 와 동일 조건으로 제한한다.
create policy notifications_update_own on notifications for update
  using (user_id = auth.uid() and public.is_org_member(org_id))
  with check (user_id = auth.uid() and public.is_org_member(org_id));
-- 발행은 서버(서비스 롤)·트리거 경로만 사용한다. 클라이언트 insert 정책은 두지 않는다
-- (알림 남발·위조 방지). service_role 은 RLS 를 우회한다.

-- =====================================================================
-- 2. notification_surface_seen — 화면별 "봤다" 워터마크(점 소거)
-- =====================================================================
-- 행마다 read_at 을 찍는 대신 화면 단위 시각 하나만 올린다.
-- 피드 항목이 워터마크보다 새로우면 점이 켜진다.
create table if not exists notification_surface_seen (
  org_id      uuid not null references orgs(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  surface_key text not null,                 -- 사이드바 nav key (dash/new/work/members/...)
  seen_at     timestamptz not null default now(),
  primary key (org_id, user_id, surface_key)
);

alter table notification_surface_seen enable row level security;

create policy surface_seen_rw_own on notification_surface_seen for all
  using (user_id = auth.uid() and public.is_org_member(org_id))
  with check (user_id = auth.uid() and public.is_org_member(org_id));

-- =====================================================================
-- 3. audit_logs — 회사 소식 피드로 재사용 + 담당범위(scope) 반영
-- =====================================================================
-- 기존 정책 audit_select 는 is_org_member(org_id) 만 확인해 조직 내 **모든** 행을 노출한다.
-- scope='assigned' 멤버가 남의 딜 소식까지 보게 되므로 정책을 교체한다.
-- (RLS 정책은 OR 로 합쳐지므로, 좁히려면 추가가 아니라 교체해야 한다.)
drop policy if exists audit_select on audit_logs;

create policy audit_select on audit_logs for select
  using (
    public.is_org_member(org_id)
    and (
      -- 전체 보기 멤버는 조직 전체 소식을 본다.
      public.org_scope(org_id) = 'all'
      -- 담당범위 제한 멤버: 본인이 일으킨 소식은 본다.
      or actor = auth.uid()
      -- 딜 소식은 '내 담당' 만. (딜 외 조직 단위 소식은 아래 절에서 허용)
      or (
        target_type = 'deal'
        and exists (
          select 1 from deals d
          where d.id = audit_logs.target_id
            and d.org_id = audit_logs.org_id
            and d.assigned_to = auth.uid()
        )
      )
      -- 딜이 아닌 조직 단위 소식(공지 등)은 담당범위와 무관하게 공유한다.
      or target_type is distinct from 'deal'
    )
  );

-- 피드 조회는 (org_id, at desc) 로 최신순 페이징한다. 001 의 index(org_id, at) 를 사용한다.

-- =====================================================================
-- 4. 연동: 가입 요청 도착 → 오너에게 숫자 뱃지 알림
-- =====================================================================
-- 클라이언트 insert 정책을 두지 않았으므로(위조·남발 방지) 발행은 definer 트리거로만 한다.
-- 승인 화면(/settings/members/approvals)은 이미 존재하므로 딥링크 대상만 지정한다.
create or replace function public.notify_owners_join_request()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind <> 'join' or new.status <> 'pending' or new.target_org_id is null then
    return new;
  end if;

  -- 해당 조직 오너 전원에게 1건씩. is_action=true → 숫자 뱃지(처리해야 사라진다).
  insert into notifications (org_id, user_id, type, title, body, target_type, target_id, actor_id, is_action)
  select
    new.target_org_id,
    m.user_id,
    'join_request',
    '합류 요청이 도착했습니다',
    -- 요청자 이름·이메일 등 개인정보는 문구에 넣지 않는다(승인 화면에서 확인).
    '승인 대기 중인 합류 요청이 있습니다.',
    'member_approval',
    new.id,
    new.requester_user_id,
    true
  from org_members m
  where m.org_id = new.target_org_id
    and m.role = 'owner'
    -- 본인이 오너이면서 스스로 요청한 경우는 알리지 않는다.
    and m.user_id is distinct from new.requester_user_id;

  return new;
end $$;

drop trigger if exists trg_notify_join_request on public.workspace_entry_requests;
create trigger trg_notify_join_request
  after insert on public.workspace_entry_requests
  for each row execute function public.notify_owners_join_request();

-- 요청이 처리(승인/거절/취소)되면 해당 알림을 자동으로 '했다' 처리해 숫자를 내린다.
create or replace function public.resolve_join_request_notifications()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = old.status or new.status = 'pending' then
    return new;
  end if;

  update notifications
     set resolved_at = coalesce(resolved_at, now()),
         read_at     = coalesce(read_at, now())
   where target_type = 'member_approval'
     and target_id = new.id
     and resolved_at is null;

  return new;
end $$;

drop trigger if exists trg_resolve_join_request_notifications on public.workspace_entry_requests;
create trigger trg_resolve_join_request_notifications
  after update on public.workspace_entry_requests
  for each row execute function public.resolve_join_request_notifications();

-- 참고(예약 slug): 전체보기 화면은 최상위 /notifications 가 아니라
-- **이미 예약된** /settings/notifications 아래에 둔다.
-- 새 최상위 라우트를 만들면 같은 이름의 워크스페이스 slug 와 충돌하는데,
-- 예약 목록이 006 의 제약 2곳 + 함수 1곳 + TS 1곳(총 4곳)에 복제돼 있어
-- 새 항목 추가가 곧 4중 수기 동기화를 뜻한다(가드 테스트도 006 만 정본으로 읽는다).
-- 이 구조 정리는 워크스페이스-엔트리 소유 트랙에 남기고, 여기서는 예약된 경로를 재사용한다.

-- =====================================================================
-- 5. 스키마 버전 메타
-- =====================================================================
insert into public.app_meta (key, value)
values ('schema_version', '008')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

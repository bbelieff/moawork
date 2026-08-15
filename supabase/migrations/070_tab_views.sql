-- =====================================================================
-- 035_tab_views.sql — V6 뷰 시스템 (F-2, BBE-117)
-- 성격 : additive. 001~034 무수정.
--
-- 왜 001 saved_views / 003·004 board_views 를 재사용하지 않는가:
--   · saved_views(001) 는 field_entity('company'|'deal') 에 결합 — V6 사이드바 탭은
--     sectionPreset 기반(신규리드 관리·리드컨택 관리·계약업체 실무·업체관리 현황)이라
--     entity enum 으로 표현되지 않는다.
--   · board_views(003/004) 는 boards.id(EAV 보드 엔진, 로컬 리포지토리만 연결)에 FK — V6 탭은
--     아직 그 보드 엔진 위에 있지 않고(CT03 필드/보드 컴포넌트 병행 작업 중, 본 카드 리스 밖),
--     FK로 묶으면 그 트랙이 아직 만들지 않은 행 모델에 선결합된다.
--   · 위 두 테이블 다 "보는 사람에 따라 결과가 달라지는" 동적 조건(D26 내 담당/내 팀 담당)이 없다.
-- 그래서 탭의 **내부 주소 문자열**(board_key, 예: 'new'|'contact'|'work'|'notice' — BBE-103 §D06과
-- 동일 원칙: 표시 이름이 바뀌어도 이 키는 유지)로만 결합하는 신규 테이블로 분리한다.
-- =====================================================================

create table tab_views (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references orgs(id) on delete cascade,
  board_key             text not null,
  board_id              uuid not null references boards(id) on delete cascade,
  owner_id              uuid references users(id) on delete cascade,
  name                  text not null,
  kind                  text not null default 'board'
                        check (kind in ('board','flat','cal')),
  visibility            text not null default 'private'
                        check (visibility in ('private','shared')),
  person_scope          text not null default 'none'
                        check (person_scope in ('none','viewer','team','fixed')),
  person_scope_user_id  uuid references users(id) on delete set null,
  filters_jsonb         jsonb not null default '{}',
  sort_jsonb             jsonb not null default '[]',
  hidden_columns_jsonb  jsonb not null default '[]',
  column_order_jsonb    jsonb not null default '[]',
  calendar_field_key    text,
  config_jsonb          jsonb not null default '{}',
  is_default            boolean not null default false,
  last_used_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- fixed 조건은 대상 사람이 반드시 지정돼야 한다(D26 — 이름을 박은 뷰는 예외 취급).
  check (person_scope <> 'fixed' or person_scope_user_id is not null),
  -- 캘린더 뷰는 기준 날짜 컬럼이 있어야 렌더 가능하다.
  check (kind <> 'cal' or calendar_field_key is not null),
  unique (org_id, board_key, owner_id, name)
);
create index on tab_views(org_id, board_key);
create index on tab_views(org_id, board_id, last_used_at desc);
create unique index tab_views_one_default_per_user_board
  on tab_views(org_id, board_id, owner_id) where is_default;

alter table tab_views enable row level security;

-- 읽기: 조직원이면서 (공용이거나 본인 소유)만. 조회 범위(scope) 자체는 이 정책의 몫이 아니다 —
-- 그건 실제 레코드(딜/아이템) RLS·앱 레이어가 뷰보다 먼저 적용한다(D24, 결정대장 §D).
-- 이 정책은 "뷰 정의를 누가 볼 수 있나"만 다룬다.
create policy tabviews_select on tab_views for select
  using (public.is_org_member(org_id) and (visibility = 'shared' or owner_id = auth.uid()));

-- 쓰기: 본인 소유로만 생성. 조직 소유자/관리자는 공용 뷰 정리를 위해 공용 뷰도 수정·삭제 가능.
create policy tabviews_insert on tab_views for insert
  with check (public.is_org_member(org_id) and owner_id = auth.uid());

create policy tabviews_update on tab_views for update
  using (
    public.is_org_member(org_id)
    and (owner_id = auth.uid() or public.org_role(org_id) in ('owner','admin'))
  )
  with check (
    public.is_org_member(org_id)
    and (owner_id = auth.uid() or public.org_role(org_id) in ('owner','admin'))
  );

create policy tabviews_delete on tab_views for delete
  using (
    public.is_org_member(org_id)
    and (owner_id = auth.uid() or public.org_role(org_id) in ('owner','admin'))
  );

revoke all on table tab_views from public, anon;
grant select, insert, update, delete on table tab_views to authenticated;

create or replace function set_tab_view_default(p_view_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_org uuid; v_board uuid; v_owner uuid;
begin
  select org_id, board_id, owner_id into v_org, v_board, v_owner
    from public.tab_views where id = p_view_id for update;
  if not found or v_owner is distinct from (select auth.uid()) then
    raise exception 'view unavailable' using errcode = '42501';
  end if;
  update public.tab_views set is_default = false
    where org_id = v_org and board_id = v_board and owner_id = v_owner and is_default;
  update public.tab_views set is_default = true, last_used_at = now(), updated_at = now()
    where id = p_view_id;
end; $$;
revoke all on function set_tab_view_default(uuid) from public, anon;
grant execute on function set_tab_view_default(uuid) to authenticated;

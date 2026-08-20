-- moa-migration-guard: logical_key=101_bbe236_company_csv_import predecessor=100_bbe235_work_board_projection digest=51e889463ead2b8c89ccd45ad4dc5533a0f4ab2f169654bbdf775b99c5e4aeab foundation=false

select public.begin_guarded_migration(
  p_logical_key => '101_bbe236_company_csv_import',
  p_file_name => '101_bbe236_company_csv_import.sql',
  p_file_digest => '51e889463ead2b8c89ccd45ad4dc5533a0f4ab2f169654bbdf775b99c5e4aeab',
  p_expected_predecessor => '100_bbe235_work_board_projection',
  p_executor => 'DC-00',
  p_thread_id => '019fe9c2-5d3b-7e42-a071-3b8d62e5f9d3',
  p_foundation => false
);

-- 100 · 고객사 CSV 일괄 등록 — 멱등 원장
--
-- 왜 필요한가
--   CSV 가져오기는 «다시 눌러도 안전해야» 한다. 네트워크가 끊겼을 때 사용자가
--   가장 먼저 하는 일이 다시 누르는 것이고, 그때 200건이 400건이 되면 안 된다.
--   025_platform_demo_crm_admin_boundary.sql:106 이 데모 경로에서 쓰는
--   request_id 규약을 «일반 사용자 경로» 로 복제한다. (RPC 자체는 재사용하지 않는다 —
--   그쪽은 is_platform_admin() + canary org 로 이중 잠금돼 있어 일반 사용자가 못 쓴다.)
--
-- 무엇을 «안» 하나
--   이 마이그레이션은 행 저장을 대신하지 않는다. 회사 INSERT 는 앱이
--   supabaseCrmSource.createCompany 로 한다(RLS·담당범위 규칙이 거기 있다).
--   여기는 «이 요청을 이미 처리했는가» 만 기록한다.
--
-- 상한 (025 규약 복제)
--   한 요청 500행 · payload 1MB. 앱에서도 막지만 DB 에서도 막는다 —
--   앱만 막으면 다음 호출자가 그 규칙을 모른다.
--
-- 되돌리기
--   drop table if exists public.company_import_requests;

create table if not exists public.company_import_requests (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  request_id  uuid not null,
  actor_id    uuid,
  row_count   int  not null default 0,
  created_at  timestamptz not null default now(),
  primary key (org_id, request_id),
  constraint company_import_row_cap check (row_count >= 0 and row_count <= 500)
);

comment on table public.company_import_requests is
  '고객사 CSV 가져오기 멱등 원장. 같은 request_id 를 다시 보내면 두 번 저장되지 않는다(025 규약 복제).';

alter table public.company_import_requests enable row level security;

drop policy if exists company_import_requests_rw on public.company_import_requests;
create policy company_import_requests_rw on public.company_import_requests
  for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create index if not exists company_import_requests_org_created_idx
  on public.company_import_requests(org_id, created_at desc);

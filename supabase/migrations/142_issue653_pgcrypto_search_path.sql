-- moa-migration-guard: logical_key=142_issue653_pgcrypto_search_path predecessor=141_issue632_start_company_work_v2 digest=9b1ade99a348374195e971eeb7bb63c8f0fa604a6ff9ffd174de849b63627ba7 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '142_issue653_pgcrypto_search_path',
  p_file_name => '142_issue653_pgcrypto_search_path.sql',
  p_file_digest => '9b1ade99a348374195e971eeb7bb63c8f0fa604a6ff9ffd174de849b63627ba7',
  p_expected_predecessor => '141_issue632_start_company_work_v2',
  p_executor => 'DC',
  p_thread_id => '3ddf2455-2e0c-4e8a-870a-33b8cdf13289',
  p_foundation => false
);

-- 보드 컬럼 명령이 «한 번도» 안 되던 것을 고친다 (#653).
--
-- ## 무엇이 잘못돼 있었나
--
-- 아래 함수들은 SECURITY DEFINER 이면서 search_path 가 'public, pg_temp' 인데,
-- 본문에서 pgcrypto 의 digest() 를 «스키마 없이» 부른다.
-- 그런데 이 프로젝트의 pgcrypto 는 public 이 아니라 extensions 에 설치돼 있다.
--
--     pgcrypto 설치 스키마        extensions
--     함수의 search_path          public, pg_temp      ← extensions 가 없다
--     결과                        function digest(text, unknown) does not exist  (42883)
--
-- 그래서 authenticated 로 부르면 «항상» 42883 으로 죽었다. 실측(2026-08-31):
--
--     board_columns                    398개
--     board_column_command_receipts    0건    ★ 한 번도 커밋된 적이 없다
--     board_column_audit               0건    ★
--
-- 화면에서는 42883 이 오류 표에 없어 기본 문구로 떨어졌다 —
-- 「컬럼 작업에 실패했습니다. 잠시 뒤 다시 시도해 주세요.」
-- 잠시 뒤 다시 시도해도 영원히 안 되는데 그렇게 말하고 있었다.
--
-- ## 왜 시험이 초록이었나
--
-- PGlite 시험은 pgcrypto 를 public 에 설치한다. 로컬에서는 digest 가 그냥 풀린다.
-- 운영(Supabase)만 extensions 에 둔다 — «스키마 배치» 가 로컬과 달라서
-- 시험 3,497개가 전부 초록인데 운영은 100% 실패하는 상태가 됐다.
--
-- ## 왜 본문을 안 고치나
--
-- ★ 함수 본문을 한 글자도 건드리지 않는다. search_path 만 넓힌다.
--   140 번 파일이 같은 이유로 경고한다 — 「손으로 옮겨 적으면 권한 판정이 조금씩
--   달라지고, 그건 권한 하향이 될 수 있다」. 여기서 고쳐야 할 것은 로직이 아니라
--   «이름을 어디서 찾는가» 하나뿐이므로, 그 하나만 바꾼다.
--
-- ★ extensions 를 넣어도 가로채기 위험이 없다. 실측한 권한:
--     extensions 스키마 ACL   anon=U · authenticated=U · service_role=U   (CREATE 없음)
--   즉 신뢰할 수 없는 역할이 가짜 digest 를 심을 수 없다. public 은 이미 첫 자리에 있었다.
--
-- ★ pg_temp 를 «맨 뒤에» 그대로 둔다. 앞에 오면 임시 객체가 이름을 가로챌 수 있다.

alter function public.execute_board_column_command(
  p_org_id uuid, p_board_id uuid, p_column_id uuid, p_operation text,
  p_request_id uuid, p_payload jsonb, p_copy_values boolean
) set search_path = public, extensions, pg_temp;

alter function public.execute_board_column_command_legacy_bbe176(
  p_org_id uuid, p_board_id uuid, p_column_id uuid, p_operation text,
  p_request_id uuid, p_payload jsonb
) set search_path = public, extensions, pg_temp;

alter function public.board_column_type_dry_run(
  p_org_id uuid, p_board_id uuid, p_column_id uuid, p_target_type field_type
) set search_path = public, extensions, pg_temp;

-- ★ 컬럼만의 문제가 아니었다 — 「새 항목」(행 추가)도 같은 자리에서 죽는다.
alter function public.create_board_item_with_values(
  p_org_id uuid, p_board_id uuid, p_group_id uuid, p_title text,
  p_assigned_to uuid, p_values jsonb, p_request_id uuid
) set search_path = public, extensions, pg_temp;

alter function public.set_board_column_date_schedule(
  p_org_id uuid, p_board_id uuid, p_column_id uuid, p_item_id uuid,
  p_target_user_id uuid, p_kind text, p_scheduled_for timestamptz,
  p_request_id uuid, p_payload jsonb
) set search_path = public, extensions, pg_temp;

alter function public.cancel_board_column_date_schedule(
  p_org_id uuid, p_schedule_id uuid, p_request_id uuid
) set search_path = public, extensions, pg_temp;

-- ## 여기서 멈추지 않고 «다시 못 생기게» 막는다
--
-- 위 여섯 개를 고쳐도, 다음 사람이 같은 모양으로 함수를 하나 더 만들면 같은 자리를 다시 밟는다.
-- #645 Round 1 이 「stage move + Activity append 에 payload digest 계약」을 두겠다고 적어 뒀다 —
-- 그 새 함수가 정확히 이 함정 위에 서게 된다.
-- 그래서 «적용 시점에» 검사해서, 남은 게 있으면 이 마이그레이션이 실패한다.

do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and pg_get_functiondef(p.oid) ~* '(^|[^.a-z_])(digest|crypt|gen_salt|hmac)\s*\('
    and not coalesce(array_to_string(p.proconfig, ','), '') like '%extensions%';

  if v_bad is not null then
    raise exception
      'pgcrypto 를 스키마 없이 부르면서 search_path 에 extensions 가 없는 SECURITY DEFINER 함수가 남아 있습니다: %',
      v_bad
      using errcode = '22023';
  end if;
end $$;

-- ## 적용 뒤 사실 확인
--
-- digest 가 실제로 풀리는지 여기서 한 번 잡아 본다. 못 풀면 이 마이그레이션이 실패한다 —
-- 「적용은 됐는데 여전히 안 되는」 상태로 넘어가지 않게 한다.

do $$
begin
  perform extensions.digest('moawork', 'sha256');
exception when undefined_function then
  raise exception 'extensions.digest 를 찾을 수 없습니다 — pgcrypto 설치 위치를 확인하세요'
    using errcode = '22023';
end $$;

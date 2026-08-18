-- moa-migration-guard: logical_key=096_bbe197_board_column_write_restore predecessor=095_bbe172_new_lead_contact_transition digest=2d105e93b9db17fb5615975af26c4483a31be84d78cb6cd53d10b5c9e0d29eff foundation=false

select public.begin_guarded_migration(
  p_logical_key => '096_bbe197_board_column_write_restore',
  p_file_name => '096_bbe197_board_column_write_restore.sql',
  p_file_digest => '2d105e93b9db17fb5615975af26c4483a31be84d78cb6cd53d10b5c9e0d29eff',
  p_expected_predecessor => '095_bbe172_new_lead_contact_transition',
  p_executor => 'DC-00',
  p_thread_id => '019fe8b1-4c2a-7d31-9f60-2a7c51d4e8b3',
  p_foundation => false
);

-- BBE-197 — 컬럼을 만들고·지우고·폭을 바꾸는 권한을 되돌린다.
--
-- 무엇이 사라졌었나
--   089_bbe176_column_metadata_canonical.sql 이 두 가지를 동시에 했다.
--     :277  revoke insert,update,delete on public.board_columns from public,anon,authenticated;
--     :139  drop policy bcols_rw   (003 이 만든 읽기+쓰기 정책)
--     :141  create policy bcols_select  (읽기만)
--   즉 «테이블 권한» 과 «RLS 쓰기 정책» 이 **둘 다** 없어졌다. 재부여는 어디에도 없었다.
--
-- 왜 앱이 죽었나
--   089 의 설계 의도는 「모든 컬럼 변경은 execute_board_column_command RPC 로만」이었고
--   :279 에서 그 함수 실행 권한을 authenticated 에게 줬다. 설계 자체는 온전하다.
--   그런데 **앱이 그 RPC 로 재배선되지 않았다.** lib/repo/supabase/boardsRepo.ts 는 지금도
--   .from("board_columns").insert(...) / .update(...) / .delete(...) 를 직접 부른다.
--   앱은 anon key 로 접속해 authenticated 로 동작하므로(§9.2 상 service_role 은 쓰지 않는다)
--   컬럼 추가·삭제·폭 조절·프리셋 적용이 전부 권한 오류로 떨어졌다.
--
--   운영 적용 여부는 추측이 아니다. 2026-08-17 운영 SQL 편집기에서 직접 확인했다:
--     select count(*) from information_schema.columns
--      where table_name='board_columns' and column_name in ('archived_at','deleted_by');  -- → 2
--   089 는 적용돼 있다. 따라서 이 결함은 지금 운영에서 살아 있다.
--
-- 이 마이그레이션이 하는 일
--   003_boards_engine.sql:96 의 bcols_rw 와 «같은 판정 기준»(is_org_member)으로 쓰기를 되돌린다.
--   읽기 정책 bcols_select 는 손대지 않는다 — view_policy_jsonb 기반 노출 제어는 089 의 성과이고
--   이 카드가 되돌리려는 대상이 아니다.
--
-- ★ 이 마이그레이션이 하지 않는 일 — 후속 카드가 필요하다
--   089 는 컬럼 변경마다 board_column_audit(감사) 와 board_column_command_receipts(멱등 영수증) 를
--   남기도록 설계됐다. 앱이 테이블을 직접 쓰는 한 그 두 기록은 남지 않는다.
--   **감사 기록을 되찾으려면 앱을 execute_board_column_command 로 재배선해야 한다.**
--   여기서 그것까지 하지 않는 이유: 그건 앱 변경이고, 지금 운영에서 기능이 완전히 죽어 있어
--   되살리는 것이 먼저다.
--
--   ★★ 잃는 것은 «기록» 만이 아니다 — «동작 보장» 도 잃는다 (DC-15 검수 지적).
--   board_column_command_receipts 는 단순한 로그가 아니라 request_id 기반 **멱등 영수증**이다
--   (089:196-200 — 같은 request_id 가 다시 오면 이전 결과를 재생하고 새로 쓰지 않는다).
--   직접 쓰기로 돌아가면 그 방어가 없어진다. **더블클릭·재시도로 같은 컬럼이 둘 생길 수 있다.**
--   후속 재배선 카드는 「감사를 되찾는다」가 아니라 **「멱등과 감사를 되찾는다」** 로 적어야 한다.
--
--   반대로, 잃지 «않는» 것도 분명히 해 둔다 (같은 검수):
--   컬럼 메타데이터 검증은 RPC 가 아니라 **테이블 CHECK 제약**에 박혀 있다
--   (089:53-55 `board_columns_policy_objects` → `board_column_metadata_is_valid(...)`).
--   따라서 RPC 를 우회해 직접 써도 **잘못된 정책/검증 JSON 은 여전히 들어가지 못한다.**
--   이 마이그레이션의 위험은 그만큼 좁다.

-- ① 테이블 권한 재부여. select 는 이미 있으므로 건드리지 않는다.
grant insert, update, delete on public.board_columns to authenticated;

-- ② RLS 쓰기 정책 복원. 정책이 없으면 grant 만으로는 여전히 한 행도 못 쓴다.
--    세 동작을 한 정책(for all)이 아니라 셋으로 나눠 만든다 — 나중에 한 동작만
--    다시 잠글 때 나머지를 건드리지 않아도 되고, 무엇이 열려 있는지 이름으로 보인다.
drop policy if exists bcols_insert on public.board_columns;
drop policy if exists bcols_update on public.board_columns;
drop policy if exists bcols_delete on public.board_columns;

create policy bcols_insert on public.board_columns for insert to authenticated
  with check (public.is_org_member(org_id));

create policy bcols_update on public.board_columns for update to authenticated
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));

create policy bcols_delete on public.board_columns for delete to authenticated
  using (public.is_org_member(org_id));

-- 되돌리는 법 (097 과 같은 형식으로 남긴다 — 한쪽에만 있으면 다음 사람이 못 찾는다):
--   revoke insert, update, delete on public.board_columns from authenticated;
--   drop policy if exists bcols_insert on public.board_columns;
--   drop policy if exists bcols_update on public.board_columns;
--   drop policy if exists bcols_delete on public.board_columns;
-- 그러면 089 직후 상태(읽기 정책 bcols_select 만 남고 쓰기는 RPC 로만)로 정확히 돌아간다.

-- ③ 되돌아왔는지 이 마이그레이션 안에서 스스로 확인한다.
--    「적용했다」와 「적용돼서 동작한다」는 다르다. 조용히 반쯤 적용되는 것을 막는다.
--
--    ★ 이름만 세지 않는다 (DC-15 검수 지적). 정책을 이름으로만 세면
--      `bcols_insert` 라는 «이름» 인데 실제로는 `for select` 로 만들어져도 통과한다.
--      그리고 RLS 자체가 꺼져 있으면 정책이 몇 개든 무의미하다.
--      이 장치의 진짜 값어치는 「나중에 누가 그 정책을 딴 데서 바꿨을 때」이고,
--      그게 정확히 이름만 봐서는 안 잡히는 경우다. 그래서 cmd 와 relrowsecurity 를 함께 본다.
do $$
declare
  v_missing text;
  v_policies int;
  v_rls boolean;
begin
  select string_agg(p, ', ' order by p) into v_missing
  from unnest(array['INSERT','UPDATE','DELETE']) p
  where not has_table_privilege('authenticated', 'public.board_columns', p);
  if v_missing is not null then
    raise exception 'board_columns write privilege still missing for authenticated: %', v_missing;
  end if;

  -- 이름과 «명령» 이 함께 맞아야 한다.
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'board_columns'
     and (policyname, cmd) in (
       ('bcols_insert','INSERT'), ('bcols_update','UPDATE'), ('bcols_delete','DELETE')
     );
  if v_policies <> 3 then
    raise exception 'board_columns write policies expected 3 (name+cmd matched), found %', v_policies;
  end if;

  -- 정책이 서 있어도 RLS 가 꺼져 있으면 조직 경계가 없는 것과 같다.
  select c.relrowsecurity into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'board_columns';
  if v_rls is distinct from true then
    raise exception 'board_columns RLS must stay enabled — policies are meaningless without it';
  end if;
end $$;

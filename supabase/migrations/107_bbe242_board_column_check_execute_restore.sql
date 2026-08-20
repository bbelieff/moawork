-- moa-migration-guard: logical_key=107_bbe242_board_column_check_execute_restore predecessor=106_bbe240_reserve_ledger_workspace_slug digest=3709bdc8f649bf16ac1fc57160dd30c55d18f3049ae53d2570b531291b25f73a foundation=false

select public.begin_guarded_migration(
  p_logical_key => '107_bbe242_board_column_check_execute_restore',
  p_file_name => '107_bbe242_board_column_check_execute_restore.sql',
  p_file_digest => '3709bdc8f649bf16ac1fc57160dd30c55d18f3049ae53d2570b531291b25f73a',
  p_expected_predecessor => '106_bbe240_reserve_ledger_workspace_slug',
  p_executor => 'DC-00',
  p_thread_id => '019fe9c3-7a41-7e52-b8d0-3c6a92f5d7b1',
  p_foundation => false
);

-- BBE-242 — 096 은 «작동한 적이 없다». 컬럼을 한 개도 못 쓰고 있었다.
--
-- 무엇이 났나
--   운영에서 로그인 사용자가 board_columns 에 쓰면 예외 없이 42501 이 났다.
--     permission denied for function board_column_metadata_is_valid
--   그 결과 「신규리드 관리」 보드는 **컬럼 0 개인 껍데기**로 남았고,
--   그 보드를 그리는 화면(/newcust)이 서버 오류로 죽었다.
--
-- 왜 났나 — 두 마이그레이션이 각자 옳고 «합쳐서» 틀렸다
--   089:53-55  board_columns 에 CHECK 제약을 건다:
--                check (board_column_metadata_is_valid(validation, edit_policy, view_policy))
--   092:15-19  같은 함수의 EXECUTE 를 authenticated 에서 회수한다(최소권한).
--
--   ★ CHECK 제약이 함수를 부르면 그 함수는 «쓰는 역할» 의 권한으로 실행된다.
--     즉 EXECUTE 가 없으면 제약이 «검증» 이 아니라 **«전면 차단»** 으로 바뀐다.
--     092 는 「검증기를 직접 못 부르게 한다」고 생각했지만, 실제로는
--     「그 테이블에 아무것도 못 쓰게 한다」를 한 것이다.
--
--   096 은 테이블 GRANT 와 RLS 정책을 되살렸다. 그러나 함수 권한은 손대지 않았고,
--   주석에는 「CHECK 제약이 남아 있으니 직접 써도 잘못된 JSON 은 못 들어간다 —
--   이 마이그레이션의 위험은 그만큼 좁다」고 적었다. 그 문장은 맞다. 다만
--   **그 제약이 옳은 JSON 까지 막고 있다는 것**을 보지 못했다.
--
-- ★★ 왜 아무도 못 잡았나 — 이 카드의 진짜 교훈
--   096 의 검증 블록은 ① 테이블 권한 ② 정책 이름+cmd ③ RLS 활성 을 확인한다.
--   **셋 다 통과했다. 그런데 쓰기는 안 됐다.**
--   전제 조건만 재고 «실제 동작» 을 한 번도 안 해봤기 때문이다.
--   → 그래서 아래 검증은 권한 비트뿐 아니라 **진짜 INSERT 를 해보고 되돌린다.**
--
-- 왜 세 개인가
--   board_column_metadata_is_valid 는 SECURITY INVOKER 이고 본문에서
--   board_column_access_policy_is_valid / board_column_validation_is_valid 를 부른다.
--   호출자 권한으로 도므로 셋 다 필요하다. 하나라도 빠지면 같은 42501 이 난다.
--
-- 최소권한은 무엇으로 지키나 — 이 GRANT 가 여는 것은 좁다
--   셋 다 **순수 검증 함수**다: jsonb 를 받아 모양이 맞는지 boolean 을 돌려줄 뿐,
--   테이블을 읽지도 쓰지도 않고 어떤 조직 데이터도 드러내지 않는다.
--   실제 방어선(조직 경계·편집 권한)은 그대로다 —
--   RLS bcols_insert/update/delete 가 is_org_member(org_id) 로 매 행을 판정한다(096).

grant execute on function
  public.board_column_metadata_is_valid(jsonb, jsonb, jsonb),
  public.board_column_access_policy_is_valid(jsonb),
  public.board_column_validation_is_valid(jsonb)
to authenticated;

do $$
declare
  v_missing text;
  v_org uuid;
  v_board uuid;
  v_member uuid;
  v_wrote int;
begin
  -- ① 권한 비트 — 셋 다여야 한다. 하나라도 빠지면 같은 자리에서 다시 막힌다.
  select string_agg(f, ', ' order by f) into v_missing
  from unnest(array[
    'public.board_column_metadata_is_valid(jsonb,jsonb,jsonb)',
    'public.board_column_access_policy_is_valid(jsonb)',
    'public.board_column_validation_is_valid(jsonb)'
  ]) f
  where not has_function_privilege('authenticated', f, 'EXECUTE');
  if v_missing is not null then
    raise exception 'authenticated still lacks EXECUTE on board column validators: %', v_missing;
  end if;

  -- ② ★ 진짜 쓰기 — 096 이 빠뜨린 자리다. 전제 조건이 아니라 «동작» 을 잰다.
  --    실제 조직·보드·구성원이 있을 때만 잰다(빈 DB 에서는 잴 것이 없다).
  select b.org_id, b.id into v_org, v_board
    from public.boards b limit 1;

  if v_org is not null then
    select m.user_id into v_member
      from public.org_members m
     where m.org_id = v_org and m.status = 'active'
     limit 1;
  end if;

  if v_member is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_member, 'role', 'authenticated')::text, true);

    set local role authenticated;
    insert into public.board_columns (org_id, board_id, key, label, type, source, sort_order)
    values (v_org, v_board, '_bbe242_write_probe', '쓰기 확인', 'text', 'act',
      (select coalesce(max(c.sort_order), -1) + 1 from public.board_columns c where c.board_id = v_board));
    get diagnostics v_wrote = row_count;
    delete from public.board_columns
     where board_id = v_board and key = '_bbe242_write_probe';
    reset role;

    if v_wrote <> 1 then
      raise exception 'authenticated board_columns write probe did not insert a row';
    end if;
  end if;
end $$;

comment on constraint board_columns_policy_objects on public.board_columns is
  'BBE-176(089) 메타데이터 검증. ★ 이 CHECK 는 board_column_metadata_is_valid 를 «쓰는 역할» 의 '
  '권한으로 부른다 — authenticated 의 EXECUTE 를 회수하면 검증이 아니라 전면 차단이 된다(BBE-242). '
  '검증기 3종의 EXECUTE 를 authenticated 에서 다시 빼려면 이 제약부터 걷어내라.';

-- moa-migration-guard: logical_key=127_issue544_contract_work_fee_terms predecessor=126_issue534_default_definition_state_unique digest=4b531f474c6720319b04d5a440c1a90ba7af5288cc56f8a42286bd5074b031cf foundation=false

select public.begin_guarded_migration(
  p_logical_key => '127_issue544_contract_work_fee_terms',
  p_file_name => '127_issue544_contract_work_fee_terms.sql',
  p_file_digest => '4b531f474c6720319b04d5a440c1a90ba7af5288cc56f8a42286bd5074b031cf',
  p_expected_predecessor => '126_issue534_default_definition_state_unique',
  p_executor => 'DC',
  p_thread_id => '019ff0a1-7c42-7bd3-a1e5-4c8b93d20f11',
  p_foundation => false
);

-- #544 — 이미 만들어진 보드의 «수수료(%)» 를 «계약조건» 으로 옮긴다.
--
-- 왜 코드만으로는 부족한가
--   `work-management/template.ts` · `default-tabs/contract-work.ts` 를 고치면
--   **앞으로 설치될 보드**만 바뀐다. 이미 있는 보드의 컬럼은 `board_columns` 행이라
--   코드를 배포해도 화면은 그대로 «수수료(%)» 를 그린다.
--   실측(2026-08-25): 운영에 그런 보드가 2개 있었다. 이 파일이 그 둘을 옮긴다.
--   ★ 「완주는 제품에 붙는 것」 — 배포했는데 화면이 안 바뀌면 끝난 것이 아니다.
--
-- 값은 옮기지 «않는다» — 옮기면 거짓이 된다
--   숫자 3(=3%)을 계약조건 텍스트로 읽으면 「3」이라는 계약조건이 된다.
--   그래서 `item_values` 는 손대지 않는다. 옛 키의 값은 고아로 남는 편이 맞다.
--   ★ 실측으로 확인했다 — `item_values` 에 column_key='fee_percent' 인 행은 **0건**이다.
--     즉 이 판단으로 잃는 데이터가 실제로 하나도 없다. (0건이 아니었다면 이 마이그레이션을
--     멈추고 총괄에게 «무엇을 잃는지» 부터 보고했을 것이다 — 아래 가드가 그것을 강제한다.)
--
-- 되돌리기
--   key/label/type 세 칸만 바꾼다. 되돌리려면 반대로 update 하면 된다.
--   행을 지우지 않으므로 폭·순서·정책 등 나머지 설정은 전부 그대로 남는다.

do $$
declare
  v_orphan_values int;
  v_moved int;
  v_left int;
begin
  -- ★ 안전선: 옛 키에 실제 입력값이 있으면 «조용히» 진행하지 않는다.
  --   숫자를 계약조건 텍스트로 바꿔 읽는 순간 원장·정산 판단이 어긋나기 시작한다.
  select count(*) into v_orphan_values from public.item_values where column_key = 'fee_percent';
  if v_orphan_values > 0 then
    raise exception '수수료(%%) 에 입력된 값이 %건 있다. 무엇을 잃는지 먼저 판단해야 한다 — 이 마이그레이션은 값을 옮기지 않는다.', v_orphan_values;
  end if;

  update public.board_columns
     set key = 'fee_terms',
         label = '계약조건',
         type = 'text'
   where key = 'fee_percent';
  get diagnostics v_moved = row_count;

  -- 전제가 아니라 «결과» 를 잰다. 096 이 전제만 재고 흐름을 안 재서 통과한 채 망가졌다.
  select count(*) into v_left from public.board_columns where key = 'fee_percent';
  if v_left > 0 then
    raise exception 'fee_percent 컬럼이 %건 남았다 — 두 개념이 공존하게 된다', v_left;
  end if;

  raise notice '#544: board_columns %건을 계약조건으로 옮겼다 (남은 fee_percent 0건)', v_moved;
end $$;

-- moa-migration-guard: logical_key=104_bbe240_deals_fee_terms predecessor=103_bbe240_deal_ledger_vat_wiring digest=8b864d7609a18ea78eb59f04f038112c57f5a42ef7cb0f27f637296b84920205 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '104_bbe240_deals_fee_terms',
  p_file_name => '104_bbe240_deals_fee_terms.sql',
  p_file_digest => '8b864d7609a18ea78eb59f04f038112c57f5a42ef7cb0f27f637296b84920205',
  p_expected_predecessor => '103_bbe240_deal_ledger_vat_wiring',
  p_executor => 'DC-00',
  p_thread_id => '54ccb210-7be2-4b40-bcea-8cf0d99047ee',
  p_foundation => false
);

-- BBE-240: 계약조건(자유기재)을 딜 정본에 얹는다.
--
-- 065_company_master_identity.sql 의 `alter table ... add column if not exists` 선례와
-- 동일하게, 001 밖에서 deals 를 확장하는 additive-only 컬럼이다. 제약·기본값 없음(NULL 허용).
-- 실행액(execution_amount)은 「계약업체 실무」 보드의 동적 board_columns 로 그대로 남는다 —
-- 계약조건만 어느 보드에서 보든 같은 딜-레벨 사실이라 deals 로 옮긴다.

alter table public.deals add column if not exists fee_terms text;

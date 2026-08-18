-- moa-migration-guard: logical_key=097_bbe201_new_lead_field_write_restore predecessor=096_bbe197_board_column_write_restore digest=dcb4ac1120a3dee84f3dd788c83aa9b40db3977e2e5f538d619793a705267a02 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '097_bbe201_new_lead_field_write_restore',
  p_file_name => '097_bbe201_new_lead_field_write_restore.sql',
  p_file_digest => 'dcb4ac1120a3dee84f3dd788c83aa9b40db3977e2e5f538d619793a705267a02',
  p_expected_predecessor => '096_bbe197_board_column_write_restore',
  p_executor => 'DC-00',
  p_thread_id => '019fe8b1-4c2a-7d31-9f60-2a7c51d4e8b4',
  p_foundation => false
);

-- BBE-201 / BBE-171 — 대표자명·연락처·업종·매출 구간·시도를 직접 쓰는 것을 막던 빗장을 푼다.
--
-- 무엇이 막고 있었나
--   087_new_lead_canonical.sql:120-133 의 트리거 guard_new_lead_projection_write 가
--   item_values 의 insert/update/delete 마다 돌면서 아래 조건이 모두 참이면 42501 을 던졌다.
--     ① column_key 가 rep_name · phone · email · business_registration_type · industry ·
--        industry_code · revenue_band · region_sido · region_sigungu · acquisition_source ·
--        source_external_id 중 하나이고
--     ② 그 행이 매달린 items.deal_id 가 null 이 아니고
--     ③ 세션 변수 moawork.new_lead_projection_write 가 'on' 이 아니다
--   앱은 ③ 을 켜지 않는다. 그래서 리드 행에 이 필드들을 채우는 순간 예외가 올라오고,
--   서버 액션이 그것을 잡지 않아 Next 오류 경계(«This page couldn't load»)로 전면 노출됐다.
--
-- 왜 푸는가 — 제품 의도가 이미 확정돼 있다
--   BBE-171 본문: 「현재 잠김은 결함이다. 유입 출처와 무관하게 work.item_edit 권한이 있는
--   사용자는 통화 후 업체/리드명·연락처·이메일·대표자·업종·사업자 유형·매출·지역·광고 출처·
--   메모를 언제든 수정할 수 있어야 한다. source=auto 는 유입 출처 메타데이터이며
--   disabled/readOnly 조건이 아니다.」
--   트리거는 그 확정된 의도와 정면으로 어긋난다. 2026-08-17 총괄이 운영에서 직접 막혔다.
--
-- ★ 함께 사라지는 것 — 알고 넘어가야 한다
--   이 트리거의 목적은 「값 수정을 update_new_lead_fields RPC 로 몰아 감사 이력
--   (before/after · actor · changed_at · value_source · request_id) 을 강제로 남기게」 하는 것이었다.
--   트리거를 떼면 **직접 쓰기에는 그 이력이 남지 않는다.**
--   BBE-171 의 수용 기준에 「자동 유입/수동 정정 감사 구분」이 있으므로, 접수 폼과 셀 편집을
--   update_new_lead_fields 로 재배선하는 후속 작업이 필요하다. 그때 이 트리거를 다시 걸면 된다.
--   그래서 **함수는 남겨 둔다** — 다시 붙일 때 그대로 쓴다.
--
--   즉 이 마이그레이션의 성격: 「감사를 포기한다」가 아니라
--   「사용자가 자기 데이터를 못 고치는 상태를 먼저 끝내고, 감사는 올바른 자리(앱 배선)에서 되찾는다」.
--
-- 남아 있는 방어 — 이걸 떼도 아무나 쓸 수 있게 되는 것이 아니다
--   * item_values 의 RLS 는 그대로다. 089:151-157 의 itemvals_insert/update/delete 가
--     board_column_value_editable(org_id,item_id,column_key) 로 매 행을 판정한다.
--   * deal_intake · deal_intake_field_audit · new_lead_requests 의 쓰기 권한은
--     087:116-118 에서 회수된 채 그대로다. 정본 테이블은 여전히 RPC 로만 쓴다.
--   * 조직 경계(is_org_member)와 권한 판정은 손대지 않았다.
--   이 마이그레이션이 여는 것은 **보드 셀(item_values) 의 투영 값**뿐이다.

drop trigger if exists guard_new_lead_projection_write on public.item_values;

-- 되돌리기 위한 기록: 다시 걸 때는 아래 한 줄이면 된다(함수는 087 이 만든 것이 그대로 남아 있다).
--   create trigger guard_new_lead_projection_write before insert or update or delete
--   on public.item_values for each row execute function public.guard_new_lead_projection_write();

do $$
declare
  v_trigger int;
  v_function int;
  v_policies int;
begin
  select count(*) into v_trigger from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'item_values'
     and t.tgname = 'guard_new_lead_projection_write' and not t.tgisinternal;
  if v_trigger <> 0 then
    raise exception 'guard_new_lead_projection_write trigger still attached to item_values';
  end if;

  -- 함수는 반드시 남아 있어야 한다. 다시 걸 수 없게 되면 되돌릴 길이 사라진다.
  select count(*) into v_function from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_new_lead_projection_write';
  if v_function = 0 then
    raise exception 'guard_new_lead_projection_write function must be kept for re-attachment';
  end if;

  -- 빗장을 풀면서 RLS 까지 열려 버리지 않았는지 같은 자리에서 확인한다.
  select count(*) into v_policies from pg_policies
   where schemaname = 'public' and tablename = 'item_values'
     and policyname in ('itemvals_insert','itemvals_update','itemvals_delete');
  if v_policies <> 3 then
    raise exception 'item_values write policies expected 3, found % — RLS must stay in force', v_policies;
  end if;
end $$;

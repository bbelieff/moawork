-- moa-migration-guard: logical_key=176_default_tab_rev_qa884_apply predecessor=175_consultation_meeting_at_mirror digest=a5cf2c00131ac63cc70b0bc6267792cdf2e0a16f65f211384507989bf19b91f9 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '176_default_tab_rev_qa884_apply',
  p_file_name => '176_default_tab_rev_qa884_apply.sql',
  p_file_digest => 'a5cf2c00131ac63cc70b0bc6267792cdf2e0a16f65f211384507989bf19b91f9',
  p_expected_predecessor => '175_consultation_meeting_at_mirror',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 884 (belie 결정 2026-10-13) — #899 의 기본 탭 정의 변경을 이미 깔린 보드에 적용한다.
--
--   앱의 진입 보정(reconcileDefaultDefinition)은 «워크스페이스를 만든 사람이 들어올 때» 만 돌아서,
--   운영 보드 12개(기본 탭 3종 × 4곳)가 한 번도 옮겨지지 않았다(2026-10-13 운영 실측).
--   같은 규칙을 DB 에서 한 번 적용한다:
--     · 이름: 지금 이름이 «우리가 예전에 심은 이름» 과 같을 때만 바꾼다(회사가 바꾼 이름은 그대로).
--     · 읽기 전용: 리드컨택 미팅 일시가 아직 쓰기 가능(예전 값)일 때만 읽기 전용으로.
--     · 이동 규칙: 리드컨택 계약상황 규칙이 «비어 있을 때만» 4개 단계 → 같은 이름 그룹으로. 그룹이 없으면 그 항목은 건너뛴다.
--   default_definition_state 는 건드리지 않는다 — 다음 진입 보정이 «지금 값» 을 기록한다(이미 새 값이라 덮지 않음).

-- 이름
update public.board_columns c set label = v.new_label
  from public.boards b,
       (values
         ('core.default-tab/contact', 'founded_year', '창업년도', '창업연도'),
         ('core.default-tab/contact', 'revenue', '매출액', '매출'),
         ('core.default-tab/contact', 'meeting_at', '전자계약 / 미팅일정', '미팅 일시'),
         ('core.default-tab/contact', 'contract_fee_status', '계약금 완료여부', '계약금 입금여부'),
         ('core.default-tab/contract-work', 'founded_year', '창업년도', '창업연도'),
         ('core.default-tab/contract-work', 'annual_revenue', '연 매출액', '매출'),
         ('core.default-tab/contract-work', 'contract_deposit_paid_on', '계약금_입금일', '계약금 입금일'),
         ('core.default-tab/new-lead', 'meeting_at', '대면미팅 일시', '미팅 일시')
       ) as v(source, key, old_label, new_label)
 where b.id = c.board_id and b.deleted_at is null and b.source = v.source
   and c.key = v.key and c.label = v.old_label;

-- 미팅 일시 읽기 전용(정본은 상담 기록, 175 의 거울 함수가 맞춘다)
update public.board_columns c set is_readonly = true
  from public.boards b
 where b.id = c.board_id and b.deleted_at is null and b.source = 'core.default-tab/contact'
   and c.key = 'meeting_at' and not c.is_readonly;

-- 계약상황 취소·보류 이동 규칙 — 규칙이 비어 있을 때만
update public.board_columns c set move_rule_jsonb = r.rule
  from (
    select c2.id, jsonb_object_agg(m.option_id, g.id) as rule
      from public.board_columns c2
      join public.boards b on b.id = c2.board_id and b.deleted_at is null and b.source = 'core.default-tab/contact'
      cross join (values
        ('계약 보류', '💰 계약보류(온/오프)'),
        ('미팅보류', '📍 미팅보류'),
        ('미팅취소', '📍 미팅취소'),
        ('계약취소', '📍 계약취소')
      ) as m(option_id, group_name)
      join lateral (
        select g1.id from public.board_groups g1
         where g1.board_id = b.id and g1.name = m.group_name
         order by g1.sort_order nulls last, g1.id limit 1
      ) g on true
     where c2.key = 'contract_status'
       and (c2.move_rule_jsonb is null or c2.move_rule_jsonb = '{}'::jsonb)
     group by c2.id
  ) r
 where c.id = r.id;

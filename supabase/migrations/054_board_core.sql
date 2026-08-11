-- =====================================================================
-- 054_board_core.sql — 아이템 자동 이동 + 읽기전용 칸(D68~D70, BBE-14)
--
-- 배경: 목업 실측(dump-mockup.mjs) 결과 세 가지가 003 board_columns 에 담을 자리가
-- 없었다.
--  1. 신규리드·리드컨택·계약업체 실무 세 탭 모두 "우측 고정 조작 열의 값이 바뀌면
--     해당 아이템이 다른 그룹(카드함)으로 옮겨간다"(예: 상담 상황="거절" → 🚫거절).
--  2. 계약업체 실무의 ƒ수식 칸(ƒ심사 D-day·ƒ재신청 안내일 등)은 자동 계산 결과라
--     사용자가 손으로 고치면 안 된다(목업 개정 ④).
--
-- 조치: 컬럼 2개 추가. 둘 다 기본값(NULL/false)이라 기존 컬럼 전부 무영향(additive).
--
-- 성격: ALTER TABLE ADD COLUMN 뿐. 003 의 테이블·RLS·is_org_member() 무수정.
-- 003 정의 파일은 그대로 두고 이 파일에서만 확장한다(기존 마이그레이션 수정 금지).
-- =====================================================================

alter table board_columns
  add column if not exists move_rule_jsonb jsonb,
  add column if not exists is_readonly boolean not null default false;

comment on column board_columns.move_rule_jsonb is
  'D68~D70: {선택지id: 목표group_id} 맵. 이 칸 값이 매핑된 선택지가 되면 '
  '아이템이 그 그룹으로 이동한다. NULL = 이동 규칙 없음(일반 컬럼).';

comment on column board_columns.is_readonly is
  '목업 개정 ④: ƒ수식 결과처럼 자동 계산되는 칸. true 면 사용자 편집(setCells)을 '
  '전부 거부한다 — 계산값은 계산 서비스가 자기 쓰기 경로로 채운다.';

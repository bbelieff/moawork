-- BBE-123: 필드 타입 체계 — 타입 15종 × 출처 6종.
--
-- 001 field_type enum(13종)에 없던 4종 추가. 각 ADD VALUE 는 별도 트랜잭션 요구사항 때문에
-- (같은 트랜잭션에서 새 값을 즉시 못 쓴다) 개별 문장으로 쓰고, 이 마이그레이션에서는
-- 새 값을 DML 에 쓰지 않는다(스키마 준비만).
alter type field_type add value 'status';
alter type field_type add value 'people';
alter type field_type add value 'money';
alter type field_type add value 'calc';

-- 출처(source) — 값이 어디서 오는가. 편집 가능 여부를 정한다. 정본: docs/handoff/결정대장.md D09.
create type field_source as enum ('auto', 'in', 'act', 'msg', 'lk', 'calc');

-- board_columns 확장. 003 boards 엔진은 아직 Supabase 백엔드가 없다(app/src/lib/repo/local
-- 만 존재 — lib/boards/store.ts 주석 참고) — 이 두 컬럼은 그 어댑터가 붙을 때를 대비한
-- 스키마 준비이며, width 컬럼(003)과 같은 성격이다.
alter table board_columns add column source field_source not null default 'in';
-- ⚠ 앱 타입은 camelCase `rightPinned` — 공지 보드의 데이터 컬럼 key "pinned"(상단고정 체크박스,
-- T04)와 이름이 겹쳐 스키마·앱 양쪽에서 분명히 뗐다.
alter table board_columns add column right_pinned boolean not null default false;

# [T02 · 추가 지침] 사용자 임의 보드 엔진 (ADR-0003 · D4 변경)

먼저 docs/decisions/ADR-0003-임의보드-MVP포함.md, supabase/migrations/003_boards_engine.sql, _FOUNDATION.md를 읽으세요. 워크로그 START 후 착수.

## 두 갈래 — 헷갈리지 말 것
1. 정책자금 파이프라인(기존 core.crm) = 001의 deals/stages/settlements 그대로. (ADR-0002 판정: 0002_core_crm.sql 폐기, deals 모델로 재작성) — 여긴 boards/items로 대체 금지.
2. [신규] 사용자 임의 보드 = 003_boards_engine.sql의 boards/items 엔진으로 구현. ← 이 지침의 대상.

당신이 먼저 만든 boards/items 작업은 버리지 말고 003 스키마에 맞춰 이쪽(임의 보드)으로 이전하세요.

## 스키마(003, 기획이 확정·검증함 — 임의 마이그레이션 만들지 말 것)
boards(org_id·name·is_system·source) · board_groups · board_columns(type=001 field_type 13종·options_jsonb) · items(board_id·group_id·assigned_to) · item_values(item_id·column_key·value_jsonb, EAV) · board_views(kind=table|kanban). RLS는 001 헬퍼 재사용(items는 deals와 동일 담당범위 규칙).

## 담당 파일
app/(app)/boards/page.tsx            보드 목록(시스템+사용자) + [새 보드]
app/(app)/boards/[id]/page.tsx       범용 보드(테이블/칸반 토글)
components/boards/GenericBoardTable.tsx   컬럼=board_columns, 셀=item_values 인라인 편집
components/boards/GenericBoardKanban.tsx  그룹 또는 select 컬럼 기준 칸반(dnd-kit)
components/boards/ColumnEditor.tsx    컬럼 추가/편집(13 field_type + 선택지)
components/boards/NewBoardDialog.tsx  보드 생성
lib/repo/local/*                      003 테이블 로컬 어댑터(+시드: 예시 사용자 보드 1개)
lib/queries/boards.ts                 TanStack Query 훅

## 화면 흐름
사이드바 보드 → 목록(정책자금 파이프라인 + 사용자 보드) → [새 보드] 이름 입력 → 빈 보드(기본 컬럼 2~3개) → 컬럼 추가(타입 선택) → 아이템 추가·인라인 편집 → 테이블/칸반 토글·그룹.

## 수용 기준
1. 새 보드 생성 → 컬럼 추가(select 포함) → 아이템 추가·셀 편집 → 새로고침 유지(로컬 store).
2. 테이블 뷰 + 칸반 뷰(그룹/상태 기준) 동작, dnd 이동 반영.
3. ?as=member 시 아이템은 본인 담당만(items scope 규칙).
4. 정책자금 파이프라인 화면 회귀 0(deals/정산 그대로 동작).
5. npm run dev 로컬 동작, check.sh 초록. 신규 SQL 파일 생성 금지(003만 사용).

# 기획2(오케스트레이터) 다음 세션 프롬프트 — 004 마이그레이션

> 작성: 기획-Cowork 2026-07-21. 아래 블록을 기획2 세션에 그대로 붙여넣기.

```
너는 기획(오케스트레이터) 세션이다. CLAUDE.md 독서 순서(coordination README → provider-status → session-registry → dispatch-queue → active plan/worklog)를 따르되, 이번 세션의 단일 목표는 **004 마이그레이션 작성**이다.

[먼저 읽기] docs/worklog.md 사건로그(07-21 기획-Cowork 항목들) + docs/design/먼데이-실측-버튼시퀀스-DB매핑_v0.1.md(§5 갭·§7 동업자 대조·belie 결정) + docs/design/UI목업_모아워크셸_v0.3.html 주석(IA 10메뉴).

[산출물] supabase/migrations/004_gaps_and_leadin.sql — 001~003 위에 additive, 무수정 원칙:
1. G1: items.parent_item_id uuid null self-FK (하위아이템)
2. G2: board_views(id, org_id, board_id, name, type, filters_jsonb, sort_jsonb, columns_jsonb, sort_order) + RLS
3. G6: activities.parent_activity_id uuid null self-FK (답글 스레드)
4. G7: field_type enum에 'status' 추가 + status 라벨 스키마 규약(options_jsonb: {labels:[{id,label,hex,is_done,index}]}) 문서화
5. G8: board_automation_rules(id, org_id, board_id, status_column_key, status_value, to_group_id) + RLS — "상태→그룹 이동" 단일 레시피(빌더는 P3/O16 유지)
6. D15: lead_source_configs·lead_intake_events (마스터기획서_v0.1.md 07-21 증분 PART G 참조) + RLS
7. PLAN-v0.2.md에 D15·O18·G1~G8 동기화(§0 표·§5 스키마 절), 26→최신 테이블 수 갱신.

[검증] pglast(libpg_query)로 전 구문 파스 확인(001 때 방식). RLS 정책 빠짐없이.
[적용] 완료 후 worklog에 END 기록 — Supabase 적용은 기획-Cowork(브라우저/커넥터)가 수행한다고 명시하고 넘길 것.
[금지] 001~003 수정, 제품코드(lib/app) 접촉(트랙 소유), 실고객 데이터.
[주의] registry에 자기 행 갱신 후 착수(다중 기획 세션 규칙 — coordination README §다중 세션).
```

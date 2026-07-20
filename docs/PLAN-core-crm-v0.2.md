# PLAN — core.crm (T02 영업코어) · v0.2

> 원본 기획 `docs/PLAN-v0.2.md` / `supabase/migrations/001_schema_v1.sql` 가 저장소에
> 부재하여, 오너 승인 하에 **T02 가 core.crm 도메인의 스키마 v1 + 설계를 저작**했다.
> 이 문서는 그 설계·가정·경계를 기록한다. (전체 기획 v0.2 확정본이 들어오면 정합화)

## 범위 (MVP)

먼데이 수준 재현. 벤더 연동 제외. 구현 방식 **B(하이브리드 정규화)**:
사용자 화면은 먼데이와 동일(보드·컬럼·상태·수식), 내부는 정규화 + RLS.

대상 4항목:
1. 보드(boards) + 아이템(items) + 컬럼값(column_values) CRUD
2. 파이프라인 단계 이동 (상담중→계약대기→진행중→완료, `status` 컬럼 기반)
3. 저장뷰/필터 (saved_views)
4. 수식 컬럼 4개: 수수료·총매출·D+180·D+365

## 데이터 모델 — `supabase/migrations/0002_core_crm.sql`

| 테이블 | 역할 |
| --- | --- |
| `boards` | 보드(신규고객/컨택/업무). org 스코핑. |
| `pipeline_stages` | 보드별 단계 세트. 기본 4단계. |
| `board_columns` | 컬럼 정의(먼데이 컬럼 미러). `type`, `settings(jsonb)`. |
| `items` | 아이템(행). `stage_id` = 파이프라인 위치의 **단일 진실원**. |
| `column_values` | 아이템×컬럼 값(정규화 셀, `value jsonb`). 수식은 저장 안 함. |
| `saved_views` | 저장뷰(`config`: filters/sorts/visibleColumns). |

- 파일명은 기존 컨벤션(`NNNN_snake_case.sql`, 4자리)을 따라 `0002_core_crm.sql`.
- `stage_id` 를 정본으로 두고, 상태 컬럼은 파생 렌더 → 이중기록/불일치 회피.

## 수식 정의 (가정 — `app/src/lib/crm/formulas.ts`)

원본 정의가 없어 아래를 **가정**으로 채택. 확정 시 `formulas.ts` 만 수정.

입력 컬럼: `contract_amount`(계약금액), `commission_rate`(수수료율 %), `contract_date`(계약일)

| 수식 | 정의 |
| --- | --- |
| 수수료 `commission` | 계약금액 × 수수료율 / 100 (공급가액) |
| 총매출 `total_revenue` | 수수료 × (1 + 부가세율 0.1) (부가세 포함 총액) |
| D+180 `d_plus_180` | 계약일 + 180일 |
| D+365 `d_plus_365` | 계약일 + 365일 |

## 파이프라인 자동화 (`app/src/lib/crm/pipeline.ts`)

이동은 먼데이처럼 자유(any→any). 이동 시 부수효과:
- **진행중 진입**: `contract_date` 가 비면 이동일로 채움 → D+180/365 기준일 확보.
- **완료 진입**: `items.completed_at` 스탬프 + `completed_date` 컬럼값 세팅.
- **완료 이탈**: `completed_at` 해제.

## 아키텍처 (레이어)

```
app/src/lib/crm/
  types.ts         도메인 타입 (DB 1:1)
  formulas.ts      수식 엔진 (순수·테스트)
  pipeline.ts      단계 정의·이동 자동화 (순수·테스트)
  views.ts         저장뷰 필터·정렬 적용 (순수·테스트)
  validation.ts    입력 검증 (순수·테스트)
  templates.ts     기본 보드 컬럼/단계 템플릿
  store.ts         CrmStore 포트 + InMemory 어댑터
  postgrest.ts     Supabase PostgREST 어댑터 (fetch, 의존성 0)
  service.ts       오케스트레이션 (도메인 + 스토어)
  context.ts       요청 컨텍스트(org 스코핑)
  http.ts          에러→HTTP 매핑
  index.ts         팩토리 (env 유무로 어댑터 선택)
app/src/app/api/   Next.js Route Handlers (boards/items/move/views)
```

- 스토어 **포트/어댑터**로 도메인과 DB를 분리 → 인메모리로 완전 단위테스트, 운영은 PostgREST.
- `getStore()`: `SUPABASE_URL`(또는 `NEXT_PUBLIC_SUPABASE_URL`) + `SUPABASE_SERVICE_ROLE_KEY`
  존재 시 PostgREST, 없으면 인메모리(개발/테스트).

## API

| 메서드/경로 | 동작 |
| --- | --- |
| `GET/POST /api/boards` | 목록 / 생성(기본 단계·컬럼 프로비저닝) |
| `GET/PATCH/DELETE /api/boards/{boardId}` | 상세(보드+단계+컬럼) / 수정 / 삭제 |
| `GET/POST /api/boards/{boardId}/items` | 목록(`?viewId=` 저장뷰 적용) / 생성 |
| `GET/PATCH/DELETE /api/items/{itemId}` | 상세 / 값·이름 수정 / 삭제 |
| `POST /api/items/{itemId}/move` | 단계 이동 + 자동화 |
| `GET/POST /api/boards/{boardId}/views` | 저장뷰 목록 / 생성 |
| `PATCH/DELETE /api/views/{viewId}` | 저장뷰 수정 / 삭제 |

- Next.js 16 규약: `route.ts` 에 `GET/POST/...` export, `context.params` 는 **Promise**.
- 아이템 응답은 입력값(`values`) + 계산된 수식(`formulas`)을 포함.

## 트랙 경계 (다른 트랙 소유 — 여기서 정의 안 함)

- **T03 (core.org)**: 조직/멤버십 모델 + **RLS 정책 본체** + Supabase Auth.
  - 본 마이그레이션은 `org_id` 컬럼 + `enable row level security`(정책 없음=fail-closed)까지.
  - Auth 연동 전 임시: `context.ts` 가 `x-org-id` 헤더로 org 스코핑(T03 시 교체).
  - 현재 보안: 서버 service_role + **앱 레이어 org 스코핑**. T03 가 DB RLS 로 심화(defense-in-depth).
- **T05 (core.custom)**: 커스텀필드 옵션/선택지 — `board_columns` 위에 확장.
- **T09 (ind.policyfund)**, **T07 (mod.perf)**: core.crm 의 아이템/파이프라인/이벤트를 소스로 사용.

## 후속 (follow-up)

- [ ] T03 Auth/RLS 확정 시 `context.ts` 실 세션 연동 + DB RLS 정책 정합.
- [ ] PostgREST 어댑터 라이브 DB 통합테스트(현재 순수 쿼리빌더만 단위테스트).
- [ ] createBoard 원자화(Postgres RPC) — 현재 순차 insert.
- [ ] 수식 정의 확정본 반영(가정 → 실제).

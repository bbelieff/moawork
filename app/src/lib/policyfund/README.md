# ind.policyfund — 정책자금 업종팩 (T09)

첫 고객의 먼데이 보드에서 확인한 정책자금 구조를 재현하는 도메인 로직 계층.
SSOT: `supabase/migrations/002_seed_policyfund.sql`(industry_modules.presets_jsonb) · `docs/PLAN-v0.2.md`.

## 구성

| 파일 | 내용 | 상태 |
| --- | --- | --- |
| `types.ts` | 원본 프리셋 JSONB 구조 + 앱 도메인(선택지·보드) 타입 | ✅ |
| `settlement.ts` | 정산 수식(확정본) — 수수료·총매출·D+180·D+365 | ✅ (+test) |
| `presets.ts` | 시드→7개 선택지 카테고리 로더 + 개수 검증기 | ✅ (+test) |
| `board.ts` | 보드 컬럼 추출(업무관리 31컬럼) + 옵션 참조 해석 | ✅ (+test) |
| `pipeline.ts` | 파이프라인 단계 필터·정렬·집계·그룹화 | ✅ (+test) |
| `fixture.ts` | 테스트 픽스처(시드 구조 합성) | 테스트용 |

## 정산 수식 (확정본 · 002_seed formulas)

- **수수료(원)** = `round(실행액 × 수수료% / 100)` — 수수료%는 **정수 퍼센트**(3 = 3%).
- **총매출** = `계약금 + 수수료(원)`.
- **D+180 / D+365** = `수수료입금일 + 180일 / 365일` (입금일 미정이면 null).

> ⚠️ T02 `crm/formulas.ts` 는 착수 시점 **가정**(총매출 = 수수료 × 1.1 부가세, D+n = 계약일
> 기준, base = 계약금액)으로 저작되어 본 확정본과 불일치. 정산(settlements)은 T09 소유이므로
> 확정 정의는 본 모듈. crm 수식컬럼 엔진 정합은 dispatch-queue(DQ-0009)로 T02 에 요청.

## 선택지 카테고리 (7종 · 시드 실측 개수)

| id | 라벨 | 개수 | 시드 출처 |
| --- | --- | --- | --- |
| region | 지역 | 218 | field_presets.region |
| product | 진행상품 | 59 | field_presets.product |
| agency | 진행기관 | 18 | board_columns.업무관리 "진행 기관" |
| consult_status | 상담상황 | 16 | board_columns.신규고객 "상담 상황" |
| contract_status | 계약상황 | 11 | board_columns.컨텍관리 "계약상황" |
| progress_status | 진행상항 | 14 | board_columns.업무관리 "진행상항" |
| fund_name | 자금명 | 28 | board_columns.회계_연도차이 25년 "품목" |

`loadOptionCategories(presets)` 로 추출, `validatePresetCounts()` 로 위 개수 대조.

## 런타임 데이터 소스

프리셋은 DB `industry_modules.presets_jsonb`(팩 설치 시 조직에 복사). 앱은 이를 로드해
`loadOptionCategories` / `getWorkBoardColumns` 에 넘긴다. (로드 배선은 T02 store/서비스 연동.)

## 남은 작업 (UI)

- 선택지 셀렉트 컴포넌트(카테고리 옵션 렌더 · 검색/큰 목록=지역 218 가상화).
- 정책자금 보드 화면(업무관리 31컬럼 테이블/칸반, `getWorkBoardColumns`·`pipeline` 소비).
- 파이프라인 단계 필터·정렬 UI(로직은 `pipeline.ts` 완료).
- ⚠️ 앱 코드 작성 전 `app/AGENTS.md` 지시대로 `node_modules/next/dist/docs/` 확인. T02 route handler/페이지 패턴 참고, 보드 CRUD는 T02 API 소비.

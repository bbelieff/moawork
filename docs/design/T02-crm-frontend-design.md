# T02 core.crm 프론트엔드 설계 (v0.2)

> 상태: **설계**. 백엔드(서비스/API/repo 확장)는 구현·push 완료(`feat/t02-crm-core`).
> UI 본구현은 T03 파운데이션이 `main` 머지된 후 착수.
> 정본: `docs/PLAN-v0.2.md` §3(core.crm)·§4(흐름 B·C) · `001_schema_v1.sql`.
> ADR-0002: DB 정본 = 001+002 만. 먼데이 "보드"는 **화면 레이어(stages 필터 뷰)** 로 재현.

## 0. 데이터 모델 매핑 (먼데이 → 001)

| 먼데이 개념 | moawork(001) | 화면 재현 |
| --- | --- | --- |
| 신규고객/컨텍/업무/회계 "보드" | 단일 `deals` + `stages`(kind) | 사이드바 메뉴 = stage.kind 필터 뷰 |
| 보드 아이템(행) | `deals` 1건 | DealCard / DealTable row |
| 상태 컬럼(단계) | `deals.stage_id` → `stages` | 칸반 컬럼 |
| 컬럼(커스텀) | `field_defs`/`field_values` (T05) | DealInfoTab 동적 필드 |
| 저장뷰 | `saved_views` (T05) | 뷰 셀렉터 |
| 정산/수식 | `settlements`(T09) | DealSettlementTab (T09) |

→ **독자 테이블 없음.** 보드 = `GET /api/deals?stageId=` + `GET /api/pipelines`.

## 1. 라우트 (App Router, route group `(app)`)

```
app/(app)/pipeline/page.tsx      칸반/테이블 전환 보드 (흐름 B)
app/(app)/deals/[id]/page.tsx    딜 상세 — 탭(정보/활동/문서/정산) (흐름 C)
app/(app)/companies/page.tsx     고객사 목록 + 딜 생성 진입
```

- `(app)` 그룹은 T03 인증 셸(레이아웃·세션 가드) 하위. 서버컴포넌트에서 `getSession()`(T03)로
  Ctx 확보 → 초기 데이터 prefetch, 클라이언트는 TanStack Query 로 상호작용.

## 2. 컴포넌트 트리

```
components/pipeline/
  KanbanBoard.tsx    stages 컬럼 + 컬럼별 DealCard 목록, 드래그로 단계 이동
  DealCard.tsx       딜 요약(제목·고객사·금액·담당) — 칸반 카드
  DealTable.tsx      테이블 뷰(정렬·필터), 칸반/테이블 토글 공유
components/deal/
  DealInfoTab.tsx    기본정보 + 커스텀필드(field_defs 렌더는 T05 위젯 소비)
  DealActivityTab.tsx 활동 타임라인(status/call/meeting/memo) + 활동 추가
```

- KanbanBoard: 컬럼 = `pipeline.stages`(sort_order), 카드 = 해당 stage 의 deals.
  드래그드롭 → `useMoveStage` 뮤테이션(낙관적 업데이트). dnd 라이브러리는 구현 시 선정
  (경량 우선; 미설치 상태 — 의존성 추가는 구현 PR 에서).
- 담당범위: member+assigned 는 API 가 본인 딜만 반환하므로 UI 추가 처리 불필요.

## 3. 데이터 레이어

### `lib/services/deals.ts` — API 호출 래퍼(fetch)
```ts
listDeals(params?: { stageId?; companyId? }): Promise<Deal[]>
getDeal(id): Promise<Deal>
createDeal(input: NewDeal): Promise<Deal>
createDealFromCompany(companyId, title): Promise<Deal>   // 고객사 목록 → 딜 생성 단축
updateDeal(id, patch): Promise<Deal>
moveStage(id, stageId): Promise<Deal>                    // POST /api/deals/[id]/move
listActivities(dealId): Promise<Activity[]>
addActivity(dealId, { type, content }): Promise<Activity>
listPipelines(): Promise<PipelineWithStages[]>
listCompanies(): Promise<Company[]>
```
- 각 함수는 이미 구현된 라우트(`/api/deals`·`/pipelines`·`/companies`·`/deals/[id]/move`·
  `/deals/[id]/activities`)를 호출. 응답 봉투 `{ data }` 언랩 + 에러(`{ error }`) 처리.
- `createDealFromCompany`: company_id 로 `createDeal` 호출(기본 파이프라인 첫 단계 배치).

### `lib/queries/deals.ts` — TanStack Query 훅
```ts
// 쿼리 키
qk.pipelines = ['pipelines']
qk.deals(filter) = ['deals', filter]
qk.deal(id) = ['deals', id]
qk.activities(id) = ['deals', id, 'activities']
qk.companies = ['companies']

usedPipelines()             // 칸반 컬럼
useDeals(filter?)           // 보드/테이블
useDeal(id)                 // 상세
useDealActivities(id)
useCompanies()

useMoveStage()              // onMutate 낙관적: 카드를 목적 컬럼으로 이동,
                            // onError 롤백, onSettled invalidate qk.deals + qk.deal + qk.activities
useCreateDeal() / useUpdateDeal() / useAddActivity()
```
- 단계 이동은 **낙관적 업데이트**(칸반 드래그 즉시 반영) + 실패 롤백.
- 활동 추가/단계 이동 후 `qk.deal(id)`·`qk.activities(id)` 무효화(이동은 status 활동 생성).
- `@tanstack/react-query` 미설치 → 구현 PR 에서 의존성 추가 + Provider(`app/providers.tsx`,
  T03 가 이미 스캐폴딩 중) 에 QueryClientProvider 확인.

## 4. 트랙 경계 (UI 소비만, 구현은 타 트랙)

- **커스텀필드 렌더/편집** = T05(field_defs 13타입 위젯). DealInfoTab 은 그 위젯을 슬롯으로 소비.
- **정산 탭(수식·D+180/365)** = T09(settlement.ts + settlements). DealSettlementTab 별도.
- **문서 탭(파일 첨부·계약상황)** = T04(core.files). 
- **홈 대시보드** = T04(core.dash) 가 deals/activities 집계.

## 5. 착수 순서 (T03 머지 후)
1. `@tanstack/react-query` + QueryClientProvider 확인/추가.
2. `lib/services/deals.ts` → `lib/queries/deals.ts`(위 시그니처).
3. `companies/page.tsx`(가장 단순) → `pipeline/page.tsx`(칸반) → `deals/[id]/page.tsx`(탭).
4. 컴포넌트: DealTable → DealCard → KanbanBoard(dnd) → DealInfo/ActivityTab.
5. 각 단계 check.sh 초록 유지. UI 상호작용은 컴포넌트 단위 테스트(가능 범위).

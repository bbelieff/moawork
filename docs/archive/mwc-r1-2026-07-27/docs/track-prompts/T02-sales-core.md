# [T02 · 영업코어 / core.crm] 다음 구현 프롬프트

먼저 `docs/track-prompts/_FOUNDATION.md`와 `docs/PLAN-v0.2.md §3(core.crm)·§4(흐름 B·C)`, `supabase/migrations/001·002`를 읽으세요. 워크로그 START 기록 후 착수.

## 목표(이번 PR 묶음)
먼데이 **신규고객→컨텍→업무** 보드를 하나의 파이프라인으로 재현: **칸반+테이블 보드 · 단계 드래그 이동 · 딜 상세(정보/활동) · 고객사 목록.** 로컬(getRepo) 데이터로 완전 동작.

## 담당 파일(다른 트랙과 겹치지 말 것)
```
app/(app)/pipeline/page.tsx           파이프라인 보드(칸반/테이블 토글)
app/(app)/deals/[id]/page.tsx         딜 상세 페이지 셸 + 탭 레지스트리
app/(app)/companies/page.tsx          고객사 목록(TanStack Table)
components/pipeline/KanbanBoard.tsx    dnd-kit 칸반(스테이지 컬럼)
components/pipeline/DealCard.tsx       카드(회사명·담당·금액·계약상황 뱃지)
components/pipeline/DealTable.tsx      테이블 뷰(정렬·필터·컬럼토글)
components/deal/DealInfoTab.tsx        정보 탭(고객·커스텀필드)
components/deal/DealActivityTab.tsx    활동 탭(통화/미팅/메모 기록·추가)
lib/services/deals.ts                  moveStage·createDeal 서비스(활동 자동기록 포함)
lib/queries/deals.ts                   TanStack Query 훅
```
※ 딜 상세의 **문서 탭·계약상황 필드 컴포넌트는 T04 제공** → 여기선 탭 슬롯에 import만. `app/(app)/deals/[id]/page.tsx`는 T02 소유이나 탭 목록은 T04와 합의.

## 핵심 함수(시그니처 고정)
```ts
// lib/services/deals.ts
export async function moveStage(ctx:Ctx, dealId:string, toStageId:string): Promise<Deal>;
//   → repo.moveDealStage 호출. 이동 시 repo.addActivity({type:'status', content:`단계 이동: ${from}→${to}`})
export async function createDealFromCompany(ctx:Ctx, companyId:string, stageId:string): Promise<Deal>;

// lib/queries/deals.ts (TanStack Query)
export function useStages();                       // repo.listStages
export function useDeals(filter?);                 // repo.listDeals
export function useDeal(id);                        // repo.getDeal
export function useMoveStage();                     // optimistic update (칸반 즉시 반영)
export function useActivities(dealId);              // repo.listActivities
export function useAddActivity(dealId);
```

## 화면 흐름(구현 기준)
- **보드(흐름 B)**: 좌측 사이드바 `영업·고객` → `/pipeline`. 칸반: 스테이지별 컬럼, 카드 드래그로 `useMoveStage`(낙관적 업데이트, 실패 시 롤백). 상단 토글로 테이블 뷰(`DealTable`, 컬럼=회사명·단계·담당·금액·계약상황·신청일). 검색/담당 필터.
- **딜 상세(흐름 C)**: 카드 클릭 → `/deals/[id]`. 탭: **정보**(회사·대표자·지역·금액 + field_defs 커스텀필드 렌더) · **활동**(타임라인 + 통화/미팅/메모 추가) · [문서=T04] · [정산=T09, 지금은 자리만].
- **고객사(`/companies`)**: 테이블(상호·대표자·지역·업종·담당). 행 클릭 → 관련 딜.

## 데이터/테이블(001)
`deals`(stage_id·assigned_to·company_id·amount·custom) · `stages`(kind) · `pipelines` · `companies` · `activities`(type in call/meeting/memo/status). 커스텀필드는 `field_defs`(entity='deal') + `deal.custom[key]`.

## 완료 판정(수용기준)
1. `/pipeline` 칸반에서 카드를 다른 스테이지로 드래그 → 즉시 반영 + `activities`에 status 기록 1건.
2. 테이블 뷰 = 같은 데이터, 정렬·필터·컬럼토글 동작.
3. 딜 상세 정보/활동 탭 렌더 + 활동 추가 반영.
4. dev 역할 스위처 `?as=member`로 보면 **본인 담당 딜만** 보임(scope 필터).
5. `npm run dev`만으로 전부 동작(네트워크·Supabase 0). check.sh 초록.

## 하네스
브랜치 `feat/t02-crm-*` · main 직접 금지 · 워크로그 START/END·registry checkpoint · `lib/types`·`lib/repo/index.ts` 필요 변경은 T03와 합의 후 별도 선행 PR.

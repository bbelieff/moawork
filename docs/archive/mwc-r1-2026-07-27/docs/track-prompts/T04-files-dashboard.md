# [T04 · 문서대시 / core.files + core.dash] 다음 구현 프롬프트

먼저 `docs/track-prompts/_FOUNDATION.md`, `docs/PLAN-v0.2.md §3(core.files·core.dash)·§4(흐름 D·G 일부)`, `001`(deals·settlements)·`002`(contract_status 프리셋)를 읽으세요. 워크로그 START 후 착수.

## 목표(이번 PR 묶음)
① **홈 대시보드**(단계별 건수·전환율·이번달 요약) ② 딜 상세의 **계약상황 필드 + 문서(파일 첨부) 탭**. 전부 로컬(getRepo) 데이터. **홈택스·알림톡·세금계산서 위젯 없음(Phase 2).**

## 담당 파일
```
app/(app)/page.tsx                     홈 대시보드
components/dash/StageCountCards.tsx     단계별 건수 카드(상단 고정)
components/dash/MonthlySummary.tsx      이번달 계약/수납 요약
components/dash/ConversionChart.tsx     전환율(Recharts)
components/deal/ContractStatusField.tsx 계약상황 select(002 프리셋) → repo.updateDeal
components/deal/FilesTab.tsx            파일 첨부 탭(로컬 mock 스토리지)
lib/services/files.ts                  로컬 파일 저장/다운로드(objectURL·메모리)
lib/queries/dash.ts                    useDealCountsByStage·useMonthlySummary
```
※ `ContractStatusField`·`FilesTab`은 **T02의 `deals/[id]/page.tsx` 탭에 삽입**됨 → export만 하고, 탭 등록은 T02와 합의(문서 탭 명칭·순서). 홈 `page.tsx`는 T04 소유(T03 layout 안).

## 핵심 함수(시그니처 고정)
```ts
// lib/queries/dash.ts
export function useDealCountsByStage();   // repo.dealCountsByStage → [{stageId,count}]
export function useMonthlySummary(month?:string);  // repo.monthlySummary → {contracts,feeSum,downSum}
// lib/services/files.ts (로컬)
export async function attachFile(ctx:Ctx, dealId:string, file:File): Promise<{id:string;name:string;url:string}>;
export function listFiles(dealId:string): {id:string;name:string;url:string}[];
```
계약상황 값은 `deal.custom.contract_status`에 저장(select 옵션 = 002 `field_presets.contract_status` / board_columns 컨텍관리 "계약상황"). `repo.updateDeal(ctx,id,{custom:{...deal.custom,contract_status}})`.

## 화면 흐름
- **홈(흐름 G 일부·요약)**: 사이드바 홈 → 상단 **오늘 할 일 + 이번달 요약(계약 건수·수수료 합·계약금 합)**(집계는 항상 위, 모바일 유지) → 단계별 건수 카드 → 전환율 차트(스테이지 간 통과율).
- **딜 상세 문서 탭(흐름 C의 문서)**: 계약상황 select(변경 즉시 저장) + 파일 첨부/목록/다운로드(로컬). 전자서명·문서 버전은 Phase 2(자리 없음).

## 데이터/테이블(001)
집계는 `deals`(stage_id·amount) + (있으면)`settlements`. **settlements가 아직 없으면(T09 미완)**: 이번달 요약의 feeSum·downSum은 `deal.amount` 기반 임시 계산으로 두고 TODO 주석(‘settlements 연결 시 교체’). 계약상황은 `field_defs`(deal) + `deal.custom`.

## 완료 판정(수용기준)
1. `/`(홈) 단계별 건수·이번달 요약·전환율이 **seed 데이터와 정확히 일치**(수동 카운트로 검증).
2. 딜 상세에서 계약상황 변경 → 새로고침 후 유지(로컬 store), 보드 카드 뱃지에도 반영(T02 카드와 키 합의: `custom.contract_status`).
3. 파일 첨부 → 목록 표시 → 다운로드 동작(로컬).
4. Phase 2 위젯(홈택스·알림톡·세금계산서)은 **없음**(스코프 준수).
5. `npm run dev`만으로 동작, check.sh 초록.

## 하네스
브랜치 `feat/t04-files-dash-*` · main 직접 금지 · 워크로그·registry checkpoint · 공용 타입/인터페이스 변경은 T03 합의 · `deal.custom.contract_status` 키는 T02와 공유(카드 뱃지 일치).

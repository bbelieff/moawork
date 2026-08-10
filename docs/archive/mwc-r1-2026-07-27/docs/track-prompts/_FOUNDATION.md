# _FOUNDATION — 로컬개발 공용 계약 (T02·T03·T04 필수 선독)

원칙: **MVP = 먼데이 파리티 · 벤더연동 제외 · 로컬 우선(Supabase 미연결).** DB/Auth 없이 `npm run dev`만으로 전 화면·로직이 도는 것이 이번 웨이브 목표. 나중에 Supabase 어댑터만 갈아끼운다.

## 스택
Next.js(App Router)+TypeScript+Tailwind+shadcn/ui · 서버상태 TanStack Query · 표 TanStack Table · 칸반 dnd-kit · 차트 Recharts.

## 폴더 규약
```
lib/types/index.ts           도메인 타입(001 스키마 대응)
lib/repo/index.ts            Repo 인터페이스 + getRepo()      ← 공용 계약(변경은 T03 조율)
lib/repo/local/store.ts      인메모리 싱글톤(모듈 레벨)
lib/repo/local/seed.ts       더미 시드(가상명 + 002 프리셋 옵션)
lib/repo/local/localRepo.ts  Repo 로컬 구현(+ scope 필터)
lib/auth/session.ts          getSession()=dev 고정 세션
lib/entitlements.ts          isEnabled(feature_key) dev config
lib/presets/policyfund.ts    002 board_columns·옵션 정적 로드(JSON import)
lib/product.ts               export const PRODUCT_NAME = "모아워크"
app/…                        라우트
components/…                  UI
```
레이어 단방향 `types → repo → services → app/components`. 외부 IO는 repo에만. 파일당 500줄 캡.

## 핵심 타입 (lib/types/index.ts)
```ts
export type Role = 'owner'|'admin'|'member';
export type Scope = 'all'|'assigned';
export interface Ctx { orgId: string; userId: string; role: Role; scope: Scope }
export type StageKind = 'marketing'|'meeting'|'contract'|'work'|'settle'|'post';
export interface Org { id:string; name:string; planTier:string }
export interface Member { orgId:string; userId:string; name:string; role:Role; scope:Scope }
export interface Company { id:string; orgId:string; name:string; bizType?:string; region?:string;
  ownerName?:string; phone?:string; email?:string; revenue?:number; foundedOn?:string;
  homepage?:string; assignedTo?:string }
export interface Stage { id:string; pipelineId:string; name:string; sortOrder:number; kind:StageKind }
export interface Deal { id:string; orgId:string; companyId?:string; pipelineId:string; stageId:string;
  assignedTo?:string; title:string; amount?:number; statusNote?:string; appliedOn?:string;
  custom:Record<string,unknown>; createdAt:string; updatedAt:string }   // custom.contract_status 등
export interface Activity { id:string; orgId:string; dealId?:string;
  type:'call'|'meeting'|'memo'|'status'; content?:string; actor?:string; at:string }
export interface FieldDef { id:string; orgId:string; entity:'company'|'deal'; key:string; label:string;
  type:string; options?:string[]; moduleKey?:string; sortOrder:number }
export interface SavedView { id:string; orgId:string; userId?:string; entity:'company'|'deal';
  name:string; filters:Record<string,unknown>; sort:unknown[]; columns:string[]; shared:boolean }
```

## Repo 인터페이스 (lib/repo/index.ts) — 공용 계약
```ts
export interface Repo {
  getOrg(ctx:Ctx): Promise<Org>;
  listMembers(ctx:Ctx): Promise<Member[]>;
  listStages(ctx:Ctx): Promise<Stage[]>;
  listDeals(ctx:Ctx, f?:{stageId?:string; assignedTo?:string; q?:string}): Promise<Deal[]>;
  getDeal(ctx:Ctx, id:string): Promise<Deal|null>;
  createDeal(ctx:Ctx, input:Partial<Deal>): Promise<Deal>;
  updateDeal(ctx:Ctx, id:string, patch:Partial<Deal>): Promise<Deal>;
  moveDealStage(ctx:Ctx, id:string, toStageId:string): Promise<Deal>;   // 단계 이동 + status 활동 자동기록
  listCompanies(ctx:Ctx, f?:{q?:string}): Promise<Company[]>;
  getCompany(ctx:Ctx, id:string): Promise<Company|null>;
  createCompany(ctx:Ctx, input:Partial<Company>): Promise<Company>;
  updateCompany(ctx:Ctx, id:string, patch:Partial<Company>): Promise<Company>;
  listActivities(ctx:Ctx, dealId:string): Promise<Activity[]>;
  addActivity(ctx:Ctx, input:Partial<Activity>): Promise<Activity>;
  listFieldDefs(ctx:Ctx, entity:'company'|'deal'): Promise<FieldDef[]>;
  listSavedViews(ctx:Ctx, entity:'company'|'deal'): Promise<SavedView[]>;
  saveView(ctx:Ctx, input:Partial<SavedView>): Promise<SavedView>;
  dealCountsByStage(ctx:Ctx): Promise<{stageId:string; count:number}[]>;
  monthlySummary(ctx:Ctx, month?:string): Promise<{contracts:number; feeSum:number; downSum:number}>;
}
export function getRepo(): Repo;   // dev → localRepo (Supabase 어댑터는 다음 웨이브)
```
**scope 규칙(localRepo가 강제):** `ctx.role==='member' && ctx.scope==='assigned'` 이면 deals·companies를 `assignedTo===ctx.userId`로 필터. owner/admin 또는 scope='all'은 전체. (Supabase 전환 시 이 규칙이 그대로 RLS 정책이 됨 — 001의 `is_org_member`/`org_scope`.)

## dev 세션 / entitlement
- `getSession()` → `{orgId:'demo-org', userId:'u-owner', role:'owner', scope:'all', name:'데모운영자'}`.
  개발용 역할 스위처 지원(쿼리파라미터 `?as=member` 등으로 role/scope 교체 → scope 필터 눈으로 검증).
- `isEnabled(key)`: `core.*`·`ind.policyfund` = true / `mod.hometax`·`mod.notify`·`mod.esign`·`mod.billing` = **false**(Phase 2).

## 시드 (lib/repo/local/seed.ts) — 실제 고객명 금지, 전부 가상
- org 1(데모 조직) · users 3(owner·admin·member) · pipeline 1.
- stages 6: 신규고객(marketing)·컨텍관리(meeting)·계약(contract)·업무관리(work)·수납·정산(settle)·사후관리(post).
- companies ~20(가상 상호·대표자, region은 002 지역 라벨) · deals ~40(스테이지 분포·담당 분산) · activities 다수.
- field_defs = `presets/policyfund.ts`의 board_columns 전개(계약상황·업종/업태·진행기관·진행상품 등 select 옵션 포함).

## 소유·순서(공용부는 계약)
1. **T03가 이 파운데이션을 먼저 랜딩(PR-0)**: `lib/types` · `lib/repo/index.ts`(+local·store·seed) · `lib/auth/session.ts` · `lib/entitlements.ts` · `lib/presets/policyfund.ts` · `lib/product.ts`.
2. T02·T04는 위 인터페이스에 맞춰 **병렬 구현**, T03 랜딩 후 통합(초기엔 인터페이스만 보고 타입 안전하게 작성).
3. `lib/types`·`lib/repo/index.ts` 변경은 반드시 T03와 합의 후 단독 선행 PR.

## 하네스 필수(모든 트랙 공통)
워크로그 START/END·registry checkpoint / 브랜치+PR(main 직접 커밋 금지) / `scripts/check.sh` 통과 / 파일 500줄 캡 / **한 파일 한 writer**(경계는 각 프롬프트 참조) / 제품명은 `PRODUCT_NAME` 상수만.

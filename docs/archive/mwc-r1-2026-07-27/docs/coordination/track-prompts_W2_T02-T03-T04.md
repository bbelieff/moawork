# W2 트랙 프롬프트 — T02 / T03 / T04 (복사·붙여넣기용)

> 작성: 기획(오케스트레이터) 2026-07-21 · 근거: `docs/PLAN-v0.2.md`, `supabase/migrations/001_schema_v1.sql`, `docs/design/먼데이-구조-스펙.md`, `docs/ssot/*`.
> 사용법: 아래 **0장(공용 규칙)**을 각 트랙이 먼저 읽고, 자기 섹션(T02/T03/T04) 프롬프트를 세션에 붙여넣는다.
> MVP 정의(확정): **먼데이 수준 재현**. 벤더 연동(홈택스·알림톡·세금계산서) 제외→Phase 2. **로컬 우선(Supabase 미연결)**.

---

## 0. 공용 규칙 (세 트랙 공통 — 반드시 준수)

### 0-1. ⚠️ 공용 선행(블로커) — 아직 없음, 먼저 처리
현재 `package.json`에 **Next.js·React·Tailwind가 미설치**이고 `app/`은 빈 자리다. 세 트랙이 각자 앱 셸을 만들면 `package.json`·`app/layout`에서 충돌한다. → **아래 "공용 베이스"를 T01(공용부)이 먼저 1개 PR로 착지**시키고 세 트랙이 그 위에 붙는다. (T01 부재 시: **T03이 셸 소유자로 공용 베이스를 먼저 착지**, T02·T04는 리베이스.)

공용 베이스(PR-0.5) 내용:
- deps 설치: `next react react-dom tailwindcss postcss autoprefixer`
- `app/layout.tsx`(RootLayout)·`app/globals.css`(디자인 토큰 CSS 변수)·`next.config.mjs`·`tailwind.config.ts`·`postcss.config.mjs`
- `lib/config/product.ts` → `export const PRODUCT_NAME = "모아워크";` (제품명은 이 상수만 사용, 하드코딩 금지)
- `lib/types/domain.ts` → 스키마 대응 도메인 타입(아래 0-4)
- `lib/repo/types.ts` → **Repo 포트 인터페이스** + `lib/repo/index.ts` **팩토리**(env에 SUPABASE 없으면 `MemoryRepo` 반환) + `lib/repo/memory/`(빈 어댑터 골격) + `lib/repo/fixtures/`(seed)
- `docs/ssot/design-tokens.md`·`repository-structure.md` 갱신

### 0-2. 아키텍처·품질 게이트 (위반 시 check 실패)
- **계층 방향**: `lib/types/` → `lib/config/` → `lib/repo/` → `lib/service/` → `app/`·`components/`. **왼쪽은 오른쪽을 import 금지.** 외부 SDK 직접 호출은 `lib/repo/`·`worker/adapters/`에만. (지금은 외부 SDK 없음 — 전부 memory 어댑터)
- **로컬 우선**: Supabase·네트워크 호출 **금지**. 모든 데이터는 `lib/repo/memory/` + `lib/repo/fixtures/`. 화면은 `lib/service/`를 통해서만 데이터 접근(직접 repo 접근 금지).
- 제품 소스 **500줄 이하**. 새 파일 경계는 `docs/ssot/repository-structure.md`, 새 컴포넌트는 `docs/ssot/components.md`에 **같은 커밋**으로 등재.
- **`npm run check` 통과 필수**(typecheck=tsc --noEmit / eslint / node --test / 구조검사). base 브랜치 직접 커밋 금지(pre-commit 훅).
- 브랜치: `feat/T02-crm-*` / `feat/T03-org-*` / `feat/T04-dash-*`. 착수·구현·검사·PR 전마다 `session-registry`·`worklog` checkpoint 갱신.
- **가상 고객명만**(실제 고객명·실데이터 금지). **벤더 코드 금지**(hometax·messages·tax_invoices 테이블은 있으나 entitlement OFF·화면 미노출).
- `package.json` 편집은 머지 큐에서 **직렬화**: 순서 = 공용베이스(shell) → T02(data deps) → T04(chart dep).

### 0-3. 파일 리스(겹침 금지 — W2 병렬이므로 엄수)
| 트랙 | 소유 경로(쓰기) | 읽기(의존) |
|---|---|---|
| **T02** | `lib/repo/memory/crm.ts`·`lib/repo/crm.ts`·`lib/service/crm.ts`·`app/(app)/pipeline/**`·`app/(app)/customers/**`·`app/(app)/deals/**`·`components/board/**`·`components/deal/ActivityTimeline.tsx` | 공용베이스, `lib/service/session.ts`(T03) |
| **T03** | 공용 셸(`app/layout.tsx`·`app/(app)/layout.tsx`·`app/login/**`·`app/onboarding/**`)·`lib/service/session.ts`·`lib/service/authz.ts`·`lib/repo/memory/org.ts`·`lib/repo/org.ts`·`lib/repo/auth/**`·`components/app-shell/**`·`components/auth/**`·`tests/unit/authz-isolation.test.mjs` | 공용베이스 |
| **T04** | `app/(app)/page.tsx`(홈)·`components/dash/**`·`components/deal/Attachments.tsx`·`lib/service/dashboard.ts`·`lib/repo/memory/files.ts`·`lib/repo/files.ts` | T02(`lib/service/crm.ts`), T03(`session.ts`) |

### 0-4. 도메인 타입·테이블 정본(스키마 001 기준)
`lib/types/domain.ts`(공용): `Org, User, Member{role:'owner'|'admin'|'member', scope:'all'|'assigned'}, Company, Pipeline, Stage{kind:'marketing'|'meeting'|'contract'|'work'|'settle'|'post'}, Deal, Activity, Settlement, FieldDef, SavedView`. 컬럼명은 001_schema_v1.sql과 1:1(예: `deals.stage_id·assigned_to·amount·applied_on`, `companies.biz_type·region·owner_name·assigned_to`, `settlements.exec_amount·fee_pct·fee_amount·total_revenue·d180·d365`).

---

## 1. T02 — 영업코어 (core.crm)  〔기둥①②〕

붙여넣기 ↓↓↓
```
너는 코드 트랙 T02(영업코어)다. 저장소 통합관리시스템(moawork)에서 `core.crm`을 구현한다.
먼저 읽어라: docs/coordination/track-prompts_W2_T02-T03-T04.md(0장 공용규칙), docs/PLAN-v0.2.md §3 core.crm·§4 흐름B/C, docs/design/먼데이-구조-스펙.md §1~3, supabase/migrations/001_schema_v1.sql(companies·pipelines·stages·deals·activities).

[목표] 먼데이 4단계(신규고객→컨텍관리→업무관리→회계)를 "하나의 파이프라인 + 단계(stage)"로 재현. 칸반/테이블 전환, 단계 드래그 이동, 활동기록, 담당배정. 로컬(메모리 어댑터)만, Supabase·네트워크 금지.

[데이터/repo] lib/repo/crm.ts 에 CrmRepo 인터페이스:
 - listCompanies(orgId), getCompany(id), listDeals(orgId,{stageId?,assignedTo?}), getDeal(id),
   moveDealStage(dealId, toStageId), createDeal(input), updateDeal(id,patch), createActivity(dealId,{type,content,actor}), listActivities(dealId)
 lib/repo/memory/crm.ts 에 위 인터페이스의 인메모리 구현(모듈 상태 + fixtures seed). 실제 값은 lib/repo/fixtures/crm.seed.ts:
 - pipelines 1개('기본 파이프라인'), stages 6개(kind=marketing/meeting/contract/work/settle/post, name=마케팅/미팅/계약/실무/정산/사후, sort_order 0~5)
 - companies·deals ~20건(전부 가상 상호/가상 대표자명), 단계별로 분산, 활동 로그 몇 건.

[서비스] lib/service/crm.ts (repo만 호출, RLS 대체 필터는 session.scope 적용 — lib/service/session.ts의 getSession() 사용):
 - listPipeline(): { stages: Stage[], dealsByStage: Record<stageId, Deal[]> }
 - moveDeal(dealId, toStageId), logActivity(dealId, {type:'call'|'meeting'|'memo', content}), assignDeal(dealId, userId), listCustomers(), getDealDetail(id)
 - 모든 조회는 현재 org로 필터. session.scope==='assigned' && role==='member' 이면 assigned_to===userId 딜만.

[화면] app/(app)/pipeline/page.tsx = 칸반(기본)/테이블 전환. app/(app)/customers/page.tsx = 고객사 목록.
 app/(app)/deals/[dealId]/page.tsx = 딜 상세, 탭 4개(정보·활동·문서·정산). **정보·활동만 T02 구현.** 문서 탭 = <Attachments/>(T04) 플레이스홀더 import, 정산 탭 = "T09" 플레이스홀더.
 컴포넌트: components/board/KanbanBoard.tsx(dnd-kit 드래그로 moveDeal 호출), components/board/BoardTable.tsx(@tanstack/react-table), components/board/DealCard.tsx, components/deal/ActivityTimeline.tsx.
 사이드바 '영업·고객' 링크는 T03 셸이 제공 — 라우트 경로(/pipeline,/customers)만 맞춰라.

[deps 추가(직렬 머지)] @tanstack/react-table @tanstack/react-query @dnd-kit/core @dnd-kit/sortable.
[하지 말 것] 조직/권한/로그인(T03), 홈 대시·파일·계약상황(T04), settlements CRUD·수식(T09), 벤더(홈택스/알림톡/세금계산서), Supabase·네트워크. 파일 500줄↑ 금지.
[완료 기준] npm run check 통과 + 로컬에서 칸반 카드를 드래그해 단계 이동 → 활동기록 추가 → 테이블뷰 전환 → 새로고침 시 seed 유지. docs/ssot/repository-structure.md·components.md에 새 경계·컴포넌트 등재. 브랜치 feat/T02-crm-*, worklog·registry checkpoint.
```
↑↑↑

---

## 2. T03 — 조직보안 (core.org + 권한격리 + 로그인)  〔기둥④·보안〕

붙여넣기 ↓↓↓
```
너는 코드 트랙 T03(조직보안)다. `core.org`(3역할·담당범위·로그인) + 앱 셸 + 권한 격리를 구현한다.
먼저 읽어라: track-prompts_W2_T02-T03-T04.md(0장), docs/PLAN-v0.2.md §3 core.org·§4 흐름A, supabase/migrations/001_schema_v1.sql(orgs·users·org_members + is_org_member()/org_role()/org_scope() 정책).

[중요] 실제 구글 OAuth·실제 RLS는 Supabase 연결 후(Phase). 지금은 (a) 로컬 mock 인증 (b) repo/service 계층에서 org·scope 격리를 강제 (c) 격리 단위테스트로 증명. DB-RLS 침투테스트는 Supabase 연결 후 T03·T10.

[공용 셸(네가 소유·먼저 착지)] app/layout.tsx(RootLayout)·app/(app)/layout.tsx(좌측 사이드바=6기둥 순서: 영업·고객/실무/정산·회계/성과·조직/문서·연동/설정, 링크: /pipeline·/customers·/(홈)·/settings)·app/globals.css(중립 시맨틱 토큰, 브랜드색은 O1 전 잠정)·PRODUCT_NAME은 lib/config/product.ts 상수 사용. deps: next react react-dom tailwindcss postcss autoprefixer.

[인증(mock)] lib/repo/auth/mockAuth.ts: 개발용 사용자 스위처(가상 유저 3~4명), signInWithGoogle()=stub, getUser(). 인터페이스는 나중에 Supabase Auth로 교체 가능하게(getUser/onAuthChange 시그니처 유지). app/login/page.tsx = "구글로 계속" 버튼(mock) + 개발용 유저 선택.

[조직/세션] lib/repo/org.ts(OrgRepo: getOrg,createOrg,listMembers,addMember,setRole,setScope) + lib/repo/memory/org.ts + fixtures/org.seed.ts(조직 2개=A/B, 각 멤버 owner/admin/member, 교차검증용). lib/service/session.ts: getSession()={userId,orgId,role,scope}, switchOrg(orgId). lib/service/authz.ts: canSeeDeal(session,deal), scopedFilter(session)(=all|assigned 규칙, 001의 companies/deals 정책과 동일 로직).

[화면] app/onboarding/page.tsx(조직 생성→업종팩 '정책자금' 선택→"예시 데이터 넣기") · app/(app)/settings/members(멤버 초대·역할·범위). components/app-shell/Sidebar.tsx·OrgSwitcher.tsx, components/auth/UserMenu.tsx.

[격리 증명] tests/unit/authz-isolation.test.mjs (node --test): ①조직 A 세션이 조직 B의 deal/company 조회 시 0건 ②member+assigned 세션은 본인 담당만 ③owner/admin 또는 scope=all 은 조직 전체. 이 테스트가 npm run check에 포함되어 green.

[하지 말 것] 보드/딜 화면(T02), 홈 대시·파일(T04), 벤더, 실제 Supabase/OAuth 네트워크. 파일 500줄↑ 금지.
[완료 기준] npm run check(격리 테스트 포함) 통과 + 로컬에서 유저/조직 A↔B 전환 시 상대 데이터 절대 안 보임 + member=본인 담당만. repository-structure.md·components.md·design-tokens.md 등재. 브랜치 feat/T03-org-*, checkpoint.
```
↑↑↑

---

## 3. T04 — 문서·대시 (core.files 최소 + core.dash)  〔기둥⑤〕

붙여넣기 ↓↓↓
```
너는 코드 트랙 T04(문서·대시)다. core.dash(기본 대시보드) + core.files 최소(파일첨부·계약상황)를 구현한다.
먼저 읽어라: track-prompts_W2_T02-T03-T04.md(0장), docs/PLAN-v0.2.md §3 core.files/core.dash·§4 흐름C/D.
[범위 정정 — 반드시 준수] core.files의 MVP는 (1) 딜 파일첨부(먼데이 파일컬럼 수준, **로컬 메타데이터만** — 실제 업로드·Supabase Storage 금지) (2) 계약상황 필드(field_defs 프리셋). **계약서 문서함·contracts 테이블·전자서명은 Phase 2(구현 금지).**

[의존] T02 lib/service/crm.ts(딜 데이터 읽기), T03 lib/service/session.ts(현재 org·scope). 없으면 인터페이스에 맞춘 임시 stub로 진행하고 착지 순서는 T02·T03 뒤.

[대시 서비스] lib/service/dashboard.ts (crm 서비스 read + 정산 값 읽기):
 - stageCounts(): 단계별 딜 수 + 전환율, monthlySummary(): 이번달 계약건수·계약금합·수납(수수료입금)합, recentActivities(limit).
 - 정산 수식 패리티(먼데이): 수수료(원)=round(exec_amount×fee_pct/100), 총매출=down_payment+수수료(원). settlements(T09) 미착지면 deals.amount 기반 임시 집계 + TODO 주석(T09 연결점).
[파일/계약상황] lib/repo/files.ts(FilesRepo: listAttachments(dealId), addAttachment(meta), removeAttachment) + lib/repo/memory/files.ts(메타: name,size,mime,dealId,at — 실제 바이트 저장 안 함). 계약상황은 field_defs 프리셋 키 'contract_status'(선택지: 미작성/작성중/작성완료/발송/보류) 값을 deal.custom 또는 field_values로 표시·변경.

[화면] app/(app)/page.tsx = 홈: 상단 고정 요약카드(이번달 계약수·수납액) + 단계별 퍼널 + 최근활동. components/dash/StatCards.tsx·StageFunnel.tsx·RecentActivity.tsx(차트는 recharts). components/deal/Attachments.tsx = 딜 상세 '문서' 탭: 계약상황 select + 파일 리스트(추가/삭제, 로컬). 모바일 폭에서 상단 요약 유지.

[deps] recharts.
[하지 말 것] 보드/딜코어(T02), 조직/권한/셸(T03), 문서함·전자서명·Storage 실연동·contracts 테이블(Phase 2), 벤더, Supabase·네트워크. 파일 500줄↑ 금지.
[완료 기준] npm run check 통과 + 홈 요약 숫자가 seed로 계산·표시, 딜 문서탭에서 계약상황 변경·파일 메타 추가/삭제, 모바일에서 요약 유지. repository-structure.md·components.md 등재. 브랜치 feat/T04-dash-*, checkpoint.
```
↑↑↑

---

## 4. 오케스트레이터 노트 (belie 참고)
- **선행 블로커**: Next/React 미설치 → 공용 베이스(0-1)를 T01 또는 T03이 먼저 착지해야 세 트랙이 붙는다. 안 하면 `package.json`/`app/layout` 충돌.
- **T04는 T09(settlements) 의존**: 정산 수식 값이 필요. T09 미착지 구간은 임시 집계+TODO로 진행하도록 프롬프트에 명시함. T09도 곧 프롬프트 필요.
- **RLS**: 지금은 service 계층 격리 + 단위테스트(T03)로 "다른 조직 안 보임"을 보장. **DB 레벨 RLS 침투테스트는 Supabase 연결 후**(T03·T10) 별도.
- W2 병렬 → 0-3 파일 리스 엄수, `package.json`은 직렬 머지.

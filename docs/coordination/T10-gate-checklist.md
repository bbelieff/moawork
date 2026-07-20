# T10 게이트키퍼 검증 체크리스트 — 트랙 머지/배포 판정 SSOT

> 소유: **T10(게이트키퍼)**. 각 트랙의 PR/머지/배포 시 이 체크리스트로 **완료판정**한다.
> 근거: `docs/PLAN-v0.2.md`(MVP=먼데이 파리티), `supabase/migrations/001_schema_v1.sql`(스키마 v1·RLS 33정책),
> `docs/design/먼데이-전체스키마-v1.md`(원본 컬럼·선택지).
> 판정 원칙: **`check.sh` 게이트 통과** + **아래 항목 전부 통과**일 때만 `done` 승인. 하나라도 실패=반려(blocked).
> 표기: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패(반려) · `[~]` 부분/후속(Phase 2 등).

---

## 0. 공통 게이트 (모든 트랙 머지에 매번 적용)

- [ ] **품질 게이트**: `bash scripts/check.sh` → 초록(exit 0). lint + typecheck(app/worker `tsc --noEmit`) + test(vitest) 전부 통과.
- [ ] **마이그레이션 규칙**: Supabase 변경은 **새 파일 추가만**(기존 `0001`/`001`/`0002`/`002` 수정 금지). 파일명 순번 단조 증가.
- [ ] **비밀값 부재**: diff에 키·토큰·비밀번호·연결문자열 없음. `.env.example` 형태만. (`git diff | grep -iE 'key|secret|password|token|postgres://'` 육안 확인.)
- [ ] **RLS 기본**: 신규 도메인 테이블은 `enable row level security` + 최소 1개 정책 동반. `org_id` 없는 업무 테이블 없음(전역 카탈로그 제외).
- [ ] **SSOT 갱신**: `docs/worklog.md` 항목 추가, 관련 `docs/coordination/*`(session-registry·dispatch-queue) 상태 반영.
- [ ] **측정 기록**: 이 문서 해당 트랙 표에 통과/실패·테스트 수·게이트 시간 기입.

---

## 1. T03 파운데이션 머지 — `core.org` + RLS 멀티테넌시 + 구글 OAuth

> 산출물 예상: `orgs`/`users`/`org_members` 활성화, RLS 헬퍼 런타임 검증, Supabase Auth(Google) 로그인 라우트, 온보딩(조직 생성→owner 자동등록).
> **핵심 완료판정(PLAN §3 core.org)**: "다른 조직 데이터가 절대 안 보임(RLS 침투 테스트 통과) · 멤버는 본인 담당만."

### 1-A. 타입 안정성
- [ ] `supabase gen types` 로 생성된 DB 타입이 앱과 정합(수기 타입과 drift 없음). 타입 소스가 스키마 단일 출처.
- [ ] `member_role`(owner/admin/member)·`member_scope`(all/assigned) enum이 앱 타입/유니온과 1:1 일치.
- [ ] Auth 세션 → `auth.uid()` 매핑 계층(예: `crm/context.ts`의 org/user 주입)이 `any` 없이 타입 안전. null 세션 경로 처리됨.
- [ ] typecheck 통과 + T02 `crm/context.ts`(현재 스텁/가정) 실제 Auth 연동으로 교체 후에도 컴파일 초록.

### 1-B. scope 격리 (RLS 침투 테스트) ★최우선
> 방법: Supabase에 001 적용 후, **서로 다른 org의 2계정**(A: owner/all, B: member/assigned) + 3번째 타org 계정으로 실DB 쿼리.
- [ ] **교차 조직 차단**: org2 계정으로 org1의 `companies`/`deals`/`settlements`/`activities` SELECT → **0행**. INSERT/UPDATE(타org `org_id`) → 거부.
- [ ] **담당범위(assigned)**: `scope='assigned'` 멤버는 `assigned_to = 본인`인 companies/deals만 조회. 타인 담당 건 → 0행. owner/admin 및 `scope='all'`은 조직 전체 조회.
- [ ] **RLS 헬퍼 무재귀**: `is_org_member()`/`org_role()`/`org_scope()`가 `SECURITY DEFINER`로 org_members RLS 우회하며 무한재귀 없음(정책 평가 시 실쿼리로 확인).
- [ ] **전역 카탈로그**: `plans`/`plan_features`/`industry_modules`는 인증사용자 읽기만, 쓰기 거부(service_role만).
- [ ] **service_role 경계**: 서버 전용 키가 클라이언트 번들에 유출 안 됨(anon key만 브라우저 노출).
- [ ] **stages 간접통제**: `stages`는 상위 `pipelines.org_id`로 통제됨 — 타org pipeline의 stage 접근 차단 확인.

### 1-C. 온보딩 흐름
- [ ] **구글 OAuth**: 로그인→콜백→세션 수립 성공. 최초 로그인 시 `public.users` 프로필 1:1 생성.
- [ ] **부트스트랩 트리거**: 조직 생성(`insert orgs`) 직후 `trg_orgs_add_owner`로 생성자가 `owner`/`scope=all` 멤버 자동 등록 → 빈 조직 못 보는 문제 없음(생성 직후 즉시 조회 가능).
- [ ] **멤버 초대·권한**: owner/admin만 `org_members` 관리(members_manage 정책). member는 초대 불가.
- [ ] **로그아웃/세션 만료** 시 보호 라우트 접근 차단(미인증 리다이렉트).
- [ ] **엔타이틀먼트 게이트**: 기능 노출이 `feature_key`(org_entitlements)로만 판정 — 플랜명 하드코딩 없음. MVP는 core.* + ind.policyfund ON, 벤더(mod.hometax/notify) OFF.

---

## 2. T02 CRM 머지 — `core.crm` 보드 미러 + 파이프라인 + 단계 이동 자동화

> 산출물: `supabase/migrations/0002_core_crm.sql`, `app/src/lib/crm/*`(formulas·pipeline·views·validation·service·store·postgrest), `app/src/app/api/boards|items|views/*`.
> **핵심 완료판정(PLAN §3 core.crm)**: "신규 건을 유입→계약→실무까지 단계 이동하며 끝까지 처리, 활동 로그 남음."
> **parity 기준**: 화면은 먼데이와 동일(보드·컬럼·뷰·이동·수식), 내부는 정규화(deals+stages).

### 2-A. 칸반 드래그 (단계 이동 자동화)
- [ ] **단계 이동 API**: `POST /api/items/[itemId]/move` 로 `stage_id` 변경 → 성공 시 deal의 stage 갱신 + `updated_at` 갱신.
- [ ] **자동화 재현**: 먼데이 "이동" 자동화 대응 로직(단계 진입 시 부수효과: 활동 로그 `type=status` 기록 등)이 동작. 이동 시 activity 1건 이상 남음.
- [ ] **칸반 정렬**: 같은 단계 내 카드 정렬 순서 안정적·영속(새로고침 유지). 미지정 정렬키는 후순위·안정정렬(`pipeline.ts` 규칙과 일치).
- [ ] **파이프라인 4단계 매핑**: `stage_kind`(marketing/meeting/contract/work/settle/post) → 먼데이 4보드(신규고객→컨텍→업무→회계) 뷰 필터가 정확. 단계 누락/중복 없음.
- [ ] **경계값**: 존재하지 않는 stage_id·타org stage로 이동 시 거부(400/403). 마지막 단계에서 전진/역행 처리 정의됨.

### 2-B. 딜 CRUD
- [ ] **생성**: `POST /api/boards/[boardId]/items` → deal 생성(필수 `title`, `org_id` 서버주입). `amount` 등 optional 허용.
- [ ] **조회/수정/삭제**: `GET/PATCH/DELETE /api/items/[itemId]` 동작. 수정 시 `updated_at` 갱신, 삭제 시 연관 `activities`(on delete cascade)·`settlements` 정합.
- [ ] **저장뷰(saved_views)**: `/api/boards/[boardId]/views`·`/api/views/[viewId]` — 필터/정렬/표시컬럼 저장·조회, 개인(user_id)/공유(shared) 구분. 새로고침 후 유지.
- [ ] **검증(validation.ts)**: 잘못된 입력(타입 불일치·필수 누락·타org 참조) 거부. `validation.test.ts` 통과.
- [ ] **정산 수식 parity**(settlements generated column): `fee_amount = round(exec_amount × fee_pct / 100)`, `total_revenue = down_payment + fee_amount`, `d180 = fee_paid_at+180`, `d365 = +365`. **%는 정수(3=3%)**. `formulas.ts`/`formulas.test.ts` 값이 DB generated column과 **동일 결과**(round 반올림 규칙 포함) — 실DB 값과 대조.
- [ ] **커스텀필드 값**: `deals.custom`(jsonb 간이) ↔ `field_values`(상세) 저장 경로 정의. (본격 커스텀필드=T05 경계.)

### 2-C. 활동 기록
- [ ] **활동 생성**: 통화/미팅/메모(`type` = call/meeting/memo/status) 기록 API 동작. `actor`=현재 사용자, `at` 타임스탬프.
- [ ] **딜 연결**: activity가 `deal_id`로 연결, 딜 상세 "활동" 탭 시간순 조회. 딜 삭제 시 cascade.
- [ ] **RLS 정합**: activity는 `is_org_member(org_id)` 정책 — 타org 활동 조회/생성 불가(T03 침투 테스트 세트에 포함).
- [ ] **어댑터 정합**: `store.ts` 포트 ↔ InMemory/PostgREST 어댑터 동일 동작. `postgrest.test.ts` 쿼리빌더가 실DB(PostgREST) 라이브 통합테스트로 확인(현재 단위테스트 → 머지 시 라이브 1회).

---

## 3. T04 대시보드 머지 — `core.dash` 기본 대시보드 + `core.files` 파일 첨부 + 계약상황

> 산출물 예상: 홈 대시보드(오늘 할 일 + 이번달 계약/수납 요약, 단계별 건수·전환율), Storage 파일 첨부, `계약상황` field_def 프리셋.
> **핵심 완료판정(PLAN §3 core.dash/core.files)**: "매일 보는 숫자가 상단 고정, 모바일 유지" · "계약상황이 딜에서 표시·변경됨."

### 3-A. 집계 정확성
- [ ] **단계별 건수/전환율**: deals를 stage별 집계 → 화면 숫자가 실DB `count(*) group by stage_id`와 일치. 전환율 분모/분자 정의 명확(0분모 방어).
- [ ] **이번달 계약/수납 요약**: `settlements` 집계 — 계약금·수수료(원)·총매출 합계가 generated column 합과 일치. 기간 경계(월초/월말, 타임존 KST)로 누락/중복 없음.
- [ ] **집계 = 뷰/파생**: 대시보드 수치가 원본에서 파생(별도 이중저장으로 drift 없음). 원본 변경 후 재조회 시 즉시 반영.
- [ ] **RLS 통과 집계**: 대시보드 쿼리가 RLS 하에서도 정확(집계도 org 격리·assigned 범위 반영 — 멤버는 본인 담당 기준 숫자). 타org 데이터 합산 안 됨.
- [ ] **D+180/D+365 재접촉 목록**: `d180`/`d365` 기준 재접촉 대상 목록이 날짜 계산과 일치(`fee_paid_at` null 처리 포함).
- [ ] **빈 상태**: 데이터 0건일 때 0/‘—’ 표시(NaN·에러 없음). 모바일 레이아웃 상단 고정 유지.

### 3-B. 파일 첨부 (core.files)
- [ ] **업로드/다운로드**: 딜에 파일 첨부(먼데이 파일 컬럼 재현) → Storage 저장, 서명 URL로 다운로드. 만료 URL 처리.
- [ ] **Storage RLS**: 첨부 파일이 org 단위 격리(타org 파일 경로 접근 차단). 버킷 정책 = 조직 멤버만.
- [ ] **계약상황(monday 파리티)**: `계약상황` = `field_defs` select 프리셋(002 seed, 작성여부 포함) — 딜 상세에서 표시·변경. **임의 boolean 아님**(PLAN v0.2.2 확정).
- [ ] **용량/타입 가드**: 업로드 크기·확장자 제한, 실패 시 사용자 메시지. 악성/실행 파일 차단.
- [ ] **Phase 2 경계 확인**: 문서함 버전관리·전자서명 체결은 **MVP 제외**(Phase 2) — 이 범위를 넘는 구현이 섞이지 않았는지. `[~]`로 표기 가능.

---

## 4. 판정 기록 (측정 로그)

| 트랙 | PR/커밋 | 게이트 | parity | RLS 침투 | 집계/기능 | 판정 | 일시 | 비고 |
|---|---|---|---|---|---|---|---|---|
| T03 | — | — | — | — | — | 대기 | — | core.org 미머지 |
| T02 | — | — | — | — | — | 대기 | — | crm 코어 미머지(작업 트리 존재) |
| T04 | — | — | — | — | — | 대기 | — | dash/files 미착수 |

> 각 트랙 머지 시 위 표 갱신 + `docs/worklog.md`에 T10 판정 항목 기입.

---

## 부록. 현재 상태 스냅샷 (2026-07-21, 등록 시점)
- 스키마 v1(`001_schema_v1.sql`) 문법 검증 완료 — **런타임 RLS 행동은 Supabase 적용 후 침투 테스트로 확정(T03·T10)**.
- T02 crm 코어는 작업 트리에 산출(도메인 순수 계층 + API 라우트 + InMemory/PostgREST 어댑터), Auth/RLS 실연동은 T03 후속.
- 베이스라인 `check.sh` 초록 확인됨. parity·RLS 런타임 검증은 각 트랙 배포·Supabase 적용 시 착수.

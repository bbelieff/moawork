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

> **게이트 범위 주의(2026-07-21 기획2 피드백 반영)**: `pre-commit` 은 *커밋 대상*이 아니라 **워킹트리 전체**를 검사한다.
> 공유 워킹트리에서 병렬 작업 시 **타 트랙의 미완성 코드가 내 커밋을 차단**한다(실제 발생: T09 `presets.test.ts` 타입오류로
> T10 문서 커밋 차단 — 게이트의 **정상 동작**, main 오염 방지). 단 **워킹트리 격리(worktree) 적용 후에는 이 교차 차단이 사라지므로**,
> 격리 환경에서는 **CI(`ci.yml`)가 통합 지점의 유일한 교차 검증**이 된다 → 머지 전 CI 초록을 반드시 확인할 것.
> 어느 경우든 **`--no-verify` 로 게이트를 우회하지 않는다**(우회 발견 시 T10 은 해당 커밋을 반려한다).

---

## 1. T03 파운데이션 머지 — `core.org` + RLS 멀티테넌시 + 구글 OAuth

> 산출물 예상: `orgs`/`users`/`org_members` 활성화, RLS 헬퍼 런타임 검증, Supabase Auth(Google) 로그인 라우트, 온보딩(조직 생성→owner 자동등록).
> **핵심 완료판정(PLAN §3 core.org)**: "다른 조직 데이터가 절대 안 보임(RLS 침투 테스트 통과) · 멤버는 본인 담당만."

> ⚠️ **PR #1(a7bdc9d) 실제 구현은 "로컬 우선"** — 세션은 Supabase Auth 가 아니라 **dev-session 쿠키**(`mw_uid`/`mw_org`/`mw_as`) +
> 인메모리 `getRepo()` seed 다. 따라서 아래 **scope 격리는 앱 레이어(`repo.listDeals(ctx)`)에서 검증된 것이며,
> Postgres RLS 정책(001_schema_v1.sql) 런타임 검증과는 별개**다. 구글 OAuth·DB RLS 는 Supabase 연결 후 재검증 필수.

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

## 4. 런타임 스모크 테스트 (필수 · CI 초록으로 대체 불가)

> **원칙(기획2 피드백 2026-07-21 반영): `check.sh` 초록만으로 "완료" 판정하지 않는다.**
> lint/typecheck/unit test 는 화면이 실제로 뜨는지, 가드가 도는지, 격리가 먹는지 증명하지 못한다.
> 모든 UI 포함 PR 은 아래 클릭스루를 **실행하고 결과를 §5 표에 기록**해야 done 승인.

### 머지큐 & 판정 규칙 (기획2 확정 2026-07-21)
머지 순서: **①T03 → ②T02crm → ③T02boards → ④T04 → ⑤T05**.
- **각 머지 직후 `main` 에서 스모크 재확인이 T10 의 역할.** 최소 T03·T02·T04 머지 후 각각 수행.
- **"완료" 판정은 `main` 스모크 초록일 때만.** 브랜치에서 통과한 것은 **후보(candidate)** 일 뿐 done 이 아니다.

### 실행 절차 (재현용)

**자동화**: `PORT=3010 bash scripts/smoke.sh` (전용 워크트리에서). PASS/FAIL/SKIP 요약 + 종료코드로 판정.

> ⚠️ **false pass 위험 — 반드시 전용 포트를 쓸 것.** 병렬 트랙들이 각자 dev 서버를 띄우므로 3000 은 대개 선점돼 있다.
> 그 상태로 스모크를 돌리면 **내 브랜치가 아니라 남의 브랜치 서버를 검사**하고도 통과로 보고된다.
> (2026-07-21 실제 발생: main 워크트리에 auth 파일이 0개인데 `/login` 200·계정 3개가 나와 통과처럼 보임 →
> 3000 은 타 트랙 서버였고 내 서버는 3001 로 밀려나 있었음. `smoke.sh` 에 포트 선점 시 **ABORT** 가드 추가로 재발 차단.)
> 또한 `next dev` 는 npm 래퍼를 kill 해도 자식 프로세스가 남는다 — 재실행 전 잔존 PID 정리 필요.

> ⚠️ **false fail 위험 — 브랜치 전환 후 `.next` 캐시를 반드시 비울 것.** 워크트리에서 브랜치를 갈아끼우면
> 이전 브랜치의 Next.js 생성 타입(`.next/dev/types/validator.ts`)이 남아 **없는 라우트를 참조**하며 typecheck 를 깨뜨린다.
> (2026-07-21 실제 발생: main 으로 되돌린 뒤 `Cannot find module '../../../src/app/api/deals/route.js'` 로 게이트 실패 —
> main 코드 결함이 아니라 T03 브랜치 잔재였음. `rm -rf app/.next app/tsconfig.tsbuildinfo` 후 초록 복구.)
> `smoke.sh` 가 실행 전 자동으로 비우지만, **수동으로 `check.sh` 를 돌릴 때도 동일하게 정리**해야 오판하지 않는다.
> — 요약: 병렬·워크트리 환경의 게이트는 **포트(오통과)와 빌드캐시(오실패)** 양쪽을 다 통제해야 신뢰할 수 있다.


```bash
npm run dev                     # http://localhost:3000 (Ready 확인)
# seed 계정: owner usr…a1 / admin usr…a2 / member usr…a3, seed org …0001
# dev-session 은 쿠키라 curl 로 인증 상태 재현 가능:
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' localhost:3000/          # 미인증 가드
curl -s -b 'mw_uid=<uid>' localhost:3000/onboarding                               # 인증 화면
# 서버액션(폼 제출)은 $ACTION_ID_* 히든필드를 그대로 POST:
curl -s -i -X POST -b 'mw_uid=<uid>' -F '$ACTION_ID_<id>=' -F 'name=<조직명>' -F 'preset=on' \
     localhost:3000/onboarding
```

### 클릭스루 항목 (로그인 → 온보딩 → 홈)
- [ ] **미인증 가드**: `/`·`/onboarding`·`/settings/members`·`/dash/*` → **307 → `/login`**.
- [ ] **로그인 화면**: `/login` 200, 계정 목록 렌더. (Supabase 연결 후: 구글 OAuth 버튼으로 교체됐는지)
- [ ] **로그인 수행**: 계정 선택 → 세션 쿠키 발급 → `/onboarding` 리다이렉트.
- [ ] **온보딩 조직 생성**: 폼 제출 → **303 + `Set-Cookie: mw_org` + `Location: /`**. 생성자가 owner 로 자동 등록(부트스트랩).
- [ ] **업종팩 프리셋**: 정책자금팩 설치 → 딜 커스텀필드 전개. **`계약상황`이 select 프리셋**(임의 boolean 아님 — PLAN v0.2.2).
- [ ] **홈 렌더**: `/` 200, 대시보드 위젯 표시. 데이터 0건 조직에서도 에러 없음.
- [ ] **scope 격리(앱 레이어)**: member(assigned) 는 **타인 담당 딜이 목록에서 사라짐**. owner/admin 은 전체.
- [ ] **조직 격리(앱 레이어)**: 신규 조직 세션에서 **이전 조직 데이터 0건**.
- [ ] **로그아웃**: 세션 쿠키 전량 만료 + `/login` 리다이렉트.
- [ ] **서버 로그 무에러**: 클릭스루 전 구간 dev 서버 로그에 error/exception 0건. 404 라우트 정상.

---

## 5. 판정 기록 (측정 로그)

| 트랙 | PR/커밋 | 게이트 | 런타임 스모크 | scope 격리 | DB RLS 침투 | 판정 | 일시 |
|---|---|---|---|---|---|---|---|
| **main 베이스라인** | `f23ed34` | ✅ 초록 | PASS 3 / SKIP 7 | — | — | **T03 미머지 확정** | 2026-07-21 |
| **① T03 on main** | **`97348b1`** (Merge PR #1) | ✅ 초록 | ✅ **PASS 11 / FAIL 0 / SKIP 2** | ⚠️ 조직격리만 | ⛔ 미검증 | **①단계 통과 — core.org done 아님** | 2026-07-21 |
| T03 | `a7bdc9d` PR-0 *(브랜치 한정)* | ✅ 초록 | ✅ 통과(10/10) | ✅ 앱레이어 통과 | ⛔ 미검증 | **후보 — main 머지 후 재검증 대기** | 2026-07-21 |
| T02crm | `cd2193d` *(브랜치)* | ✅ 초록 | — 미실시 | — | ⛔ 미검증 | 대기(②) | — |
| T02boards | `4cbdef3` *(브랜치)* | — | — | — | — | 대기(③) | — |
| T04 | `011f6c6` *(브랜치)* | ✅ 초록 | ✅ 홈 렌더 확인 | ✅ `?as=` 반영 | ⛔ 미검증 | 대기(④) | — |
| T05 | `2e294d8` *(브랜치)* | — | — | — | — | 대기(⑤) | — |

**main 베이스라인 실측(`f23ed34`, 2026-07-21)**: `/login`·`/onboarding`·`/settings/members`·`/dash/*` **전부 404** →
인증·CRM·대시 화면이 **main 에 아직 없음**. `/` 200(기본 페이지), 미존재 라우트 404, 서버 에러 0건.
→ **머지큐 ①T03 이 아직 main 에 들어오지 않았다.** 이 표의 T03 "통과"는 브랜치 결과이므로 **done 이 아니다.**

### ★ ①T03 main 판정 (main `97348b1`, 2026-07-21 · T10 실측)
게이트 `✅ check 통과` + main 스모크 `PASS=11 FAIL=0 SKIP=2`.
**통과**: 미인증 가드 `/`·`/onboarding`·`/settings/members` → 307 `/login` · `/login` 200(계정 3) · 온보딩·홈 200 ·
조직생성 서버액션 303+`mw_org` · **조직 격리**(신규 조직에 이전 조직 딜 0건) · 업종팩 프리셋(계약상황) · 404 정상 · 서버 에러 0건.

**⛔ 미확정 — `core.org` 를 done 으로 올리지 말 것**:
1. **담당범위(딜 단위) scope 격리** — 칸반 `/dash/*` 가 404(T02 미머지)라 **SKIP**. PLAN §3 "멤버는 본인 담당만" 은 **③T02 머지 후 main 에서 확정**.
2. **구글 OAuth 실동작** — 여전히 dev-session 쿠키. Supabase Auth 연결 후 §1-C 재검증.
3. **Postgres RLS 33정책 런타임** — 위 격리는 전부 앱 레이어. Supabase 적용 후 §1-B 침투 테스트 필요.
→ **①단계 게이트로서는 통과**(머지큐 진행 가능). **모듈 완료판정은 보류.**

**①T03 사전 스모크(브랜치 tip `cb6649e`, 2026-07-21 · 머지 전 후보 점검)**: `PASS=11 FAIL=0 SKIP=2` — 머지 후보로 건전.
통과: 미인증 가드 3라우트 → `/login` · `/login` 200(계정 3) · 온보딩/홈 200 · 조직생성 서버액션(`mw_org` 발급) ·
**조직 격리**(신규 조직에 이전 조직 딜 0건) · 프리셋 전개(계약상황) · 404 · 서버 에러 0건.

> ⚠️ **T03 단독으로는 "딜 단위 scope 격리"를 검증할 수 없다.** 칸반(`/dash/*`)이 T02 산출물이라 T03 브랜치에선 404 → SKIP.
> 즉 **PLAN §3 core.org 완료판정의 "멤버는 본인 담당만"은 ①T03 머지만으로 확정 불가**하며, **③T02 머지 후 main 에서 확정**해야 한다.
> ①T03 머지 시점의 판정은 "인증·온보딩·조직격리 통과, 담당범위 격리 미확정"으로 기록할 것.

### 머지큐 진행 현황 (T10 갱신)
- [x] **① T03 머지 → main 스모크 ✅ 통과** — main `97348b1`(Merge PR #1), 게이트 초록 + 스모크 `PASS=11 FAIL=0 SKIP=2`.
      **단, core.org 는 아직 done 아님** — 아래 ①판정 참조(담당범위 격리·DB RLS 미확정).
- [x] ~~② feat/t02-crm-core~~ — **폐기 확정**(중복·오염, 기획2 Round 3). 브랜치 삭제 예정.
      *T10 영향 없음*: 해당 브랜치에 있던 T10 커밋 `ae97140` 은 이미 main 으로 cherry-pick 완료(`8d6cfab`).
- [ ] **③ T02 보드엔진(클린 rebase) 머지 → main 스모크** — 이때 **딜 단위 scope 격리 확정**
- [ ] **④ T04 독립 머지 → main 스모크**
- [ ] **⑤ T05 구현**

### T03 PR-0 상세 판정 (2026-07-21 · T10 실측)

> **판정 대상 ref 주의**: 이 스모크는 브랜치 **`feat/t02-crm-core`(= T03 PR-0 `a7bdc9d` 포함 계열)** 워킹트리에서 실행했다.
> **`a7bdc9d` 는 `origin/main` 의 조상이 아니다** — 검증 시점 `origin/main`(d5e31ba)에는 `app/src/lib/auth/session.ts`·
> `login`·`onboarding` 라우트가 **존재하지 않는다**. 즉 **아래 통과 결과는 해당 PR 브랜치에 대한 것이며, main 에 대한 승인이 아니다.**
> main 머지 시 **동일 클릭스루를 머지 커밋 기준으로 재실행**해야 done 승인이 유효하다.
**통과**: 미인증 가드 307→`/login`(4개 라우트 전부) · `/login` 200(계정 3) · 온보딩 200 · 조직생성 서버액션 **303+`mw_org` 발급** ·
정책자금팩 설치 → **딜 커스텀필드 7개 전개**(진행기관·세부자금·지역 select / 실행액·수수료(%) number / **계약상황 select** / 수수료입금일 date) ·
홈 200 · **scope 격리 실증**(member 칸반에서 admin 담당 `라마바테크 시설자금` **0건**, owner 는 3건 전부) ·
**조직 격리 실증**(신규 조직 홈에 시드 조직 딜 0건) · 로그아웃 쿠키 3종 만료 → `/login` · 404 정상 · **서버 에러 로그 0건**.

**미검증(= done 아님, 후속 필수)**:
1. **구글 OAuth 실동작** — 현재 dev-session 쿠키. Supabase Auth 연결 후 §1-C 재검증.
2. **Postgres RLS 정책 런타임** — 위 격리는 **앱 레이어**. `001_schema_v1.sql` 의 33개 정책(`is_org_member`/`org_role`/`org_scope`,
   companies·deals assigned 조건, 전역 카탈로그 읽기전용)은 **Supabase 적용 후 §1-B 침투 테스트로 별도 확정**.
3. 앱 레이어 격리와 DB RLS 가 **동일 규칙인지 정합 대조**(한쪽만 막히면 우회 경로가 됨).

> 각 트랙 머지 시 위 표 갱신 + `docs/worklog.md`에 T10 판정 항목 기입.

---

## 부록. 현재 상태 스냅샷 (2026-07-21, 등록 시점)
- 스키마 v1(`001_schema_v1.sql`) 문법 검증 완료 — **런타임 RLS 행동은 Supabase 적용 후 침투 테스트로 확정(T03·T10)**.
- T02 crm 코어는 작업 트리에 산출(도메인 순수 계층 + API 라우트 + InMemory/PostgREST 어댑터), Auth/RLS 실연동은 T03 후속.
- 베이스라인 `check.sh` 초록 확인됨. parity·RLS 런타임 검증은 각 트랙 배포·Supabase 적용 시 착수.

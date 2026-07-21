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

### 실행 절차 (재현용)
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
| T03 | `a7bdc9d` PR-0 | ✅ 초록 | ✅ 통과(10/10) | ✅ 앱레이어 통과 | ⛔ 미검증(Supabase 미연결) | **조건부 통과** | 2026-07-21 |
| T02 | `cd2193d` | ✅ 초록 | — 미실시 | — | ⛔ 미검증 | 대기 | — |
| T04 | (홈 대시보드 선반영) | ✅ 초록 | ✅ 홈 렌더 확인 | ✅ `?as=` 반영 확인 | ⛔ 미검증 | 부분 | 2026-07-21 |

### T03 PR-0 상세 판정 (2026-07-21 · T10 실측)
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

## 6. B0 (T01) — Vercel Install Command 오버라이드 제거 + vitest 정식화

### ⚠️ 선결 발견: 프로덕션 빌드가 어느 게이트에도 없다 (2026-07-21 T10 실측)
- `scripts/check.sh` = lint + typecheck + test. **`npm run build` 없음**(`grep -c build scripts/check.sh` → **0**).
- `.github/workflows/ci.yml` 은 `bash scripts/check.sh` 만 실행 → **CI 도 빌드를 돌리지 않음**.
- 즉 **Vercel 이 돌리는 `next build` 는 어떤 게이트도 막지 못한다.** B0 가 빌드를 초록으로 만들어도 **다음 PR 이 조용히 깨뜨릴 수 있다.**
- **T10 권고(→T01)**: `check.sh` 3단계 뒤에 `[4/4] build` 추가. 그래야 B0 성과가 게이트로 고정된다.
- **베이스라인**: main `37d1598` 에서 `npm run build --workspace app` → **exit 0, 21 라우트**(static `/login`·`/policyfund`·`/_not-found`, 나머지 dynamic). B0 는 이 상태를 **유지**해야 하며 개선 대상은 Vercel 설정 쪽.

### 6-A. vitest 정식화
- [ ] `vitest` 가 **실제로 쓰는 워크스페이스에 선언**되었는가 — 현재 루트 `package.json:23` 에만 `^2.1.9`, `app`/`worker` 는 **미선언**인데 각자 `vitest run` 을 실행(루트 호이스팅에 의존).
- [ ] 호이스팅 의존 제거 후에도 `npm run test --workspaces` 초록.
- [ ] 버전 단일화(워크스페이스 간 상이 버전 금지) · `package-lock.json` 동기 커밋.

### 6-B. Vercel 기본설정 빌드
- [ ] Vercel Install Command **오버라이드 제거** 상태에서 빌드 green (기본 `npm install`).
- [ ] Root Directory 설정과 워크스페이스 구조 정합 — root=`app/` 이면 app 의 `package.json` 만 해석되므로 **6-A 미선언이 곧 실패 원인**. root=repo 루트면 워크스페이스 설치로 해결.
- [ ] 빌드 로그에 **오버라이드 잔재 경고 없음**.
- [ ] `www.moa-work.com` 200 + 배포 커밋 SHA 가 main HEAD 와 **일치**(옛 배포 캐시를 초록으로 오인하지 말 것 — false-pass 재발 패턴).
- [ ] 프로덕션에서 §4 클릭스루 최소셋(가드/로그인/홈) 재확인 — **dev 초록 ≠ prod 초록**(RSC/정적생성/빌드타임 env 차이).

> **T10 검증 한계(명시)**: Vercel 대시보드 설정(Install Command·Root Directory·env)은 **저장소 밖**이라 코드로 확인 불가.
> 배포 로그·라이브 URL·SHA 대조로만 간접 판정한다. 설정 원본 확인은 T01 소관.

---

## 7. B1 (T03) — 앱 셸 v0.3 + 구글 OAuth + 실DB RLS 침투테스트

### 7-A. 앱 셸 v0.3 (1단 사이드바 10메뉴 · 브랜드 토큰 · 다크/라이트)
- [ ] 사이드바 **10메뉴 전부 렌더** + 각 링크 목적지 200/307(죽은 링크 0).
- [ ] **엔타이틀먼트 반영** — 비활성 기능 메뉴가 잠기는지. ※BUG-0001 이 정확히 이 지점에서 터졌다(신규 조직 `core.*` 전면 잠김). **신규 조직으로 생성한 계정**에서 반드시 재확인.
- [ ] 브랜드 토큰: 하드코딩 색상값이 아니라 **토큰 참조**인지(정의-사용 대조).
- [ ] 다크/라이트 **양방향 전환** + 토큰 일치 + 대비(가독성) 확인.
- [ ] **긍정 확인 필수**: "깨진 곳 없음"만 보지 말고 **메뉴 10개 이름·테마 전환 실제 반영**을 확인한다(BUG-0002 교훈 — 부정 조건만 보는 검사는 대상 부재 시에도 통과).

### 7-B. 구글 OAuth (§1-C 미검증 항목 해소)
- [ ] `/login` 에 **구글 OAuth 링크 존재**(현행 실측 **0개** — dev-session 뿐).
- [ ] 실제 로그인 → 콜백 → 세션 발급 → 홈 도달.
- [ ] 신규 사용자 → **온보딩 분기**, 기존 사용자 → 홈 직행.
- [ ] 로그아웃 시 세션 완전 만료.
- [ ] **dev-session 우회가 프로덕션에서 비활성**인지 ★보안 — 남아 있으면 인증 전면 무력화.
- [ ] 비밀값(client secret 등)이 저장소에 **없는지**(env 주입만).

### 7-C. 실DB RLS 침투테스트 ★최우선 · T03 공동 수행
대상: `001_schema_v1.sql` **`create policy` 32개 / RLS 활성 26 테이블**, 헬퍼 `is_org_member` · `org_role` · `org_scope`.

**원칙 — 앱을 우회해 DB 에 직접 붙어서 시험한다.** 앱 레이어 격리는 이미 통과했으나 그건 DB 정책의 증거가 아니다.
- [ ] **조직 격리**: 조직 A 세션(JWT `auth.uid()`)으로 조직 B 행 `select` → **0건**. `insert/update/delete` → **거부**.
- [ ] **담당범위(scope) 격리**: `member` 로 타인 담당 `companies`/`deals` 접근 → 목록 0건 + **단건 지정 조회도 0건**(ID 를 알아도 못 뚫는지).
- [ ] **역할 경계**: `orgs_update`/`orgs_delete` 는 `owner` 만 — `admin`·`member` 로 시도 → 거부. `members_manage` 동일.
- [ ] **전역 카탈로그**: 읽기 허용 / **쓰기 거부** 확인.
- [ ] **anon 키**: 미인증 상태로 각 테이블 접근 → 전부 거부.
- [ ] **⭐ 앱↔DB 규칙 정합 대조** — 앱에서 막히는 것과 DB 에서 막히는 것이 **같은 집합**인지. 불일치 시 **느슨한 쪽이 곧 우회 경로**다. 특히 `fielddefs_rw = is_org_member`(001:431)는 **member 도 필드 생성 가능**으로 앱과 일치하나, **그 정책 자체가 의도인지 기획 확인 필요**.
- [ ] **정책 커버리지**: RLS 활성 26테이블 중 정책 없는 테이블 = **전면 차단**인지(의도인지) 확인.

**판정 규칙**: 침투 1건이라도 성공 → **즉시 반려**. 부분 통과 없음.

---

## 부록. 현재 상태 스냅샷 (2026-07-21, 등록 시점)
- 스키마 v1(`001_schema_v1.sql`) 문법 검증 완료 — **런타임 RLS 행동은 Supabase 적용 후 침투 테스트로 확정(T03·T10)**.
- T02 crm 코어는 작업 트리에 산출(도메인 순수 계층 + API 라우트 + InMemory/PostgREST 어댑터), Auth/RLS 실연동은 T03 후속.
- 베이스라인 `check.sh` 초록 확인됨. parity·RLS 런타임 검증은 각 트랙 배포·Supabase 적용 시 착수.

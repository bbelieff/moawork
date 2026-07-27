# worklog

append-only 작업 로그. 최신 항목을 위에 추가한다. 한 항목 = 한 의미 있는 진행 단위.

---

## 2026-07-23 — MoaWork Control · OAuth 조직 프로비저닝 장애 수정 진행

- 프로덕션 Google 로그인 후 `login?error=provisioning`을 재현하고 Supabase Auth·REST·Postgres 로그와 정책·트리거 상태를 읽기 전용으로 대조했다.
- OAuth와 사용자 upsert는 성공했으나 `POST /orgs?select=id`가 `42501`로 롤백되는 것을 확인했다. INSERT 정책이나 owner 트리거 부재가 아니라, `insert().select()`의 RETURNING 행이 owner 멤버십 생성 전에 SELECT RLS를 평가하는 실행 순서 충돌이었다.
- 조직 UUID를 애플리케이션에서 먼저 생성하고 표현 응답 없이 삽입하도록 콜백을 수정했다. RLS와 owner 자동생성 트리거는 그대로 유지했다.
- 회귀 테스트 1건을 추가했다. `scripts/check.sh` PASS(app 472 passed / 5 skipped, worker 14 passed), Next.js 프로덕션 빌드 PASS를 확인했다.
- PR·GitHub 체크·Vercel Production 배포와 동일 계정 재로그인은 아직 진행 중이며, 운영 완료로 과장하지 않는다.

## 2026-07-23 — MoaWork Control · 루트 AGENTS 지침 정합화

- 최신 GitHub `main`을 다시 대조해 `c1e8ffd`(PR #15 병합), 열린 PR 0건을 확인했다. 로컬 canonical `main`은 `e774a45`로 1커밋 뒤라 공유 checkout을 갱신·수정하지 않고 최신 `origin/main` 기반 독립 문서 worktree를 만들었다.
- 루트 `AGENTS.md`가 폐기된 `session-registry.yaml`·`dispatch-queue.yaml` 사용을 요구하는 documentation drift를 확인했다.
- `AGENTS.md`를 최신 Markdown ROUND 정본 규칙, T01~T10 역사 식별자, 필요 시 생성하는 범용 DEV-1~3, 독립 T10, 단일 writer·file lease, `wip/*` 보존, 코드·운영 완료 분리 검증 체계로 정합화했다.
- controller·writer·lease·OAuth 운영 검증 잔여 상태는 `docs/coordination/sync/ROUND-3.md`에 기록했다.
- 비밀값은 기록하지 않았다. `scripts/check.sh` PASS(app 471 passed / 5 skipped, worker 14 passed)와 의도한 3파일만 변경·문서 삭제 0건을 확인했다.
- PR [#16](https://github.com/bbelieff/moawork/pull/16): GitHub CI·GitGuardian·Vercel Preview·Preview Comments 전부 PASS, mergeable. T10 문서 게이트 `PASS / MERGE AUTHORIZED`; 병합 후 이 작업을 END로 닫는다.

## 2026-07-23 — Codex-Failover-Control · Claude 소진 인수 START

- belie가 Claude 주간 사용량 소진과 Codex 인수를 명시 승인했다.
- GitHub main `613cc67`, 열린 PR 0건, `origin/wip/t03-oauth` 존재를 다시 실측했다.
- 기존 `서울리드프로젝트/모아워크`는 원격·커밋 없는 기획 작업본으로 보존하고, 새 `moawork-canonical` 클론을 사용한다.
- 활성 writer는 `Codex-T03-OAuth` 하나로 제한한다. 보존 WIP에서 새 Codex 전용 worktree로 승격하고 T10 검증 후 PR·배포한다.
- 상세 controller·writer·file lease·수용기준은 `docs/coordination/sync/ROUND-2.md`가 정본이다.

## 2026-07-23 — Codex-T03-OAuth · B1b 구현 및 로컬 T10 게이트 PASS

- Claude 보존 브랜치 `origin/wip/t03-oauth`를 최신 main 위의 격리 브랜치 `feat/codex-t03-oauth`로 승격하고, 선언되지 않은 TanStack provider·Tailwind 설정은 최종 범위에서 제외했다.
- `@supabase/ssr` 기반 브라우저/서버/Proxy 세션, Google 1차 CTA, PKCE 콜백, 로그아웃을 배선했다. 콜백은 `public.users` 프로필을 보강하고 `app_admin_role()` 결과가 있는 최초 계정에 owner 조직을 재시도 안전하게 만든다.
- 세션 구현은 Supabase 환경에서 `auth.getUser()`와 실제 `org_members`만 신뢰한다. 운영에서는 dev-session 버튼과 `?as=` 역할 오버라이드를 렌더·적용하지 않으며, Supabase 환경변수 누락 시 비공개 경로를 fail-closed 처리한다.
- 오픈 리다이렉트 방어 테스트를 추가했다. 비밀값은 커밋하지 않았고 환경변수 이름만 사용한다.
- 로컬 T10: `scripts/check.sh` PASS — app **471 passed / 5 skipped**(실DB 자격증명 없는 RLS 침투), worker **14 passed**. Next 16 프로덕션 빌드 PASS(22 static page generation, 전 라우트 수집).
- 프로덕션 서버 렌더 실측: `/login` 200, Google CTA=true, 개발 계정 라벨=false, 데모 이메일=false. Supabase env 없는 비공개 `/?as=owner`는 `/login?error=config` 307로 차단.
- 잔여: PR 검수·main 머지·Vercel 배포 뒤 실제 Google 계정 선택→콜백→owner/플랫폼관리자 세션을 라이브 판정해야 최종 완료다.
- PR [#15](https://github.com/bbelieff/moawork/pull/15) 생성. GitHub CI·GitGuardian·Vercel Preview 전 체크 PASS, mergeable. T10 브랜치 후보 판정은 `docs/coordination/T10-gate-checklist.md` §11에 기록했다.

## 2026-07-22 — T05 · B3 상태컬럼 UI · board_views CRUD · 003 검증엔진 단일화

브랜치 `feat/t05-b3-status-views` (base=main `14a1c91`). check.sh 초록 — 앱 **338** 테스트(+29).

**지시 문서 부재**: 배정이 가리킨 `docs/coordination/next-prompt_B2-B7.md` 가 **전 ref·전 워킹트리·디스크 어디에도 없음**(DQ-0011 때 003/T02b 지침 부재와 동일 패턴). 지시 메시지의 요약을 스펙으로 삼아 진행했고, 요약의 전제 2건을 실측으로 정정했다:
- ❗ **"004 스키마의 board_views"** → 004 마이그레이션은 **존재하지 않음**. `board_views` 는 **003_boards_engine.sql:73** 에 이미 있고 main 에 랜딩됨. 새 마이그레이션 없이 003 위에 구현(스키마 무변경).
- ❗ **"status 컬럼"** → 001 `field_type` enum 13종에 `status` 는 **없다**. 먼데이 상태 컬럼 = `select`/`multiselect` 를 **색 칩으로 렌더**하는 표현 문제이며 색 출처는 `FieldOption.color`. 스키마 변경 불필요.

**(1) 003 통합 followup — 검증 엔진 단일화** (기획2 판정 이행)
- `lib/boards/cells.ts` 를 자체 구현 → **T05 레지스트리(`lib/custom/field-types`) 위임 어댑터**로 전환. 2중 구현 제거.
- 구 `normalizeCellValue`/`validateAgainstOptions` **제거** — 형식 오류를 조용히 null 로 수렴시켜(데이터 유실) 관대 정책과 배치. 대체 = `validateCell() → {ok, value, error}`.
- 위임 과정에서 **엔진 쪽 실제 결함 2건**을 발견해 엔진에서 교정(보드 파리티 복원 + 커스텀필드도 동시 수혜):
  - `number` 가 `"1,200,000"`·`"₩1,200,000"` 을 거부 → 천단위/통화기호 허용.
  - `date` 가 입력을 10자로 잘라 ISO 일시(`2026-08-01T00:00:00Z`)를 형식오류로 처리 → ISO 날짜부 수용. **달력 검증은 유지**(`2026-02-30`·`2026-13-01` 은 계속 거부 — 구 boards 는 롤오버로 통과시켜 잘못된 날짜를 저장했다).

**(2) setValues 검증 훅 — 관대+인라인 / 무결성 엄격**
- `BoardsService.validateValues()` 가 쓰기 경로 단일 관문. 통과분만 저장, 실패분은 `errors[]` 로 반환(throw 아님). 한 셀이 틀려도 **나머지는 저장**되고 **기존 값은 null 로 덮이지 않는다**.
- 예외: `isIntegrityField`(exec_amount·fee_pct·fee_paid_at)는 정산 generated column 의존 → 하드 거부(throw).
- `setCells` 반환이 `ItemWithValues` → `{item, errors}` 로 변경(인라인 피드백 지면 확보).

**(3) status 컬럼 UI**
- `lib/boards/status-palette.ts` — 옵션 색 해석(지정색 우선 → id 해시 기반 **결정적** 팔레트 배정), hex 정규화, WCAG 명암비/글자색 선택, 더미 상태 옵션(시드 확정 시 더미만 제거).
- `components/boards/StatusCell.tsx` — `StatusPill`/`StatusCell`(읽기, 고아 값은 회색 칩+id 노출로 가시화)·`StatusSelect`(편집, 선택 색을 컨트롤에 적용). `GenericBoardTable` 배선.
- **접근성 실측 교정**: 칩은 작은 텍스트라 AA 4.5:1 필요. 먼데이 원색 red/blue/purple/teal 은 흰·검 **어느 글자색으로도 4.5 미달**(최대 ~4.1)이라 hue 유지한 채 어둡게 조정. 명암비 property 테스트가 회귀를 잡는다.

**(4) board_views CRUD API** (003 기반, 마이그레이션 없음)
- 포트에 `getView`/`updateView` + `ViewPatch` 추가(전용 BoardsRepo 포트 — T03 공용계약 `lib/repo/index.ts` 무변경), local 어댑터 구현.
- 서비스: `listViews`/`getDefaultView`/`createView`/`updateView`/`deleteView`.
- 기본 뷰는 T05 `pickDefaultView` **재사용**(2중 구현 금지) — shared 우선 → name ASC → id ASC (기획2 OQ-4 재판정).
- 라우트: `GET|POST /api/boards/[boardId]/views` (`?default=1`), `PATCH|DELETE /api/board-views/[viewId]`. `lib/boards/http.ts` 로 boards 에러→상태코드 매핑(400/401/404/409).

**⛔ 미착수 — 하위아이템(subitems): 스키마 부재로 차단**
003 `items` 에 `parent_item_id` 가 **없다**(전문 확인). 하위아이템은 마이그레이션이 필요한데 ADR-0002 규칙상 **스키마 정본은 기획 세션이 단독 작성**하므로 T05 가 쓰지 않는다. → `DQ-0013` 으로 기획에 요청 등록. 나머지 3건은 스키마 무변경으로 완료.

## 2026-07-21 — T03 · B1 앱 셸 v0.3 + 브랜드 토큰 + 관리자 자동부여(4b) + RLS 침투테스트 하네스

브랜치 `feat/t03-shell-auth` (격리 worktree). check.sh 초록 + `next build` 성공.

**입력 자산 실측**: 지시서가 가리킨 `docs/design/UI목업_모아워크셸_v0.3.html`·`brand/assets/...` 는
앱 레포(전 브랜치)에 **없었고**, 기획 워크스페이스
`C:/Users/belie/Desktop/Belief/서울리드프로젝트/` 에 존재했다(remote 없는 별도 로컬 레포,
`chore/day0-harness`). 거기서 **무수정 복사**해 앱 레포로 반입.

- **디자인 토큰**: `design-tokens.md §1` 정본을 `app/src/app/globals.css` 에 투입(`--mw-*`).
  원본 `moawork-color-tokens.css` 는 `app/src/styles/` 에 사본 보존(동기화 대상).
  컴포넌트는 hex 하드코딩 0 — 전부 `var(--mw-*)` 참조. Tailwind `@theme inline` 매핑 추가.
- **로고**: 락업/심볼 light·dark SVG → `app/public/brand/`, 파비콘·PWA 아이콘 → `app/public/icons/`.
  `components/brand/Logo.tsx` 의 `Logo`/`Symbol` 이 CSS(.mw-only-light/dark)로 테마 자동 전환
  (JS 리렌더 없음). 최소너비 규칙(락업 120px·심볼 16px) 반영.
- **제품명**: `PRODUCT_NAME` = **"MoaWork"** (design-tokens §5 / O1·DI-2 확정, 기존 "모아워크" 교체).
- **앱 셸**: `(app)/layout.tsx` 1단 사이드바 232px(11메뉴, 목업 IA 1:1) + 상단바(검색·알림·다크토글).
  메뉴 잠금은 **서버 엔타이틀먼트 판정**을 사이드바로 내려 표시. 라우트 없는 메뉴는 "준비 중"
  비활성(타 트랙 화면 침범 금지).
- **다크/라이트**: `data-theme` + `prefers-color-scheme`. root layout 인라인 스크립트로 FOUC 차단,
  `ThemeToggle` 은 `useSyncExternalStore` 로 DOM·미디어쿼리를 구독(state 복제 없음 →
  OS 테마 변경도 즉시 반영).
- **4b 관리자 자동부여**: `lib/auth/admin.ts` — `resolveAdminGrant(email, rpc?)`.
  실DB 의 `app_admin_role()` RPC 가 있으면 우선, 없으면 005 seed 와 동일한 폴백 allowlist.
  RPC 가 명시적 null 이면 폴백으로 뒤집지 않는다(권한상승 방지), RPC 실패는 폴백(로그인 유지).
  `Ctx.isPlatformAdmin` 추가(선택 필드, additive). 테스트 15건.
- **RLS 침투테스트**: `lib/auth/rls-penetration.test.ts` — 조직A→조직B의 companies/deals/orgs
  SELECT=0건 + member/assigned 본인 담당만. **fetch 로 PostgREST 직접 호출**(supabase-js 는
  어느 워크스페이스에도 선언 안 된 팬텀 의존성이라 회피). 크리덴셜 없으면 skip.
- **마이그레이션 동기화**: `004_gaps_and_leadin.sql`·`005_app_admins.sql` 반입(무수정).
  앱 레포에 없어 4b 근거가 비어 있었음.

**미완(정직 보고)**
- 수용기준 "다른 조직 데이터 절대 안 보임(실DB RLS)" — **미검증**. 크리덴셜 부재로 테스트가 skip.
  → `docs/coordination/decision-inbox.md` DI-A2 로 요청.
- 구글 OAuth 실동작 — Google Cloud 클라이언트·redirect 등록이 belie 액션(DI-A1). 코드는 dev-session 폴백 유지.
- **런타임 클릭스루 미실행** — `preview_start` 가 세션 cwd(메인 워킹트리, 타 트랙 브랜치)를 잡아
  내 브랜치를 띄우지 못했고 3000 포트도 타 트랙 점유. 대신 `next build` 성공으로 라우트·RSC·
  클라이언트 경계까지 검증. **완료 판정은 T10 클릭스루 스모크 이후.**
- Vercel 배포 반영 — main 머지 후.


## 2026-07-21 — T01 · B0 Vercel 워크어라운드 회수 (Install Command 오버라이드 제거·정식화)

- **원인 규명**: `app/tsconfig.json` 의 `include: ["**/*.ts"]` 가 `app/vitest.config.ts` 를 타입체크
  대상에 포함하는데, 그 파일이 `vitest/config` 를 import 함. 그런데 `vitest` 는 **루트 devDeps 에만**
  있고 app 워크스페이스에는 선언되어 있지 않았음 → app 을 단독 설치하는 Vercel 빌드에서 모듈
  해석 실패 → 임시로 Install Command 오버라이드
  (`npm install --prefix=.. && npm install --no-save -D vitest`) 를 넣어 우회하던 상태.
- **조치 = (A)안 채택**: `app/package.json` devDependencies 에 `"vitest": "^2.1.9"` 추가.
  루트와 **동일 스펙**이라 npm 이 단일 버전(2.1.9)으로 dedupe — 중복 설치 없음(설치 패키지 수 불변 422).
  (B)안(tsconfig 에서 `vitest.config.ts` exclude)은 설정 파일을 타입검사에서 빼는 회피책이라 미채택 —
  vitest.config.ts 를 계속 타입 보호 대상으로 유지하는 편이 정식화에 부합.
- **검증**:
  - `bash scripts/check.sh` **초록** — lint + typecheck + test(app 309/23파일, worker 1).
  - **Vercel 상황 재현**(핵심): app 트리를 워크스페이스 루트 없이 복사 → 오버라이드 **없이**
    기본 `npm install`(396 패키지) → `npm run typecheck` **exit 0** → `npm run build`
    **exit 0(21 라우트)**. 즉 기본 Install Command 로 빌드 green 이 성립함을 로컬에서 확인.
- **경계 준수**: app 워크스페이스만 수정. `worker/`·`supabase/` 무수정(diff 로 확인).
  루트 `package-lock.json` 은 워크스페이스 공용 lockfile 이라 함께 갱신됨(app→vitest 기록).
- **남은 것(레포 밖 · 디스패치/Cowork 소관)**: Vercel Project Settings → Build →
  **Install Command 오버라이드 삭제 후 기본값 복귀**. 이 커밋이 main 에 머지된 **뒤에** 해제해야
  안전(먼저 지우면 머지 전까지 빌드 실패). 이후 기본설정 빌드 green + www.moa-work.com 정상 확인.
- 브랜치 `feat/t01-vercel-install-fix` — main 직행 없이 **T10 검수 대기**(다중 세션 규칙).

## 2026-07-22 — T07 · B5 KPI 리더보드 + 이달의 계약회사 (집계·위젯 선구현)

- 브랜치 `feat/t07-perf-leaderboard-b5` (base `cdf45f6`). DQ-0017.
- **집계 엔진**(`app/src/lib/perf/aggregate.ts`, 순수 함수 · I/O 없음)
  - 귀속월 = `settlements.fee_paid_at`(수납일). `fee_paid_at=null` 인 **미실현 정산은 제외**(설계 §2.1).
  - 담당자 귀속 = `settlement.deal_id → deal.assigned_to`. 담당자/딜이 없는 건은 **미배정 버킷**으로 모아 순위에서 제외하되 조직 합계에는 포함.
  - 지표: 수납건수 · 실행액 합계(`exec_amount`) · 수수료 합계(`fee_amount`). `fee_amount` 는 001 generated column(이미 round)이라 **앱에서 재반올림하지 않는다**.
  - 순위: 동점은 순위 공유 후 건너뜀(1,2,2,4). tie-break = 수수료 → 실행액 → 건수 → 이름.
  - 이달의 계약회사: 같은 모집단을 `deal.company_id` 로 묶어 수수료 내림차순, 1위를 `top` 으로. 고객사 미연결 건도 별도 행으로 보존(합계 정합).
  - 월 경계(`monthRangeKst`)·구간 판정(`inRange`)은 **T04 core.dash 헬퍼 재사용** — 대시보드와 "이번 달"이 어긋나지 않도록 재작성 금지.
- **조립 계층**(`lib/perf/service.ts`): `@/lib/repo` 포트만 의존. 표시명은 전역 `listUsers()` 가 아니라 `listMembers(orgId)` 를 거쳐 조회(타 조직 사용자 유출 방지).
- **위젯**(`app/src/components/dashboard/perf-widgets.tsx`, 프레젠테이션 전용): `LeaderboardWidget`, `MonthlyContractCompanyWidget`. 0건이면 '—'/빈 상태(NaN·빈화면 금지). 포맷터·컨테이너는 T04 `@/lib/dash/format`·`Widget` 재사용.
- 검증: perf 24 테스트 신규(집계 16 + 서비스 8). `bash scripts/check.sh` 초록 — app 333 통과(25 파일) · worker 1 통과.
- **배선 상태**: 화면 라우트에 아직 연결하지 않았다. `getRepo()` 구현체가 현재 LocalRepo(인메모리)이므로, **B2 가 Supabase 어댑터로 교체하면 service 코드 수정 없이 실 DB 로 전환**된다(어댑터 스왑). 정렬 토글·월 선택기 UI 는 배선 시 추가.
- 지시문서 `docs/coordination/next-prompt_B2-B7.md` 는 **전 브랜치·전 히스토리에서 발견되지 않았다**(T09 RQ-0009 와 동일 관측). 프롬프트 요약본을 근거로 착수했다.
- ⚠ 위젯 경로가 지시대로 `components/dashboard/` 라 T04 의 `components/dash/` 와 이원화됐다. 통합 여부 T10 판정 요망.
- 남은 DQ-0007 범위(인센티브 규칙 평가 · `performance_snapshots` 영속화 · 활동량)는 설계 §6 정책결정 4건 확정 후 진행.

## 2026-07-21 — T02 · B2 core.crm Supabase 소스 + 단계 보드 3종 라우트 (PR #9)

- 브랜치 `feat/t02-crm-supabase` (main 4367015 기반 — 지시된 cdf45f6 은 그 조상이라 최신 main 사용).
- **배정 지시서 부재 보고**: `docs/coordination/next-prompt_B2-B7.md` 가 전 ref·워킹트리에 없다.
  프롬프트 본문 요약 + 정본(001/002)만으로 착수 — 스키마 추측은 하지 않았다.
- **Supabase 실연결** `lib/repo/supabase/`: 환경변수 클라이언트(미설정 시 null·로컬 폴백) +
  001 테이블 직결 `SupabaseCrmSource` + `getCrmSource()` 팩토리. 담당범위를 쿼리단에 이식.
- **설계 판단**: 공용 `Repo` 는 **동기**라 네트워크 DB 구현 불가. 계약 파일은 T03 단독 소유이므로
  별도 **비동기 포트 `CrmSource`** 를 두고 시그니처를 1:1 로 맞췄다(Promise 래핑만 차이).
  → T03 판단 요청: 공용 포트 비동기 전환 여부(전환 시 단일 선행 PR).
- **보드 = stage_kind 필터 뷰**(새 테이블 없음): `stageBoards.ts`/`boardData.ts` +
  `(app)/{newcust,contract,work}` + `StageBoardView`.
- ⚠️ **명명 확인 요청**: 지시서의 `/contract`="컨텍관리" 인데 002 시드상 컨텍관리=kind `meeting`,
  `contract` kind 는 별개 단계(계약). 보드 **이름**을 정본으로 보고 meeting 에 묶음(한 줄로 교체 가능).
- 게이트: `check.sh` 초록(앱 337 테스트·신규 28 + 워커 1), `next build` 로 3개 라우트 등록 확인, 회귀 0.
- 한계(후속): 딜 상세 `/deals/[id]` 미구현이라 카드 링크를 걸지 않음(404 방지) · 드래그 이동 미포함 ·
  Supabase 실계정 스모크 미실시(환경변수 부재).

## 2026-07-21 — T06 · worker Phase 2 알림 발송 스캐폴드(스텁)

- 배정: B2-B7 배치의 T06 파트(worker Phase 2 스캐폴드). ⚠️ 지시된 `docs/coordination/next-prompt_B2-B7.md` 는 **저장소 전 ref·워킹트리·히스토리 어디에도 부재** — 지어내지 않고 배정 프롬프트의 요약(잡 스텁 / 발송 인터페이스 / 독립 작업)만을 근거로 착수. DQ-0011·DQ-0014 와 동일 패턴이라 dispatch 에 보고.
- 산출물 `worker/src/notify/`:
  - `types.ts` — 채널·`NotifyMessage`·`SendResult`(+`sendOk`/`sendFailed`). 정본 `message_channel`(alimtalk/sms)과 배정이 요구한 email 을 **구분**해 타입화(`isSchemaChannel`).
  - `provider.ts` — `NotificationProvider` 포트(이메일/SMS/알림톡 공통) + `resolveProvider`, 영속성 포트 `MessageLoader`/`MessageStatusSink`.
  - `providers/stub.ts` — `StubProvider`(무해·비발송). 벤더 미정(DI-5)이라 실 구현체 없음.
  - `job.ts` — 큐명 `notify.send`, 페이로드 검증(`isNotifySendJobData`), `processNotifyJob`. **재시도 의미론**: 일시 오류=throw(pg-boss 재시도), 영구 오류=failed 종결.
  - `register.ts` — `createQueue`(retryLimit 3·backoff) + `work` 등록. **pg-boss v10 확인 반영**: 핸들러가 잡 **배열(batch)** 을 받고 `createQueue` 가 필수(v9 암묵 생성 없음).
  - `pending.ts` — 미구현 DB 어댑터. 로더가 항상 null → 잡이 들어와도 **실발송 0건**(오발송 원천 차단).
- `worker/src/index.ts` 의 `TODO(후속 트랙)` 자리에 `registerNotifyWorker` 배선.
- 검증: `bash scripts/check.sh` **초록** (app 309 / worker 14 — notify 13 신규), 부팅 스모크(골격 모드) 정상, `npm run build`(tsc) 성공.
- 경계: 스키마 마이그레이션·앱 API·벤더 구현 **미포함**(Phase 2). 기존 파일 수정은 `worker/src/index.ts` 배선 1곳뿐.
- 브랜치: 지시된 `cdf45f6` 기반으로 시작했으나, main 이 그 뒤 `docs/worklog.md` 를 변경(T10 판정이력 150줄 복구)해 머지 충돌이 T10 복구분을 훼손할 위험 → **origin/main 으로 리베이스**(delta 는 docs 전용, 코드 영향 0).
- 후속: 벤더 확정 시 `providers/solapi.ts` 추가 · `pending.ts` → Supabase 어댑터 교체 · entitlement 게이트 · T02 단계이동 트리거 구독.
## 2026-07-21 — T09 · B4 정산 모듈 + /api/settlements (부분 완료 · G8 차단 보고)

- 브랜치: `feat/t09-settlements` (base = `origin/main` 4367015).
- **산출물**
  - `app/src/lib/policyfund/settlements.ts` — 정산 업무로직. 검증(`parseCreateSettlement`/`parseUpdateSettlement`) + 서비스(`SettlementsService`, repo 포트 소비) + 집계(`summarize`/`dueBy`).
  - `app/src/app/api/settlements/route.ts` — GET(목록+집계, `?dealId=` 필터) / POST(생성 201).
  - `app/src/app/api/settlements/[settlementId]/route.ts` — GET / PATCH / DELETE. 미가시 리소스는 404 로 수렴(존재 유출 방지).
  - `settlements.test.ts` 18 테스트. 게이트 초록(app 360 / worker 1).
- **정산 필드**: `exec_amount` · `fee_pct` · `fee_paid_at` · `down_payment` — 지시대로 4종 처리. 키 상수는 `POLICYFUND_FIELD_KEYS`(T04 소유 `lib/dash/aggregate.ts`) **참조만**, 편집 없음.
- **파생값 정책**: `fee_amount`·`total_revenue`·`d180`·`d365` 는 001 generated column = 읽기 전용. 입력에 섞이면 **400 거절**. 집계는 저장된 파생값을 그대로 합산(재계산 금지 = SSOT 유지). `localRepo.derive` 산식이 `settlement.ts`(002_seed formulas 확정본)와 1:1 일치함을 실측 확인.
- **⚠ 차단 보고 — G8 상태→그룹 자동이동 미착수 (근거 부재)**
  1. 지시 문서 `docs/coordination/next-prompt_B2-B7.md` 가 **워킹트리·전 브랜치 히스토리 어디에도 없음** → T09 파트 원문 확인 불가.
  2. **`004` 마이그레이션 없음**(0001/001/002/003 까지). `board_automation_rules` 테이블은 **전 브랜치 grep 0건** → 자동이동 규칙의 스키마 근거 부재.
  3. **11개 그룹(준비→진행→심사→승인→관리→불가) 목록이 SSOT 에 없음.** `003` 의 `board_groups` 는 빈 테이블 정의(name/color/sort_order)일 뿐이고, `002_seed` 의 "업무관리" 키는 **컬럼 31종** 목록이지 그룹 목록이 아님.
  → 테이블 형태를 모른 채 구현하면 004 확정 시 전량 재작성이므로 착수하지 않음. **004 스키마 + 11그룹 SSOT 확정 후 재개**.
- 참고: 지시된 base `cdf45f6` 는 현재 main tip(`4367015`)의 **조상**이며 그 사이 4커밋은 전부 T10 문서(코드 델타 0). 코드 동일 + T10 B0·B1 검수 기준 문서 포함을 위해 main tip 에서 분기함.
- 다음: PR → T10 검수. G8 은 근거 확정 시 별건 착수.

## 2026-07-21 — T10 · 머지큐 전 단계 main 런타임 스모크 완료 · 최종 판정

- **결과**: 머지큐 ①T03 → ③T02보드엔진 → ④T04 → ⑤T05 **전 단계 main 스모크 통과**. 최종 main `cdf45f6`, 게이트 초록(app 309테스트/23파일), 스모크 **PASS=20 FAIL=0 SKIP=0**.
- **판정 원칙**(기획2): *브랜치 승인 ≠ main 승인. "완료"는 main 스모크 초록일 때만.* 매 머지 직후 `main` 에서 `npm run dev` 클릭스루 재검증.
- **스모크 이력**: 베이스라인 3 → ①11 → ③15 → ④17(**FAIL 1**) → ④fix 19 → ⑤**20**. 검사 항목이 라운드마다 증가.
- **잡은 결함 2건 — 둘 다 게이트·CI 초록 상태에서 파손**:
  - **BUG-0001**(반려): `createOrg` 가 MVP 엔타이틀먼트를 만들지 않아 **신규 조직에서 core.* 전면 잠김** → 온보딩 흐름 A 종착점 파손. 시드 조직만 엔타이틀먼트를 가져 가려져 있었다. T03 핫픽스(`ee57b0c`)로 해소.
  - **BUG-0002**: 프리셋 `key:"contract_status"` vs 위젯 `fieldKey:"계약상황"`(라벨을 key 로 사용) 불일치로 **계약상황 위젯이 조용히 영구 빈 상태**. 단위테스트가 실제 프리셋 대신 자기 픽스처를 지어내 검증해 CI 가 초록이었다. T04 핫픽스(`d8394bf`)로 해소 — key 통일 + `POLICYFUND_FIELD_KEYS` 상수 공유 + 픽스처 교정.
- **확정된 검증**: 미인증 가드 4라우트 · **담당범위 격리**(API 4 + 칸반 2, member 는 타인 담당 딜 목록·**단건조회(404)** 모두 차단) · 조직 격리 · 집계 정확성(단계별·전환율·금액이 원천과 일치, **집계도 담당범위 반영**) · 빈 상태 0분모 방어 · 프리셋 전개 · 서버 에러 0건.
- **산출물**: `scripts/smoke.sh`(20항목 자동 검증, 종료코드 판정) · `docs/coordination/T10-gate-checklist.md`(판정 이력 + 기준 + 검증 방법론).
- **⛔ MVP 완료판정 잔여 4건**(스모크로 덮을 수 없음): ① **Postgres RLS 33정책 런타임 침투테스트**(현재 격리는 전부 앱 레이어 — Supabase 적용 후 앱↔DB 규칙 일치 대조 필수) ② 구글 OAuth 실동작(현재 dev-session) ③ 정산 수식 parity(금액이 `deal.amount` 근사, "임시" 표기) ④ 파일첨부 Storage org 격리.
- **방법론 원칙**: *부정 조건(없음/0건)만 보는 검사는 대상이 존재하지 않을 때도 통과한다 — 긍정 조건(실제 렌더/인식/동작)을 함께 확인할 것.* BUG-0001·0002 가 모두 이 위반이었다. 병렬 워크트리 환경에서는 **포트 선점(오통과)** 과 **빌드캐시 잔재(오실패)** 도 함께 통제해야 한다(`smoke.sh` 에 가드 내장).

## 2026-07-21 — T05 · 기획2 판정 반영(비-throw 계약 · 값 정책 · 정본 키맵) · 003 은 followup

- **엔진 계약 변경**: `validateValue(type, raw, ctx) → {ok, normalized, error?}` **추가 — 던지지 않는다**. 던질지 흘릴지는 호출부(정책)가 결정. 기존 `normalize()`(throw)는 엄격 호출부용으로 유지(추가만, breaking 없음).
- **값 정책 = 관대 + 인라인 피드백**(`applyValues()`, PUT 라우트 기본 경로): 유효값만 저장, 무효값은 **저장하지 않고** `errors[key]` 로 사유 반환(기존 값 보존) → UI 인라인 표시. **⛔ 조용한 null 수렴 금지**(T02b 현행 방식 기각). 응답 `{ok,values,errors}`, errors 있어도 200.
- **무결성 필드만 엄격**: `exec_amount`·`fee_pct`·`fee_paid_at` → 하드 거부(400). 근거: 001 settlements generated column(fee_amount/total_revenue/d180/d365)이 의존 → 틀린 값이 조용히 잘못된 금액·일자를 만든다.
- **정본 키맵 대응**: `createField({key})` 로 정본 key 명시 지원(생략 시에만 label 파생). 명시 key 중복은 **거부**(조용히 `_2` 붙이면 정본과 어긋남). 확인 결과 `presets/policyfund.ts` 는 이미 ASCII key 사용 중이라 위반 없음 — 본 변경은 그 경로가 서비스를 타도 정본 key 가 보존되게 하는 것. `deriveKey` 는 사용자 생성 필드에만 적용(사용자 데이터, 코드 조회 key 아님).
- 테스트 +10 (custom 75→**85**): 무효값 미저장·기존값 보존·무결성 필드 throw·ok=true 경로·정본 key 사용·중복 key 거부·validateValue 비-throw 4종.
- **003 통합은 followup PR 로 분리**: `cells.ts` 위임 + `boardsRepo.setValues` 검증 훅은 **T02b 머지 모듈 수정 + 003 동작 변경**이라 리뷰 단위를 분리(T02b·T09 영향). 범위는 설계 §13.4 에 확정 기록.
- PR #5 는 이 커밋 포함해 **머지 가능** 판정(게이트 초록).

## 2026-07-21 — T05 · 머지큐 ⑤ 정합 실행 (rebase + repo/API 배선) · 003 이중화 발견

- **rebase**: 4커밋 squash → `origin/main`(da7dce0) 위 1커밋. 충돌은 `worklog`·`dispatch-queue` 2건뿐, **코드 충돌 0**(신규 디렉터리). worklog 양측 보존, queue 는 최신 항목 채택 + T02 `resolved:` 주석 보존.
- **정합 완료**:
  - `domain-types.ts` vendor → **`@/lib/types` 재export** 전환(형태 완전 동일 확인 후, 모듈 내 import 경로 불변으로 9파일 무수정).
  - **`Repo` 포트 확장** — 커스텀필드 스텁 2개 → 전 표면(정의 get/update/reorder/delete+값프루닝, 값 get/set, 저장뷰 CRUD+공유∪개인 가시성) + `FieldDefPatch`/`SavedViewPatch`. `LocalRepo` 구현(스토어 배열은 T03 이 마련해 둔 것 사용, 스토어 무변경).
  - **`RepoCustomStore`** 어댑터 + `getCustomService()` — 운영은 공용 Repo, 테스트는 InMemory 유지.
  - **API 5 라우트**: /api/fields(+[fieldId]), /api/custom-views(+[viewId], ?default=1), /api/entities/[entityId]/values. 수정판 Next 규약(params=Promise) 준수.
  - `custom/http.ts` 별도 — crm 의 toErrorResponse 는 crm ValidationError 만 400 매핑해서 core.custom 에러가 500 이 되는 문제 회피. 세션은 T03 `@/lib/auth/session` 직접 사용.
  - `repo-store.test.ts` 6종(값 정규화 round-trip·옵션 id 검증·org 격리·삭제 프루닝·뷰 가시성/기본뷰·config 왕복). custom 69→**75**.
- **게이트**: `check.sh` 초록 — 앱 **287→** (전 트랙 통합) 통과, 타 트랙 무영향.
- ⚠️ **003 어댑터 미착수(의도) — 판정 요망**: T02b `boards/cells.ts` 가 동일 성격 엔진을 병행 구현(해당 파일이 스스로 "머지 정착 후 공용화" followup 명시). 어댑터를 얹으면 **3중 구현**이라 중단하고 통합안 제시(설계 §12.2). 두 엔진 의미가 실제로 다름 — T05=엄격(throw), T02b=관용(null 수렴); 특히 **`date` 가 정규식만 통과해 "2026-02-30"·"2026-13-01" 이 그대로 저장**되고, `boardsRepo.setValues` 는 타입·옵션 대조 없이 raw 기록. 정산(D+180/365)·대시보드가 이를 소비하면 조용히 틀린 결과. 권고=(가) 엄격 통일(cells.ts 를 T05 레지스트리에 위임). 타 트랙 머지 모듈이라 단독 수정하지 않고 판정 대기.

## 2026-07-21 — T05 · OQ-4(기본 뷰) 규약 확정·구현 — 마지막 미결 해소

- **경위**: 1차 판정 "기본 뷰 = `created_at` ASC" 를 구현하려 스키마 실측 → **`created_at` 이 001 `saved_views`·003 `board_views` 양쪽 모두 부재**(001 은 다른 8개 테이블에, 003 은 `boards`/`items` 에만 있음 — 두 뷰 테이블만 누락). `id` 는 `gen_random_uuid()`(v4 랜덤)이라 생성순 대용 불가 → "created_at ASC + 마이그레이션 없음" 양립 불가를 보고하고 선택지 3안 제시. **재판정으로 (C) 채택**.
- **확정 규약**: `pickDefaultView()` — **shared 우선 → name ASC → id ASC(tie-break)**. 마이그레이션 없음.
  - `sort_order` 미사용 — 사용자 재정렬 시 기본이 바뀌지 않도록(판정 의도).
  - 이름 비교는 로케일 비의존 코드유닛 순서 — 기본 뷰 선택은 표시 정렬과 달리 ICU 버전에 흔들리면 안 되므로 **결정성 우선**.
  - 후보 타입 `DefaultViewCandidate{id,name,shared}` → 001 `saved_views` 와 003 `board_views` 가 둘 다 만족(구조적 타이핑) → **두 표면이 같은 함수 공유**.
- **구현**: `views.ts` 에 `pickDefaultView()`/`compareDefaultView()`, `service.ts` 에 `getDefaultView(orgId,userId,entity)`, `index.ts` export. **테스트 7종 추가**(빈 목록·shared 우선·name ASC·id tie-break·입력순서 무관(결정성)·sort_order 무시·003 board_views 형태 적용) → custom 테스트 **62 → 69**.
- **Phase 후속 대비**: `created_at`+`is_default` 가 두 테이블에 동시 추가되면 **`compareDefaultView()` 한 함수만 교체**, 호출부 불변으로 설계.
- **범위 판단**: 본 작업은 타 트랙·003 의존이 0인 **자기 브랜치 내 순수 엔진 로직**이라 대기 중에도 수행. **정합(@/lib/repo·API·rebase)은 계속 보류** — 머지큐 ①③④ 완료 후.
- 게이트: `check.sh` 초록. 상태: **standby** 유지. 이로써 T05 미결 0.

## 2026-07-21 — T05 · 머지큐 5번 배정 · 003 입력 반영 확인 · 대기 전환(checkpoint)

- **머지큐 확정(기획2)**: ①T03 → ②T02crm → ③T02boards → ④T04 → **⑤T05**. T02·T04 머지 후 공용계약 안정화되면 착수. 그때까지 **대기**.
- **003 실측 — T05 입력 3건 전부 반영 확인** (`003_boards_engine.sql`, 커밋 `d5e31ba`, feat/t02-boards-engine). ③T02boards 가 T05 보다 먼저 머지되므로 선제 확인함:
  - ① 저장뷰 구멍 → **`board_views` 별도 테이블 신설**. 001 `saved_views` 미건드림 → 폐기된 0002 때의 중복 충돌 재발 없음.
  - ② `board_columns.type` = **`field_type`(001 13종 enum) 재사용** + `options_jsonb` → 레지스트리/옵션 엔진 이중화 없음.
  - ③ `item_values(item_id, column_key, value_jsonb)` — 001 `field_values(entity_id, field_key, value_jsonb)` 와 **구조 동일**.
  - ⇒ **재작업 없음.** 설계 §11.4 에 두 표면 매핑표 확정 기록. `field-types`/`options`/`views`/`validation` 수정 없이 재사용, `store` 어댑터는 키 이름 매핑 수준으로 얕음. 흡수할 차이 2건: 뷰 컬럼 필드명(`columns_jsonb`↔`visible_columns_jsonb`), `board_views.kind`(table/kanban) → `ViewConfig` 선택 필드로 확장.
- **정합 게이트 여전히 미충족** → 코드 작업 없음. T05 는 큐 **마지막**이라 앞 4개 랜딩 후 그 위에서 rebase → `domain-types.ts` 를 `@/lib/types` 재export 로 1줄 정합 → repo/API/003 어댑터 순(설계 §11.5).
- **예상 리스크(기록)**: 앞 4트랙이 모두 SSOT 문서(worklog/registry/queue)를 편집하므로 ⑤ 머지 시 해당 문서 충돌 확실 — append 병합으로 해소 예정. 코드(`app/src/lib/custom/`)는 신규 디렉터리라 충돌 없음.
- 상태: **standby**(대기). 게이트 초록 유지, 브랜치 `feat/t05-custom-fields` 머지 대기.

## 2026-07-21 — T05 · 기획2 지시 접수(정합 순서 준수) · ADR-0003 영향 분석 · 정합 보류

- **지시(기획2 순환)**: 001 정본 확인 · 구현 착수 가능 · **T02 재작성 + 공용계약 안정화 후 정합 순서 준수** · 워킹트리 격리(git worktree) 사용.
- **대응**: 엔진 구현은 이미 완료(5f09cd2). 지시의 핵심인 **정합 순서**를 지켜 `@/lib/repo` 넓히기·PostgREST 어댑터·API 라우트는 **착수 보류**. 본 커밋도 격리 worktree 에서 수행.
- **정합 게이트 실측(origin/main = de69db6)** — 전부 미충족:
  - T03 파운데이션(`@/lib/types`·`@/lib/repo`·`@/lib/auth`) main 부재(feat/t03-foundation-org 에만).
  - T02 001-재작성 main 부재 — main 의 `crm/service.ts` 는 재작성 전 boards/items 구버전.
  - `0002_core_crm.sql` 폐기 미반영(main 에 아직 존재). `003_boards_engine.sql` 전 ref 부재.
  - ⇒ 공용계약 미안정화 확인. **`domain-types.ts` vendor 유지**(파운데이션이 main 에 없어 단독 컴파일 유일 수단). 안정화 후 `export * from "@/lib/types"` 1줄 정합.
- **ADR-0003 영향 분석**(설계 §11 신설): 003 `board_columns`/`item_values` 는 core.custom 과 **동일 커스터마이징 표면** → "먼데이 컬럼 재현"이 001 `field_defs` 와 003 `board_columns` 두 곳에 걸침. 코드 실측 결과 `field-types`/`options`/`views`/`validation` 은 **저장소 무관이라 그대로 재사용**, `store`/`service` 만 003 어댑터 추가(재작성 아님). 003 확정 전 어댑터 작성은 스키마 추측이라 금지.
- **기획 요청(003 작성 시 반영 요망, 설계 §11.3)**:
  1. **저장뷰 구멍** — DQ-0011 의 003 산출물에 `saved_views` 없음. 001 `saved_views.entity` 는 `field_entity`(company|deal)라 **보드를 못 가리킴**. 임의 보드 저장뷰 위치를 003 에서 확정할 것(board-scoped 테이블 추가 vs enum 확장). 미정 시 `0002` 때와 같은 중복 재발.
  2. `board_columns` 타입·선택지는 001 규약 준수(`field_type` 13종 + `options_jsonb={options:[{id,label,color,order,archived}]}`) — 엔진 이중화 방지.
  3. `item_values` 는 옵션 **라벨이 아닌 id** 저장 — 핵심 불변식.
- 게이트: worktree 에서 `check.sh` 초록 유지. SSOT: registry/queue 에 정합 게이트·003 입력 반영.

## 2026-07-21 — T05 · 커스터마이징(core.custom) 엔진 구현 (branch: feat/t05-custom-fields)

- **트리거**: OQ-1 해소(ADR-0002) — 정본 = A안 `001_schema_v1.sql`, B안 `0002_core_crm.sql` 폐기.
- **브랜치 사유**: main 공유 워킹트리에서 다수 트랙이 동시 commit/reset/checkout 중 → 경합으로 커밋 유실 발생. 격리 위해 `git worktree` 로 `feat/t05-custom-fields`(base origin/main) 분리, 공유 트리 미간섭. 검증 후 PR/머지.
- **전달물** `app/src/lib/custom/`(순수 TS + vitest, **62 테스트 신규**):
  - `field-types.ts` — 13종 `FieldTypeSpec` 레지스트리(normalize/isEmpty/comparable/operators). 옵션 id 멤버십·달력일·email/url/phone 검증.
  - `options.ts` — 옵션 연산(add/rename/recolor/reorder/archive/unarchive), **id 불변 보장**, 고아 진단.
  - `views.ts` — 001 saved_views(jsonb) ↔ `ViewConfig` 어댑터 + 타입-인지 `applyView`.
  - `store.ts` — `CustomStore` 포트 + `InMemoryCustomStore`(org 격리·값 PK upsert·프루닝·뷰 가시성).
  - `validation.ts` — 요청 파서 + `deriveKey`/`uniqueKey`(**한국어 라벨 지원**, 예약어·중복 회피).
  - `service.ts` — 오케스트레이션(key 파생·옵션 id 발급·값 정규화·프리셋 락·뷰 CRUD), `index.ts` 배럴.
  - 도메인 타입은 committed `@/lib/types`(FieldDef/FieldValue/SavedView/FieldOption/FieldType 13종) 사용 → 타입정합 완료. 영속성은 자체 포트(정착 후 `@/lib/repo` 정합).
- **OQ 결정(구현 반영)**: OQ-2 타입변경=라벨만·OQ-3 프리셋옵션=락·OQ-5 캐시=미구현(정본 field_values). OQ-4 기본뷰=belie 결정 대기.
- **게이트**: worktree 에서 `bash scripts/check.sh` → 초록(앱 138 + 워커 1, custom 62 포함).
- **followup**: `@/lib/repo` 넓히기·PostgREST 어댑터·API 라우트(Next.js 수정판 문서 선확인)·RLS(T03)·T02 뷰엔진 공용화 — 모두 T02 001-재작성 정착 후.
## 2026-07-21 — T03 · hotfix BUG-0001 — createOrg 엔타이틀먼트 미생성

T10 main 스모크 반려 건. **내 코드의 규약 위반**이 맞다.

- 증상: `createOrg()` 가 org + owner 멤버만 만들고 `org_entitlements` 행을 만들지 않았다.
  `isFeatureEnabled()` 는 `enabled=true` 행을 요구하므로 **신규 조직에서 core.\* 전부 잠김**
  (FeatureGate 전면 자물쇠). 시드 조직만 `seed.ts` 에서 MVP 기능을 받고 있어 가려져 있었다.
- 위반한 규약: PLAN v0.2 §5 "MVP: 모든 플랜에 core.* + MVP 모듈 무료".
- 수정: `createOrg` 에서 `MVP_ENABLED_FEATURES` 를 순회해 엔타이틀먼트 행 생성
  (`source: "plan"` — 시드와 동일 의미론. `setEntitlement` 는 `source:"manual"` 이라 미사용).
- 회귀 가드: `localRepo.test.ts` 에 "신규 조직에 MVP 기본 엔타이틀먼트를 부여한다(BUG-0001)"
  추가 — MVP 기능 전건 ON + Phase 2(mod.notify/mod.hometax) 는 OFF 유지까지 검증.
- 채택하지 않은 대안: `isFeatureEnabled` 를 plan_features 기준 판정으로 변경.
  로컬 store 에 plans/plan_features 테이블이 없어 지금은 과한 변경 — Supabase 전환 시
  `plan_features → org_entitlements` 합산으로 정리하는 게 맞다(주석에 명시).
- 반영: main 직접 hotfix(기획2 승인). 작업은 격리 worktree 에서 수행.

## 2026-07-21 — T04 · DQ-0014 판정 반영 — 파일 첨부를 jsonb(deal.custom.files[])로 전환

- **기획2 판정 수령**: MVP 로컬 우선에서는 전용 테이블 없이 **jsonb 저장**
  (딜 = `deals.custom.files[]`, 임의보드 = `item_values`). 신규 마이그레이션 금지.
  전용 attachments 테이블은 Supabase Storage 연결 시 **기획이 004 로 작성**.
- **적용**: `lib/services/files.ts` 를 자체 인메모리 Map → **Repo 경유 jsonb** 로 재작성.
  - 순수 jsonb 헬퍼 `readFileRefs` / `appendFileRef` / `removeFileRef` (불변, 형식 방어).
    배열이 아니거나 원소 형식이 어긋나면 걸러낸다(런타임 jsonb 신뢰 금지).
  - 서비스는 기존 `Repo.getDeal/updateDeal(custom)` 만 사용 → **공용 인터페이스 무변경**
    (피드백 #2 준수). org·담당범위 격리는 Repo 가 그대로 보장.
  - 기존 custom 키(예: `계약상황`)를 덮어쓰지 않음을 테스트로 고정.
- **머지큐**: ①T03 → ②T02crm → ③T02boards → **④T04** → ⑤T05.
  현재 origin/main 에 T03(a7bdc9d)·T02crm(ab9845e) **미머지 확인** → rebase 대기 상태.
  선행 머지 완료 후 `git rebase origin/main` 하여 재푸시 예정.
- 파일 서비스 테스트 40개. `bash scripts/check.sh` **초록**(앱 179 + 워커 1).

## 2026-07-21 — T04 · core.files 로컬 구현 + 정산 임시추정 (브랜치 feat/t04-dash)

- **워킹트리 격리**: `git worktree add ../wt-t04 -b feat/t04-dash` (공유 워킹트리 커밋 금지 규약 적용).
  origin/main 기준으로 분기했으나, 대시보드 코드가 **T03 파운데이션(a7bdc9d)·T02 정본
  재작성(ab9845e)에 의존**해 그 위에 쌓인 스택 브랜치로 구성. main 은 건드리지 않음.
- **기획2 피드백 #1 반영** — 정산 집계가 '—' 대신 **`deal.amount` 기반 임시 추정**으로 폴백:
  `provisionalSettlementFromAmounts()` + `settlementSummaryOrProvisional()`,
  `SettlementSummary.provisional` 플래그. 화면에 **"임시" 뱃지**와 산출 불가 항목(계약금·수수료)
  안내를 함께 노출해 실측과 혼동되지 않게 함. 교체 순서는 TODO 주석에 명시
  (T03 포트 선행 추가 → T09 구현 → T04 실측 교체).
- **피드백 #2 준수**: 공용 인터페이스(`@/lib/types`, `@/lib/repo/index.ts`) **미변경**.
  파일 기능은 아직 공용 포트에 없어 T04 자체 서비스로 분리.
- **core.files 로컬 구현** (독자 CREATE TABLE 금지 → 마이그레이션 없이 로컬 우선):
  - `lib/services/files.ts` — 딜 파일 첨부 인메모리 스토어 + 검증.
    크기 제한(10MB) · **실행/스크립트 확장자 24종 차단** · **경로 탈출 방지**
    (`sanitizeFileName`: 경로 구분자·제어문자 제거) · org 격리 · `buildStoragePath()`
    (첫 세그먼트=org_id, Storage 버킷 RLS 대비).
  - `components/deal/ContractStatusField.tsx` — **계약상황 select**. 선택지는 하드코딩이 아니라
    `field_defs`('계약상황', 002 프리셋)에서 로드, 값은 `deals.custom[key]`.
    → 기획 §3 core.files **완료 기준("계약상황이 딜에서 표시·변경됨") 충족**.
  - `components/deal/FilesTab.tsx` — 흐름 C '문서' 탭. 업로드 전 클라이언트 1차 검증 + 다운로드.
- 신규 테스트 30개(파일 서비스) + 정산 임시추정 7개. `bash scripts/check.sh` **초록**(앱 169 + 워커 1).
- 남은 것: 파일 메타 스키마(DQ-0014, 기획 단일 PR 대기) · Storage 서명URL 교체 · 딜 상세 화면(T02) 배선.

## 2026-07-21 — T04 · core.dash 기본 대시보드 구현 (core.files 는 스키마 대기)

- **기획 v0.2 + 스키마 v1 정독**: `docs/PLAN-v0.2.md`, `supabase/migrations/001_schema_v1.sql`.
  정본 모델 = `deals`/`pipelines`/`stages`/`settlements` (ADR-0002, B안 `0002_core_crm` 폐기).
- **디스패치 보고**(지시 사항):
  - `DQ-0014` [요청→기획] **core.files 스키마 부재** — `core.files` 는 plan_features 에
    기능키로 등록(MVP ON)됐지만 뒷받침 테이블이 정본 어디에도 없음. "새 SQL 만들지 마 ·
    스키마 변경은 기획이 단독 작성"(DQ-0011 원칙)에 따라 직접 저작하지 않고 요청.
    착수 시 만든 초안 `0003_core_files_dash.sql` 은 **회수**(추측 금지 + 폐기된 B안 참조).
  - `DQ-0015` core.dash 분리 착수 — 확정 기획상 대시보드는 "집계=뷰/파생, 이중저장 금지"라
    **새 테이블 없이 구현 가능** → core.files 대기와 분리.
  - `DQ-0004` 갱신: contracts 상태는 `field_defs` '계약상황' 프리셋으로 충족(별도 테이블 불요,
    Phase 2 확인). blocked_on 을 DQ-0014 하나로 정리.
- **구현 (`app/src/lib/dash/`)** — 전부 순수 함수, I/O 없음:
  - `aggregate.ts` — 단계별 건수/비율, 전환율(분모=전체 딜·분자=kind 첫 단계 이상 도달,
    **0분모 방어**), 계약상황 분포(field_defs 옵션 id·라벨 매칭, archived 제외),
    **KST 월 경계**(`monthRangeKst`, 반열린 구간), 정산 요약·재접촉(D+180/365).
  - `service.ts` — `buildDashboard(ctx)`: Repo(담당범위 적용) → 집계 조립. 저장 안 함.
    "계약단계 도달"(파이프라인 KPI) vs "이번달 수납"(수수료입금일 기준 실현) **라벨 분리**(T07 지적 반영).
  - `format.ts` — 0건/미가용 시 `0` 또는 `—` (NaN 금지).
- **화면**: 홈 `(app)/page.tsx` 의 "대시보드 스텁" → **실제 대시보드로 대체**(상단 고정 요약 4종 +
  파이프라인·전환율·계약상황·이번달수납·전체정산·재접촉 위젯). 드릴다운
  `(app)/dash/[pipelineId]` = 보드별 상세(단계별 딜 목록). `FeatureGate(core.dash)` 적용.
- **경계 준수**: 정산 수식은 **T09 확정본**(`policyfund/settlement.ts`) 소비(재저작 없음),
  딜 상세 화면은 **T02 소유**라 링크/중복 구현하지 않음.
- 신규 테스트 63개(집계 42 · 서비스 8 · 포맷 13). `bash scripts/check.sh` **초록**(앱 201 + 워커 1).

## 2026-07-21 — T02b · 사용자 임의 보드 엔진 구현 (003, ADR-0003) — 브랜치 feat/t02-boards-engine

- **선행 해소**: DQ-0011 요청분(003_boards_engine.sql · T02b-boards-engine.md · ADR-0003)이
  T01 push(`d5e31ba`)로 유입 → 즉시 착수. **격리 워크트리** `../wt-t02` (규칙 1).
  base = feat/t02-crm-core(정정된 deals 모델) + origin/main 머지(003 확보).
- **데이터 레이어** `app/src/lib/boards/`:
  - `types.ts` 003 6테이블 1:1 · `cells.ts` 13 field_type 정규화/선택지검증/비교/표시
  - `store.ts` **전용 BoardsRepo 포트**(공용 `lib/repo/index.ts` 미변경 — 규칙 2 준수)
  - `service.ts` 보드/컬럼/그룹/아이템/셀 + 칸반 그룹핑(select 컬럼 또는 board_groups)
    + **시스템 보드 편집 가드**(정책자금은 deals 소유) + EAV 오염 방지(미정의 키 무시)
  - `validation.ts` 입력 검증. **33 테스트 신규**(cells 16 · service 17)
- **로컬 어댑터** `lib/repo/local/`: `boardsRepo.ts` + `store.ts` Db 확장 + `seed.ts`
  (시스템 보드=정책자금 메타 + 예시 사용자 보드 1개: 컬럼 4·그룹 2·아이템 3·셀 값).
  items 담당범위 = 003 RLS 동일 규칙.
- **UI**: `(app)/boards`(목록 — 시스템+사용자 통합 UX) · `(app)/boards/[id]`(테이블/칸반 토글,
  그룹 기준 전환) · `components/boards/`(GenericBoardTable 셀 인라인편집 · GenericBoardKanban ·
  ColumnEditor 13타입+선택지 · NewBoardDialog) · `actions.ts` 서버 액션.
  로컬 스토어가 **서버 인메모리**라 API 왕복 없이 서버 액션 + revalidatePath 로 구현.
- **로컬 실검증**(npm run dev, 포트 3210): 보드목록 렌더 · 테이블 셀값 바인딩(제목/select/date) ·
  칸반 레인(대기1·진행중1·완료1·미지정0) · **서버액션 왕복**(아이템 생성 반영) ·
  **member 계정 본인 담당 2건만**(scope 격리) · **홈 대시보드 딜 집계 정상 = deals 회귀 0**.
- **게이트**: `bash scripts/check.sh` 초록 — app **163 테스트** + worker 1, lint/typecheck OK.
- **규칙 준수**: 신규 SQL 없음(003만) · 공용 계약 미변경 · 001 deals/stages/settlements 불변.
- **후속**: dnd-kit 드래그(데이터 경로 동일, 핸들러만) · TanStack 훅(현재 서버액션) ·
  T05 `lib/custom/field-types` 와 `boards/cells` 공용화(병행 브랜치라 독립 구현).

## 2026-07-21 — T04 · core.dash 기본 대시보드 구현 (core.files 는 스키마 대기)
## 2026-07-21 — T03 · settlements 엔티티 포트 선행 추가 (worktree 격리)

기획2 피드백 #3 반영. 정산 포트를 **파운데이션에서 선행 정의** → T09 가 업무 로직을 구현하고
T04 는 소비만 한다(**T04 가 공용 인터페이스를 직접 수정하지 않도록**).

- `lib/types`: `Settlement` 추가. 001 의 **generated column**(`fee_amount`·`total_revenue`·
  `d180`·`d365`)은 **읽기 전용**으로 표기, 쓰기는 base 컬럼만.
- `lib/repo/index.ts`: `NewSettlement`/`SettlementPatch` + 포트 6종 —
  `listSettlements`·`getSettlement`·`getSettlementByDeal`·`createSettlement`·
  `updateSettlement`·`deleteSettlement`. 소유/소비 경계를 주석에 명시.
- `lib/repo/local/localRepo.ts`: 구현. 파생값은 001 식을 그대로 재현
  (`round(exec×pct/100)` · `down+fee` · `fee_paid_at±180/365`, UTC 날짜 연산),
  **쓰기마다 재계산**. 담당범위는 **상위 deal 가시성**을 따른다(접근 불가 딜엔 생성/수정 거부).
- `store`/`seed`: `settlements` 배열 추가(시드 비움 — 생성은 T09 몫).
- 테스트 5종 추가(총 11): 파생 계산·입금일 null·수정 시 재계산·member 스코프 격리·접근불가 딜 거부.
- **프로세스**: 피드백 #4 반영 — 이번 작업부터 **git worktree 격리**에서 수행(공유 워킹트리 커밋 금지).
  공유 트리는 그사이 다른 트랙이 브랜치를 `feat/t02-crm-core` 로 전환해 있었음(격리의 필요성 재확인).

## 2026-07-21 — T02 · core.crm 정본 스키마 정합 재작성 (boards/items → deals/companies)

- **원인**: 초기 구현 직후 정본 `docs/PLAN-v0.2.md` + `001_schema_v1.sql` 이 다른 트랙 커밋으로
  유입됨. 정본 모델(companies/pipelines/stages/deals/activities)이 내 독자 저작(boards/items)과
  근본적으로 달랐고, 수식/저장뷰 경계도 T09/T05 소유로 확인됨. 오너 결정=**PLAN 경계 준수**.
- **폐기(삭제)**:
  - `supabase/migrations/0002_core_crm.sql`(경쟁 모델) → T05 의 saved_views 스키마 충돌 해소.
  - `app/src/lib/crm/{formulas,pipeline,views,templates,store,postgrest,context,types}` +
    구 API 라우트(boards/items/views) — boards/items 모델 산출물.
- **재작성(정본 001 기반)**:
  - 공유 `@/lib/repo` 포트를 core.crm 쓰기로 확장 — companies/deals CRUD, activities,
    getStage. 담당범위(scope) 격리(owner/admin/all=전체, member+assigned=본인 담당만).
  - `app/src/lib/crm/`: service(오케스트레이션)·activity(이동 로그 문구)·validation·
    context(`@/lib/auth` 세션 → Ctx, 없으면 401)·http.
  - API: `/api/companies`·`/api/pipelines`·`/api/deals`·`/api/deals/[id]/move`·
    `/api/deals/[id]/activities`. 단계 이동은 move 로만(활동로그 보장), updateDeal 은 stage 거부.
  - `docs/PLAN-core-crm-v0.2.md` 정본 정합 내용으로 갱신.
- **경계 정정**: 수식/settlements=**T09**(정본 = generated column + policyfund/settlement.ts),
  커스텀필드/저장뷰=**T05**, 조직/RLS/Auth=**T03**(완료). 별도 store/PostgREST 어댑터 미제작 —
  공유 Repo 포트 재사용(운영 Supabase 어댑터는 포트 뒤 스왑).
- **게이트**: `bash scripts/check.sh` 초록 (app 76 테스트, 그중 crm/repo 신규 29).
- **조율**: DQ-0002 done 노트 정정, DQ-0005(T05) saved_views 충돌 resolved 표기, T02 registry 갱신.

## 2026-07-21 — T03 · 공용 파운데이션(PR-0) — 로컬 우선 세션·Repo·엔타이틀먼트 + 온보딩/멤버 UI

브랜치 `feat/t03-foundation-org`. Supabase 연결 전, **dev-session + repo-레벨 scope** 로
공용 파운데이션을 먼저 착지시켜 T02·T04 를 언블록한다(구글 OAuth·DB RLS 는 Supabase 연결 후).

- **안정 인터페이스(소비 트랙용)**:
  - `lib/types/index.ts` — 001_schema_v1 도메인 타입 수동 정의(정본). 역할/enum도 여기로 통합, `lib/auth/roles.ts` 는 위계/가드만.
  - `lib/repo/index.ts` — `Repo` 포트 + `getRepo()`. `lib/repo/local/{store,seed,localRepo}` = 인메모리 구현. **담당범위 규칙**: owner/admin·scope=all → 조직 전체, member+assigned → 본인(assigned_to)만.
  - `lib/auth/session.ts` — `getSession(): Promise<Ctx>`(Next16 cookies async) + `getSessionOrNull` + `applyAs`(?as 오버라이드). dev-session 쿠키(mw_uid/mw_org/mw_as).
  - `lib/entitlements.ts` — `isEnabled(ctx, key)`(feature_key 기반, 001 org_entitlements 반영).
  - `lib/presets/policyfund.ts` — `installPolicyfundPreset(ctx)` → 딜 커스텀필드(field_defs) 전개 + 엔타이틀먼트 ON(idempotent).
  - `lib/product.ts` — `PRODUCT_NAME`(단일 상수) + FEATURES/MVP 기본 기능 집합.
- **UI**(수정판 Next16 — proxy 규약·async cookies/searchParams·route group 확인):
  - `app/(auth)/login` — dev-session 계정 선택 로그인(서버액션 쿠키).
  - `app/(app)/layout.tsx` — 인증 셸(getSession 가드 → 미인증 /login). `page.tsx` 홈(=`/`, ?as 역할전환·스코프 시연·FeatureGate 데모), `onboarding`(조직생성+auto-owner+정책자금팩), `settings/members`(멤버·권한, owner/admin만 역할변경).
  - `components/auth/FeatureGate.tsx` — Phase 2 모듈 자물쇠(mod.notify 등).
- **테스트**: `localRepo.test.ts`(6) — 스코프 격리(member 본인만/owner 전체)·프리셋 설치·idempotent·auto-owner. `roles.test.ts`(9). check.sh 초록.
- **라우트 정리**: 기존 Supabase OAuth `app/login/page.tsx`·루트 `page.tsx` 제거(각각 `(auth)/login`·`(app)/page.tsx` 로 대체). 이번 세션 초반 만든 Supabase SSR 레이어(`lib/supabase/*`·`proxy.ts`·`app/auth/*`·`membership.ts`·@supabase deps)는 **이 PR 에 미포함**(로컬 우선 파운데이션에 집중) — 워킹트리에 dormant 로 두고 Supabase 연결(내일) 시 별도 커밋. 이 PR 은 @supabase 의존 없이 자족(CI 정합).
- **완료기준 대응**: ①/login→온보딩→홈 무에러 ②installPolicyfundPreset→field_defs 생성(테스트) ③?as=member 본인 담당만(테스트) ④FeatureGate 자물쇠 ⑤lib/repo·types·auth 안정 존재 + check.sh 초록.
- 후속: (Supabase 연결 후) LocalRepo→SupabaseRepo 어댑터 스왑·dev-session→구글 OAuth·DB RLS 침투테스트(T10). T02/T04 는 `lib/repo`·`lib/types`·`lib/auth` 소비.

## 2026-07-21 — T09 · 정책자금 보드 UI + 번들 프리셋 스냅샷

- **UI**(수정판 Next.js16/App Router·React19·Tailwind v4, `node_modules/next/dist/docs` + T02/T03 페이지 패턴 확인 후):
  - `app/src/components/policyfund/OptionSelect.tsx` — 선택지 카테고리 셀렉트(개수 뱃지, region 218 등 대용량 네이티브 처리).
  - `app/src/components/policyfund/PolicyfundBoard.tsx` — 업무관리 31컬럼 테이블(가로 스크롤·타입 뱃지·formula 툴팁) + 단계 필터/정렬 컨트롤(`pipeline.ts` 소비).
  - `app/src/app/policyfund/page.tsx` — 서버 컴포넌트, 보드 + 7종 선택지 카탈로그. T03 프록시로 인증 뒤(정상).
- **번들 프리셋 스냅샷**: `app/src/data/policyfund-presets.json`(002_seed 추출) + `bundled.ts` 로더. MVP 오프라인 렌더용, 프로덕션은 DB industry_modules 로드로 교체.
- **드리프트 가드**: `bundled.test.ts` — 스냅샷 **실데이터**로 `validatePresetCounts`(218/59/18/16/11/14/28) + 31컬럼 + 6단계 + 수식정의 검증. 시드 변경 후 스냅샷 재생성 누락 시 실패.
- **게이트**: `bash scripts/check.sh` → 초록. 앱 **115 테스트**(policyfund 37) + 워커 1, lint/typecheck(tsx 포함) OK.
- 남은 배선: 번들→DB industry_modules 로드 교체, 보드 아이템(행)·formula 셀 계산 = T02 API + `settlement.computeSettlement` 연동. T02 crm/formulas.ts 확정본 정합(DQ-0009 followup).

## 2026-07-21 — T03 · 조직·보안 — 인증/인가 앱 레이어 (구글 OAuth + RLS 세션 플러밍)

**정정(중요)**: core.org 스키마·RLS·auto-owner 는 이미 `001_schema_v1.sql`(스키마 v1 정본)에
완비돼 있었다 — `orgs`/`users`/`org_members`(member_role: owner/admin/member, member_scope:
all/assigned), 헬퍼 `is_org_member`/`org_role`/`org_scope`, 트리거 `add_org_owner`, 전 도메인
테이블 RLS. 착수 초기엔 이 파일이 리포에 없어 `0002_core_org.sql`(organizations/profiles 재정의)을
작성했으나, 정본 확인 후 **중복·충돌(특히 `org_members` 재정의로 적용 실패)** 이라 폐기했다.
따라서 T03 실제 산출물은 **그 스키마 위의 앱 인증/인가 레이어**다(001 에 없는 부분).

- **Supabase SSR 세션 플러밍** (RLS 가 작동하려면 요청에 세션 JWT→`auth.uid()` 가 있어야 함):
  - `app/src/lib/supabase/server.ts` — RSC/라우트/액션용 서버 클라이언트(Next16 async `cookies()`).
  - `app/src/lib/supabase/client.ts` — 클라이언트 컴포넌트용 브라우저 클라이언트.
  - `app/src/lib/supabase/env.ts` — env 가드(NEXT_PUBLIC URL/anon key, 비밀값 저장소 금지).
- **세션 게이트**: `app/src/proxy.ts` — Next16 `middleware`→`proxy` 규약(문서 확인). 매 요청
  세션 갱신 + 미인증 시 `/login` 리다이렉트, 인증+`/login`→홈. env 미설정 시 fail-open(개발 편의).
- **구글 OAuth**: `/login`(소셜 버튼, `signInWithOAuth`), `/auth/callback`(코드교환 +
  `public.users` upsert — 001 에 auth.users→users 트리거가 없어 앱에서 프로필 보강),
  `/auth/signout`(POST).
- **인가 lib**: `app/src/lib/auth/roles.ts`(member_role/member_scope, `atLeast`/`isManager`,
  타입가드) + `roles.test.ts`(9 테스트). `membership.ts`(서버 가드 `getMyMembership`/`getMyRole`/
  `requireRole`/`requireManager`). 역할 모델은 스키마 정본에 정합 — 프로즈의 4역할(viewer)은
  스키마에 없어 미채택.
- deps: `app/package.json` 에 `@supabase/ssr`·`@supabase/supabase-js` 추가(lock 동기화).
- `bash scripts/check.sh` **초록**(lint + typecheck app/worker + test, 앱 109→auth 9 포함).
- 후속: (T02) context.ts 세션 연동 언블록 · (T10) 라이브 RLS 침투테스트는 provider 프로비저닝 후 ·
  마이그레이션 번호 혼재(001_ vs 0001_) 정합은 T10/스키마 오너 조율 필요.

## 2026-07-21 — T09 · 정책자금 업종팩 데이터 로직 계층 (확정 시드 반영)

- **트리거**: 기획 v0.2 + DB 스키마 v1 확정 통보. 착수 시점 지정 파일(`docs/PLAN-v0.2.md`, `supabase/migrations/002_seed_policyfund.sql`) 부재 → 순수 계층 선구현 후, **두 파일 랜딩 확인**(T02 core.crm done 과 함께)하여 확정본에 정합.
- **시드 전수 검증**: `002_seed_policyfund.sql` (industry_modules.presets_jsonb) 파싱 → 개수 실측 = 지역 **218**·상품 **59**·진행기관 **18**·상담상황 **16**·계약상황 **11**·진행상항 **14**·자금명 **28**, 업무관리 보드 **31컬럼** (사용자 명시치·PLAN 과 정확히 일치).
- **구현** (`app/src/lib/policyfund/`, 순수 TS + vitest):
  - `settlement.ts`(+test) — **확정 수식**: 수수료(원)=`round(실행액×수수료%/100)`(정수 %), 총매출=`계약금+수수료(원)`, D+180/365=`수수료입금일+n일`(미입금 null). 002_seed formulas 블록과 1:1.
  - `presets.ts`(+test) — 시드 JSONB → 7개 선택지 카테고리 로더(`loadOptionCategories`, field_presets + board_columns 옵션 출처 매핑) + `validatePresetCounts`(실측 개수 대조).
  - `board.ts`(+test) — 보드 컬럼 추출(`getWorkBoardColumns`=업무관리 31컬럼), select 옵션 ref(region/product)/inline/redacted·formula 해석.
  - `pipeline.ts`(+test) — 단계 필터·정렬·집계·그룹화(단계 순서는 시드 pipeline_stages 주입).
  - `types.ts` 원본 JSONB 구조 + 앱 도메인 타입, `fixture.ts` 테스트 픽스처, `index.ts` 배럴.
- **⚠ 크로스트랙 정합 이슈 발견**: T02 `crm/formulas.ts` 는 **가정** 기반(총매출=수수료×1.1 부가세, D+n=계약일 기준, base=계약금액)이라 확정 시드와 불일치. 정산(settlements)은 T09 소유이므로 확정 정의를 `policyfund/settlement.ts` 에 두고, T02 수식컬럼 엔진 정합을 **DQ-0009 followup** 으로 요청.
- **게이트**: `bash scripts/check.sh` → 초록. 앱 **109 테스트**(policyfund 31 신규 포함) + 워커 1 통과, lint/typecheck OK. 타 트랙(T02 crm·T03 auth) 산출물과 충돌 없이 통합.
- **남은 작업(UI)**: 선택지 셀렉트 · 업무관리 31컬럼 보드 화면 · 파이프라인 필터/정렬 UI — 데이터·로직 준비 완료, T02 보드 CRUD API 소비 + `app/AGENTS.md` 지시대로 `node_modules/next/dist/docs/` 확인 후 착수.
- SSOT: `session-registry.yaml` T09 delivered/followup 기입, `dispatch-queue.yaml` DQ-0009 followup(T02 정합·UI).

## 2026-07-21 — T05 · 커스터마이징(core.custom) 커스텀필드 엔진 설계(checkpoint)

- T02 done(DQ-0002) 확인 → T05 언블록. `git pull`(up to date) 후 지시된 소스 정독:
  `docs/PLAN-v0.2.md` §3(core.custom), `supabase/migrations/001_schema_v1.sql`의 `field_defs`·`field_values`·`saved_views`(+ `field_type` 13종·`field_entity` enum), T02 산출물(`app/src/lib/crm/{types,store,views,validation}.ts`).
- **설계 문서 작성**: `docs/design/T05-custom-fields-design.md`.
  - 필드 **타입 레지스트리**(13종 `FieldTypeSpec` — 정규화/isEmpty/comparable/연산자, 타입별 value_jsonb 저장형 표).
  - **선택지(옵션) 관리**: `options_jsonb` = `{options:{id,label,color,order,archived}[]}`, **저장값은 옵션 id**(라벨 아님) → 라벨/순서 변경에도 저장값 불변(먼데이 동작). add/rename/reorder/archive, 고아 값 진단.
  - **field_defs/field_values 생명주기**: key slug 파생·UNIQUE, 타입변경 정책(MVP 거부), 값 정규화 upsert(PK entity_id+field_key)·프루닝, `deals.custom`은 읽기 캐시로만.
  - **저장뷰**: T02 `views.ts`(applyView/matchFilter) + `validation.ts` **재사용**, 001의 filters/sort/columns_jsonb ↔ ViewConfig 어댑터, 개인/공유·기본뷰.
  - **레이어링**: T02 패턴 그대로 — `CustomStore` 포트 + InMemory/PostgREST 어댑터 + service + Next.js API 라우트(app/AGENTS.md 경고 반영: 코드 전 `node_modules/next/dist/docs/` 확인).
- ⚠️ **착수 선결(BLOCKER) 발견·명시**: 커스터마이징 레이어를 정의하는 마이그레이션이 **두 벌 공존** — `001_schema_v1.sql`(field_defs/field_values) vs `0002_core_crm.sql`(board_columns/column_values). 특히 **`saved_views` 테이블이 두 파일 모두 `create table`**(001:210, 0002:144, 컬럼 상이) → 중복 생성 충돌. 어느 모델이 정본인지(안 A: 001 / 안 B: 0002) 코디네이터 판정 필요(설계 §0/§7/OQ-1). **판정 전 구현 미착수**(경계 존중).
- 참고: 착수 지시의 "custom_views"는 실제 스키마에 없음 — 테이블명은 `saved_views`(001·PLAN §3 일치). 설계는 `saved_views`로 표기.
- SSOT 갱신: `session-registry.yaml` T05 standby→active(delivered: 설계문서, blocked_on: 스키마 정합), `dispatch-queue.yaml` DQ-0005 blocked→in_progress.
- check 게이트 초록 확인 후 커밋·푸시.

## 2026-07-21 — T06 · 알림발송(mod.notify) Phase 2 설계 문서 작성

- 트리거: 오너가 기획 v0.2 + DB 스키마 v1 확정 통보 → `docs/PLAN-v0.2.md` §3/§4(mod.notify·흐름 E) + `001_schema_v1.sql`(message_channel/message_status enum, message_templates·messages 테이블, RLS) 정독.
- 확인: **mod.notify 는 Phase 2(벤더)** — MVP plan_features 미포함(entitlement OFF, `001_schema_v1.sql` L461-462). 스키마상 테이블은 `message_templates`·`messages`(문서상 명칭). 설계는 미리, 활성화는 Phase 2 계약 후.
- 산출물: **`docs/design/T06-notify-design.md`** — 발송 파이프라인(App→messages(queued)→pg-boss `notify.send`→VPS 워커 벤더 어댑터→상태갱신·재시도), 트리거 3종(수동/단계이동 자동/정산 D+180·365 스케줄), 벤더 어댑터 추상화, 알림톡→SMS 대체발송, entitlement 게이트, Phase 2 추가 마이그레이션(`00X_notify_phase2.sql`: channel/retry_count/provider_message_id/scheduled_at 등) 제안.
- **벤더 비교표(비용·API·리드타임)**: SOLAPI/팝빌/NHN Cloud/NCP SENS/알리고/비즈엠. 권장 = 1차 SOLAPI(DX·단일벤더), 전략대안 팝빌(홈택스·세금계산서 통합). belie 계약 결정(DI-5) 요청.
- 조율: T02 단계이동→알림 트리거 이벤트 계약 필요(dispatch-queue). mod.hometax 트랙과 벤더 통합 논의.
- 기존 마이그레이션 미수정(규칙 준수) — Phase 2 착수 시 새 파일로 additive.



- **트리거**: 오너가 기획 v0.2 + DB 스키마 v1 확정 통보. 단, 지정된 `docs/PLAN-v0.2.md` /
  `supabase/migrations/001_schema_v1.sql` 이 저장소에 부재 → 오너 승인 하에 T02 가 core.crm
  스키마 v1 + 설계를 저작.
- **스키마**: `supabase/migrations/0002_core_crm.sql` — boards / pipeline_stages /
  board_columns / items / column_values / saved_views + `org_id` 멀티테넌시 + RLS enable
  (정책 없음=fail-closed). 방식 B(하이브리드 정규화).
- **설계 문서**: `docs/PLAN-core-crm-v0.2.md` — 수식 4개 가정, 자동화 규칙, 트랙 경계 명시.
- **도메인 레이어** `app/src/lib/crm/`:
  - 수식 엔진(수수료·총매출·D+180·D+365) — 가정을 formulas.ts 상단에 문서화, 교정은 그 파일만.
  - 파이프라인 단계 이동 + 자동화(진행중→계약일 자동세팅, 완료→completed_at 스탬프/해제).
  - 저장뷰 필터·정렬 적용, 입력 검증 — 모두 순수 함수 + 단위테스트.
  - 스토어 포트 + InMemory(참조/테스트) / PostgREST(운영, fetch, 의존성 0) 어댑터.
  - 서비스 오케스트레이션 + Next.js Route Handlers(boards/items/move/views CRUD).
- **게이트**: `bash scripts/check.sh` 초록 (app 68 crm 테스트 포함 총 90 통과, lint/typecheck OK).
- **경계 존중**: RLS 정책 본체·조직 모델·Auth = T03, 커스텀필드 옵션 = T05. `org_id` 컬럼 +
  앱 레이어 org 스코핑 + `x-org-id` 임시 컨텍스트(T03 연동 시 교체).
- **조율**: DQ-0002 → done (T05/T07/T09 언블록). session-registry T02 → active.
- **후속**: T03 Auth/RLS 정합, PostgREST 라이브 DB 통합테스트, 수식 확정본 반영.
- 앱 라우트 작성 전 `app/AGENTS.md` 지시대로 `node_modules/next/dist/docs/` 확인
  (route handler 규약: `context.params` = Promise).

## 2026-07-21 — T09 · 정책자금 업종팩 착수 · 데이터 무의존 순수 계층 구현(checkpoint)

- **선행 파일 부재 확인**: 착수 지시가 가리킨 `docs/PLAN-v0.2.md` 와 `supabase/migrations/002_seed_policyfund.sql` 이 **저장소 어디에도 없음**(트래킹/브랜치/스태시/워크트리 전수 확인). 실제 도메인 값(지역 218·상품 59·기관 18·상담 16·계약 11·진행 14·자금 28, 보드 31컬럼)은 지어내지 않고, 그 데이터가 들어오면 꽂히도록 계층만 선구현.
- **구현**(`app/src/lib/policyfund/`, 순수 TS + vitest):
  - `types.ts` — 옵션 카테고리·프리셋 옵션·진행기관·상품·보드 컬럼/아이템 도메인 타입.
  - `settlement.ts`(+test) — 정산 수식: `수수료=집행금액×수수료율`, `총매출=수수료 합`(집행금액 기준 대안 제공), `D+180/D+365`(UTC 기산). 가정 명시.
  - `pipeline.ts`(+test) — 파이프라인 단계별 필터·정렬(미지정 후순위·안정)·개수집계·그룹화(빈 단계 포함). 단계 순서는 시드 옵션 순서를 호출부가 주입(하드코딩 금지).
  - `presets.ts`(+test) — 7개 카테고리 구조 + `EXPECTED_COUNTS`(기획 명세 개수) + `validatePresetCounts()`/`isFullyLoaded()`. 실제 값은 `PRESET_OPTIONS`(현재 빈 값)에 시드 로더가 주입 예정.
  - `index.ts` 배럴, `README.md`(상태·대기 입력·정산 가정 문서화).
- **게이트**: `bash scripts/check.sh` → 초록. 앱 22 테스트(policyfund 21 신규 + format 1) + 워커 1 통과, lint/typecheck OK.
- **남은 작업(차단)**: (1) `002_seed` 확정 → `PRESET_OPTIONS` 로더 연결 + 개수 대조, (2) 보드 31컬럼 레지스트리(기획 v0.2), (3) UI 컴포넌트(선택지 셀렉트·보드 뷰·파이프라인) — 데이터 + T02 보드 CRUD API + Next.js 수정판 문서 확인 후.
- SSOT 갱신: `session-registry.yaml` T09 status → active, `dispatch-queue.yaml` DQ-0009 status → in_progress(남은 항목 blocked_on 명시).

## 2026-07-21 — T10 · 게이트키퍼(검증) 트랙 등록 · 베이스라인 게이트 검증 · 상시대기(checkpoint)

- 역할: 배포마다 **parity**(먼데이 원본 대비 재현 정합성) · **측정** · **RLS 침투테스트**(조직 단위 멀티테넌시 격리) · **완료판정**. 상시 활성.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `scripts/check.sh`, `docs/coordination/*`(session-registry / dispatch-queue / provider-status) 전체 정독.
- **베이스라인 게이트 검증**: `bash scripts/check.sh` 직접 실행 → **초록(exit 0)**. lint + typecheck(app/worker `tsc --noEmit`) + test(app `format.test`, worker `health.test`, 각 1 pass) 통과 확인 → 현 시점 저장소는 게이트 통과 상태.
- **검증 대상 현황**: 도메인 트랙 T02~T09 는 기획 v0.2 + DB 스키마 v1 미확정으로 전부 standby/blocked — **검증할 배포 산출물이 아직 없음**. parity 는 T02(core.crm 보드 미러), RLS 침투테스트는 T03(core.org + RLS) 산출물에 의존하므로 해당 트랙 배포 시 착수.
- **완료판정 기준**: 각 트랙 done 승인은 `check 게이트 통과` + `parity/측정/RLS 검증 통과`를 **모두** 만족할 때만.
- SSOT 갱신: `session-registry.yaml` 에 T10 등록(status: active), `dispatch-queue.yaml` 에 DQ-0010 추가(status: in_progress, 상시 대기형 검증).
- 다음: 트랙 PR/배포 발생 시 parity·측정·RLS 침투테스트 착수. 그 전까지 게이트 초록 유지 감시하며 대기.

## 2026-07-21 — T08 · 홈택스(mod.hometax) 트랙 등록 · 대기(checkpoint)

- 역할: `mod.hometax` 조회→발행(전자세금계산서) + worker 잡(pg-boss 조회·발행 백그라운드 잡).
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/AGENTS.md`(수정 Next.js — 코드 전 `node_modules/next/dist/docs/` 확인), `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 상태: supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만, `worker/src/index.ts` 는 pg-boss 부트스트랩 골격(잡 핸들러 TODO)만 존재 — mod.hometax 도메인 미착수.
- **대기 사유**: 선행 트랙 **T06(mod.notify + VPS 워커 잡 패턴)** 미완료 + 기획 v0.2 확정 + DB 스키마 v1(mod.hometax 도메인 테이블 — 조회/발행/문서로그) 미확정. 홈택스 워커 잡은 T06 이 세우는 pg-boss 핸들러 패턴 위에 얹힌다.
- 외부 의존: 홈택스는 국세청/전자세금계산서 연동 프로바이더 → `provider-status.yaml` 에 `hometax`(kind: tax-invoice, status: planned) 등록. 인증서·API 키 등 비밀값은 env 로만 주입, 저장소 기록 금지.
- SSOT 갱신: `session-registry.yaml` 에 T08 등록(status: standby, depends_on: [T01, T06]), `dispatch-queue.yaml` 에 DQ-0008 추가(status: blocked), `provider-status.yaml` 에 hometax 추가.
- 선행 조건(T06 done + 기획 v0.2 + DB 스키마 v1) 충족 시 착수 순서(안): mod.hometax 마이그레이션 → 조회 도메인/API → 발행 플로우 → worker(pg-boss) 조회·발행 잡.

## 2026-07-21 — T07 · 성과·인센티브(mod.perf) 트랙 등록 · 대기(checkpoint)

- 역할: `mod.perf` 성과 집계 / 리더보드 / 활동량.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 도메인 현황: supabase 는 `0001_init.sql`(메타)만, `worker/src/index.ts` 는 pg-boss 부트스트랩 골격만(잡 핸들러 TODO) — mod.perf 도메인 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(mod.perf 도메인 테이블 — 성과지표/집계 스냅샷/활동로그) 미확정. 특히 활동량·성과 집계의 소스가 **T02(core.crm)** 의 보드/아이템/파이프라인 이벤트이므로 T02 done 전까지 착수 불가.
- SSOT 갱신: `session-registry.yaml` 에 T07 등록(status: standby, depends_on: [T01, T02]), `dispatch-queue.yaml` 에 DQ-0007 추가(status: blocked).
- 선행 조건 충족 시 착수 순서(안): mod.perf 마이그레이션 → 집계 로직(뷰/pg-boss 주기 잡) → 리더보드 조회 API. 주기 집계 잡은 worker 에서 T06 등 타 트랙과 dispatch-queue 로 조율.

## 2026-07-21 — T09 · 정책자금 업종팩(ind.policyfund) + 정산(settlements) 트랙 등록 · 대기(checkpoint)

- 역할: `ind.policyfund` 진행기관(취급기관) + 상품 카탈로그(60여종) + 지역 조건 + 상품 수식(한도/금리/자격 계산) · `settlements` 정산.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: (1) 선행 트랙 **T02(core.crm)** 미완료 — 정산은 계약/아이템 도메인 위에 얹힘. (2) 기획 v0.2 확정 필요 — 정책자금 상품 60여종 목록·수식(한도/금리/자격) 정의가 업종팩 스키마·엔진의 입력.
- SSOT 갱신: `session-registry.yaml` 에 T09 등록(status: standby, depends_on: [T01,T02]), `dispatch-queue.yaml` 에 DQ-0009 추가(status: blocked).
- 선행 조건 충족 시 착수 순서(안): ind.policyfund 진행기관/상품/지역 마이그레이션 → 수식 엔진(수식 정의 저장·평가) → settlements 정산(계약 성사 → 수수료/정산 산출·기록, worker 잡 연동).

## 2026-07-21 — T06 · 알림발송(mod.notify) 트랙 등록 · 대기(checkpoint)

- 역할: `mod.notify` 알림톡(카카오)/문자(SMS) 발송 + VPS 워커 발송 잡(pg-boss).
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 도메인 현황: `worker/src/index.ts` 는 pg-boss 부트스트랩 골격만 존재(`boss.work(...)` 잡 핸들러 TODO), `worker/.env.example` 는 `DATABASE_URL` 만. supabase 는 `0001_init.sql`(메타)만 — mod.notify 도메인 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(mod.notify 도메인 테이블 — 템플릿/발송로그/수신자) 미확정. 발송 트리거가 될 도메인 이벤트는 타 트랙(T02 파이프라인 등) 스키마에 의존.
- SSOT 갱신: `session-registry.yaml` 에 T06 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0006 추가(status: blocked).
- 선행 조건 충족 시 착수 순서(안): mod.notify 마이그레이션 → 프로바이더 어댑터(알림톡/SMS) → pg-boss 발송 잡(재시도·상태 추적). 비밀값(프로바이더 API 키)은 `.env` 로만.

## 2026-07-21 — T03 · 조직·보안 트랙 등록 · 대기(checkpoint)

- 역할: `core.org`(조직/멤버십) + RLS 멀티테넌시(조직 단위 격리) + Supabase Auth 구글 OAuth 로그인.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마·RLS·Auth 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(core.org 도메인 테이블) 미확정.
  RLS는 조직 테이블 구조에 의존하므로 스키마 v1 확정 후 설계·구현.
- SSOT 갱신: `session-registry.yaml` 에 T03 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0003 추가(status: blocked).
- 참고: `app/AGENTS.md` — 이 Next.js는 수정 버전. OAuth 로그인 라우트 작성 전 `node_modules/next/dist/docs/` 확인 필요.
- 선행 조건 충족 시 착수 순서(안): core.org 마이그레이션 → RLS 정책 → Supabase Auth 구글 OAuth 연동.

## 2026-07-21 — T05 · 커스터마이징(core.custom) 트랙 등록 · 대기(checkpoint)

- 역할: `core.custom` 커스텀필드 + 필드 타입별 선택지(옵션) + 저장뷰(saved view) — 먼데이 컬럼 재현.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: 선행 트랙 **T02(core.crm)** 미완료. 커스텀필드는 T02 의 보드/아이템 도메인 스키마 위에 얹히므로 T02 done 전까지 착수 불가.
- SSOT 갱신: `session-registry.yaml` 에 T05 등록(status: standby, blocked_on: T02), `dispatch-queue.yaml` 에 DQ-0005 추가(status: blocked).
- T02 완료 시 dispatch-queue 로 작업 이관 후 착수 예정.

## 2026-07-21 — T04 · 문서·대시 트랙 등록 · 대기(checkpoint)

- 역할: `core.files` 문서함 + `contracts` 상태 + `core.dash` 기본 대시보드.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(core.files/contracts/core.dash 도메인 테이블) 미확정.
- SSOT 갱신: `session-registry.yaml` 에 T04 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0004 추가(status: blocked).
- 참고: `app/AGENTS.md` — 이 Next.js는 수정 버전. 앱 코드 작성 전 `node_modules/next/dist/docs/` 확인 필요.
- 선행 조건 충족 시 착수 예정.

## 2026-07-21 — T02 · 영업코어(core.crm) 트랙 등록 · 대기(checkpoint)

- 역할: 신규고객/컨택/업무 보드 미러 + 파이프라인(상담중→계약대기→진행중→완료) + 단계 이동 자동화.
- 프로젝트 구조 파악 완료: `CLAUDE.md`, `AGENTS.md`, `app/`·`worker/`·`supabase/` 골격, `docs/coordination/*` 정독.
- 현재 supabase 는 `0001_init.sql`(app_meta/schema_version 메타)만 존재 — 도메인 스키마 미착수.
- **대기 사유**: 기획 v0.2 확정 + DB 스키마 v1(supabase 도메인 마이그레이션) 미확정.
- SSOT 갱신: `session-registry.yaml` 에 T02 등록(status: standby), `dispatch-queue.yaml` 에 DQ-0002 추가(status: blocked).
- 선행 조건 충족 시 착수 예정.

## 2026-07-21 — T01 · Phase 0 → W1 모노레포 기반 구축

- 레포 클론 및 모노레포 골격 수립.
- `app/` — Next.js 16 (TypeScript + Tailwind v4 + App Router, `src/` 구조) 스캐폴딩.
- `worker/` — Node(ESM) + pg-boss 골격, health 유닛테스트 포함.
- `supabase/` — `migrations/0001_init.sql` (app_meta / schema_version) + README.
- `scripts/check.sh` — lint + typecheck + test 단일 게이트.
- `.github/workflows/ci.yml` — push/PR 시 `npm ci` → check 게이트 실행.
- `.githooks/pre-commit` — 커밋 전 check 게이트 (`core.hooksPath=.githooks`).
- 루트 npm workspaces(app, worker) 구성.
- SSOT 4문서 작성: `CLAUDE.md`, `AGENTS.md`, `docs/worklog.md`, `docs/coordination/`.
- check.sh 초록 확인 후 커밋/푸시.

## 2026-07-27 — T09 · Public Workspace Entry release close / next queue (coordination only)

- WORK-ID: `PUBLIC-WORKSPACE-ENTRY-01-CLOSE-HOLD-AND-NEXT-QUEUE`.
- clean isolated coordination branch `docs/public-workspace-entry-close-hold`에서 `ROUND-32.md`만 새로 작성하고 본 worklog에 append했다. product candidate branch와 기존 dirty worktree는 수정하지 않았다.
- `PUBLIC-WORKSPACE-ENTRY-01` candidate `351a5305ad935e3bbffd41b0adb3c24783b6bc02` / tree `92bb09be2bb25ded02b671396b7cb8c6764625fe`, Draft PR #22, CI #96 SUCCESS, Vercel Preview Ready 및 T10 exact-SHA/Preview PASS 증거는 보존한다.
- release state는 **`BLOCKED_OPERATIONAL / RELEASE_HOLD / NOT_DEPLOYED`**: hosted `006` 미적용, recoverable hosted DB backup/dump·authorized DB connection/maintenance window·migration ledger proof·safe authenticated fixtures/accounts 부재. hosted DB/authenticated visual/merge/deploy/production readback은 `NOT_RUN_BY_GATE`다.
- exact unblock은 승인된 recoverable backup/dump path + authorized DB connection/maintenance window + isolated safe authenticated test accounts/fixtures의 동시 제공이다. 이 조건도 independent review와 release approval을 대체하지 않는다.
- PR #19는 conflict/superseded comment 뒤 closed unmerged, PR #20은 Draft/HOLD이며 PR #22 뒤 rebase·migration renumber·entitlement/default-pipeline/stage dependency reconciliation이 필요하다.
- `SIDEBAR-LEADS` 및 external `TEMPLATE-PUBLISHER` framing을 supersede했다. MoaWork의 목표는 가입한 고객 workspace 안에서 고객 운영체계를 구현하는 것이며, reusable blueprint는 internal delivery accelerator다. public external CRM template marketplace는 범위 밖이다.
- 8개 후속 project queue는 기록만 했고, PR #22 `RELEASE_HOLD` 중 시작하지 않는다. Consumer: T06. `INTERNAL_SUBAGENT_ONLY: NONE`.

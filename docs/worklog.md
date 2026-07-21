# worklog

append-only 작업 로그. 최신 항목을 위에 추가한다. 한 항목 = 한 의미 있는 진행 단위.

---

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

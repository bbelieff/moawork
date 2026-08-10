# [T03 · 조직보안 / core.org + 공용 파운데이션] 다음 구현 프롬프트

먼저 `docs/track-prompts/_FOUNDATION.md`(당신이 이 계약의 **소유자**), `docs/PLAN-v0.2.md §3(core.org)·§4(흐름 A)`, `001_schema_v1.sql`(orgs·users·org_members·RLS 헬퍼)·`002`를 읽으세요. 워크로그 START 후 착수.

## 목표(이번 PR 묶음)
① **공용 파운데이션(PR-0)** 랜딩 → T02·T04 언블록. ② 로컬 세션·역할·담당범위(scope)·엔타이틀먼트 게이트. ③ 온보딩(조직 생성 + 정책자금 팩 설치 + 예시데이터) · 멤버/권한 화면. **구글 OAuth·RLS 실접속은 Supabase 연결 후(다음 웨이브)** — 지금은 dev-session + repo-레벨 scope로 동등 동작.

## 담당 파일
```
lib/types/index.ts            _FOUNDATION의 타입 그대로
lib/repo/index.ts             Repo 인터페이스 + getRepo()
lib/repo/local/{store,seed,localRepo}.ts   인메모리 + scope 필터 + 시드
lib/auth/session.ts           getSession() + dev 역할 스위처
lib/entitlements.ts           isEnabled(feature_key)
lib/presets/policyfund.ts     002 JSON 로드(board_columns→field_defs 전개 헬퍼)
lib/product.ts                PRODUCT_NAME
components/auth/FeatureGate.tsx        미보유 기능 자물쇠 UI
app/(auth)/login/page.tsx     "데모로 시작"(dev-session) + [구글 로그인=자리만]
app/(app)/onboarding/page.tsx 조직 생성 → 업종팩(정책자금) 선택 → 예시데이터
app/(app)/settings/members/page.tsx    멤버 목록·역할·초대(로컬 mock)
app/(app)/layout.tsx          사이드바(6기둥 순서) + 세션 가드
```

## 핵심 함수(시그니처 고정 — 공용 계약)
```ts
// lib/auth/session.ts
export function getSession(): Ctx & { name:string };     // dev 고정 + ?as= 스위처
// lib/entitlements.ts
export function isEnabled(key:string): boolean;
// lib/presets/policyfund.ts
export function installPolicyfundPreset(ctx:Ctx): Promise<void>;  // board_columns→field_defs, stages 생성
// lib/repo/index.ts
export function getRepo(): Repo;   // dev=localRepo
```
localRepo는 `_FOUNDATION`의 **scope 규칙**을 반드시 구현(member+assigned → 본인 것만). 이 규칙이 나중에 001 RLS(`is_org_member`·`org_role`·`org_scope`)와 1:1 대응.

## 화면 흐름(흐름 A)
로그인(`/login` "데모로 시작") → 세션 생김 → 조직 없으면 `/onboarding`(조직명 입력 → 정책자금 팩 선택 → `installPolicyfundPreset` → "예시 데이터 넣기") → 홈. 설정 → 멤버(역할 owner/admin/member 배정, 초대는 로컬 mock 행 추가). 미보유 모듈 메뉴는 `FeatureGate`로 자물쇠.

## 데이터/테이블(001)
`orgs`·`users`·`org_members`(role·scope) · `org_entitlements`(dev는 entitlements.ts로 대체) · `field_defs`(정책자금 프리셋 전개) · `stages`.

## 완료 판정(수용기준)
1. `npm run dev` → `/login` "데모로 시작" → 세션 생성 → 온보딩 → 홈까지 무한루프/에러 없이.
2. `installPolicyfundPreset` 후 `field_defs`에 계약상황·업종/업태·진행기관·진행상품 등이 생기고, stages 6개 생성.
3. `?as=member`로 보면 deals/companies가 **본인 담당만**(T02 보드에서 확인 가능) → scope 로컬 강제 동작.
4. `FeatureGate feature="mod.hometax"`가 자물쇠로 가려짐(Phase 2).
5. **T02·T04가 import하는 `lib/repo`·`lib/types`·`lib/auth`가 안정적으로 존재**(파운데이션 랜딩 완료). check.sh 초록.

## 하네스
브랜치 `feat/t03-foundation-org-*` · **파운데이션은 최우선 단독 선행 PR**(T02·T04가 대기 최소화하도록 인터페이스부터 빠르게 머지) · 워크로그·registry checkpoint · main 직접 금지.

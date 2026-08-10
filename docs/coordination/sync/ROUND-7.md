# SYNC Round 7 — 첫 업체·업무 영속 흐름 PR-2

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 트리거: `다음 계속 기획과 개발 해보자`  
> 상세 근거: `docs/worklog.md`의 `첫 업체·업무 영속 흐름 PR-2` 항목

## 1. controller·provider·GitHub

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| Claude provider | `exhausted / FROZEN_PROVIDER` |
| coordination writer | `MWC` 단독 |
| GitHub main | `639d629` |
| 선행 PR | Draft PR `#19` Workspace Bootstrap, all checks PASS |
| PR-2 branch | `feat/first-lead-flow` |
| PR-2 commit | `5daad68` |
| PR-2 GitHub | Draft PR `#20`, base `feat/workspace-bootstrap` |
| Production 반영 | 미실시 |

## 2. 작업 계약

| 구분 | 값 |
|---|---|
| WORK-ID | `MW-FIRST-LEAD-20260723` |
| 관련 이력 | T02 CRM + T03 Auth/Org foundation |
| stacked base | PR #19 commit `b28a5fa` |
| branch | `feat/first-lead-flow` |
| worktree | `moawork-wt-first-lead` |
| 구현 commit | `5daad68` |
| 변경 | 11 files, +921/-7 |
| code writer | 독립 DEV-1 세션 |
| T10 | 독립 세션 `PASS / PR CANDIDATE` |

금지 범위는 PR #18 로그인 UI, PR #19의 006 migration과 bootstrap 구현, 기존 001~005 migration, 정산·멤버초대·문서였다. commit·push·PR 작성은 구현과 T10 종료 후 MWC만 수행했다.

## 3. 구현 결과

- `/newcust`에 업체명과 선택 업무명을 받는 첫 업체 등록 폼을 추가했다.
- 성공 시 업체와 marketing 단계 deal을 만들고 `/newcust`를 revalidate한 뒤 성공 상태로 redirect한다.
- 새로고침 시 동일한 요청별 인증 Supabase source로 보드를 다시 읽어 생성 카드가 유지된다.
- `신규업체` 내비게이션을 기존 `/boards`에서 실제 `/newcust` 경로로 연결했다.
- Supabase 환경에서는 cookie가 연결된 SSR client를 요청마다 새로 만들고, Local 개발 환경에서만 기존 cached source를 유지한다.
- Local fallback도 같은 request UUID 결과를 재사용하며, company가 없는 불완전 결과는 중복 생성하지 않고 실패시킨다.

## 4. migration 007 계약

`007_first_lead.sql`은 `public.create_first_lead` RPC를 추가한다.

- `SECURITY DEFINER` + 고정 `search_path = public, pg_temp`.
- `auth.uid()`와 `org_members`로 호출자의 조직 membership을 함수 안에서 재검증한다.
- `PUBLIC`·`anon` 실행 권한을 회수하고 `authenticated`에만 실행 권한을 부여한다.
- `org_id`와 `assigned_to`는 클라이언트 입력이 아니라 `p_org_id`·`auth.uid()`로 고정한다.
- 조직+request UUID advisory transaction lock으로 동일 요청의 동시 submit을 직렬화한다.
- 기존 `_first_lead_request_id` 결과가 있으면 재사용한다.
- 기존 deal의 `company_id`가 null인 불완전 결과는 재생성하지 않고 명시적으로 실패한다.
- 기본 pipeline의 첫 marketing stage를 요구한다.
- company와 deal을 단일 PL/pgSQL 함수·트랜잭션 안에서 생성한다.

## 5. 검토 중 발견·조치

- 초기 server-source export가 index와 순환 의존성을 만들 수 있어 직접 import 경로로 정리했다.
- 기존 요청 deal에 company가 없을 때 새 업체를 반복 생성할 가능성을 차단하도록 SQL과 Local fallback에 불완전 결과 거부를 추가했다.
- 신규 폼의 임시 violet 표현을 중앙 브랜드 토큰 `mw-primary`, `mw-on-accent`로 교체했다.
- `boardData.test.ts`에 요청별 주입 source가 실제 조회 전부에 사용되는 회귀 계약을 추가했다.

## 6. 검증

| 검증 | 결과 |
|---|---|
| PR-2 targeted | 4 files, 24/24 PASS |
| lint/typecheck | PASS |
| app 전체 | 44 files, 503 PASS / 5 RLS skip |
| worker 전체 | 3 files, 14 PASS |
| Next production build | PASS, static pages 22/22 |
| `git diff --check` | PASS |
| T10 | `PASS / PR CANDIDATE` |

5개 RLS skip은 실제 DB 환경변수가 없는 기존 조건이다. 코드 완료와 실제 Supabase 운영 완료는 구분한다.

## 7. 환경 사건

- DEV와 MWC가 같은 PR-2 `node_modules`에서 `npm ci`를 겹쳐 실행해 부분 설치와 TAR ENOENT가 발생했다. 소스 결함과 분리하고 추가 설치를 중단했다.
- PR-1과 PR-2의 `package-lock.json` SHA-256이 동일함을 확인한 뒤, 검증된 PR-1 의존성을 PR-2에 재사용했다.
- junction 상태에서는 Vitest/esbuild sandbox와 Turbopack이 실제 경로·filesystem root를 거부했다. junction만 정확히 제거하고 같은 의존성을 실제 디렉터리로 복제했다.
- 실제 디렉터리 전환 후 전체 gate가 PASS했다. build의 Google Fonts 네트워크 차단은 허용 환경에서 재실행해 PASS했다.
- 의존성 디렉터리는 gitignore 대상이며 commit에는 포함되지 않았다.

## 8. GitHub·배포 게이트

- Draft PR [#20](https://github.com/bbelieff/moawork/pull/20)을 `feat/workspace-bootstrap` 기준 stacked PR로 생성했다.
- 최종 상태: mergeable, GitHub `check (lint + typecheck + test)` PASS(58초), GitGuardian PASS, Vercel Preview Ready, Preview Comments PASS.
- PR #18, #19, #20 모두 병합하지 않았다. Supabase migration과 Production 배포도 수행하지 않았다.

필수 순서:

1. PR #19 최종 검토와 병합 순서를 결정한다.
2. PR #20을 PR #19 위에서 검토하고, 필요 시 PR #19 병합 뒤 base를 `main`으로 전환한다.
3. Production DB에 `006_workspace_bootstrap.sql`을 먼저 적용한다.
4. 006 owner/member/동시 호출/backfill 실검증을 통과한다.
5. `007_first_lead.sql`을 적용한다.
6. 실제 authenticated member의 RPC, 동시 중복 submit, RLS 조직 격리, 새로고침 영속성을 검증한다.
7. 두 migration이 준비된 뒤에만 앱을 배포한다.

## 9. Claude 복귀 HANDOFF

Claude 복귀 시:

1. 이 ROUND-7과 최신 WORKLOG 항목을 먼저 읽는다.
2. GitHub main과 PR #18·#19·#20 상태 및 head SHA를 live 재조회한다.
3. PR #20이 PR #19 기반 stacked PR임을 유지한다.
4. 로컬 성공만으로 Supabase·OAuth·Production 완료를 주장하지 않는다.
5. migration 순서 `006 -> 007 -> app`을 변경하지 않는다.
6. 병합·migration·Production은 사용자 승인 전 수행하지 않는다.
7. 새로운 작업은 최신 ROUND에 controller·writer·lease를 기록한 뒤 시작한다.

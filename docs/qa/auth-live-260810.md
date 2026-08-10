# BBE-92 라이브 인증 진입 QA

> 실행: **모아워크 노트북 GT09(260810)**
> 기준: `origin/main@3cc8536e38b7aaa47b843fbfe8e445cecb0bba68`
> 실행일: 2026-08-11 KST
> 범위: Production 실제 로그인·모드 선택·워크스페이스 복귀, Preview OAuth
> 개인정보 원칙: 계정, 이메일, 고객사명, 실제 slug와 고객 데이터는 기록하지 않는다.

## 1. 결론

현재 Production 인증 흐름은 **PASS_WITH_PREVIEW_GAP**이다.

- 실제 Google OAuth 로그인 후 `/mode?next=%2F`의 관리자·사용자 선택 화면이 노출됐다.
- 관리자 모드는 `/platform`, 사용자 모드는 가입 회사가 2개 이상인 계정의 `/workspaces`로 이동했다.
- 회사 선택 후 `/w/{redacted}`로 진입했고 계정 메뉴에서 다시 관리자 모드로 돌아갔다.
- 브라우저 콘솔 경고·오류는 관찰된 전 구간에서 0건이었다.
- Preview OAuth는 안전한 Preview URL과 현재 allowlist 상태를 확인할 수 없어 아직 `NOT_RUN`이다. Production PASS를 Preview PASS로 승격하지 않는다.
- 신규 제품 결함은 발견하지 않았다. 기존 다중 회사 라우팅 관측은 BBE-89 범위와 일치한다.

## 2. 입력과 사전조건

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 전용 작업공간 | PASS | `codex/bbe-92-auth-qa`, 신규 worktree, 시작 시 clean |
| fresh base | PASS | 시작 후 원격 전진을 재측정해 `origin/main@3cc8536e38b7aaa47b843fbfe8e445cecb0bba68`로 재정렬 |
| 공급 목업 고정 | PASS | 248,693 bytes, SHA-256 `AA7829666BC8A1BCA4CB76E811A87C457D851080AD01CA7FE9548423E242E556` |
| 표준 목업 dump | NOT_RUN | current main에 `docs/design/dump-mockup.mjs` 없음 |
| 표준 목업 75항목 QA | NOT_RUN | current main에 `docs/design/qa-mockup.mjs` 없음 |
| 결정대장 D5/D6 | NOT_RUN | current main에 `docs/handoff/결정대장.md` 없음 |
| 목업 BBE-92 변경 | N/A | 전달된 작업 패킷상 이번 목업 수정 중 BBE-92 관련 변경 없음 |
| 의존성 설치 | PASS_WITH_RECOVERY | 일반 설치가 출력 없이 정지해 중단한 뒤, 동일 lockfile 격리 worktree의 의존성을 보충. tracked file 변경 0 |

## 3. Production 비인증 경계

| ID | 시나리오 | 기대 | 실측 | 판정 |
| --- | --- | --- | --- | --- |
| A1 | `GET /login` | `200`과 Google 로그인 진입점 | HTTP 200, 로그인 버튼 노출 | PASS |
| A2 | `GET /mode` | 원래 경로를 보존한 로그인 이동 | `307 → /login?next=%2Fmode` | PASS |
| A3 | `GET /platform` | 원래 경로를 보존한 로그인 이동 | `307 → /login?next=%2Fplatform` | PASS |
| A4 | `GET /workspaces` | 원래 경로를 보존한 로그인 이동 | `307 → /login?next=%2Fworkspaces` | PASS |
| A5 | `GET /auth/callback` without code | 인증 오류 로그인 이동 | `307 → /login?error=auth` | PASS |
| A6 | `GET /auth/signout` | POST 전용 | HTTP 405 | PASS |

## 4. 실제 인증 왕복

실측 계정과 조직 식별자는 문서에서 전부 비식별화했다.

| ID | 시나리오 | 실측 | 판정 |
| --- | --- | --- | --- |
| B1 | Production Google OAuth | 계정 선택과 콜백 완료 후 `/mode?next=%2F` 노출 | PASS |
| B2 | `/mode` 최초 진입 | 관리자·사용자 모드 선택 버튼 2개와 권한 비생성 안내 노출 | PASS |
| B3 | 관리자 모드 선택 | `/platform`, 운영 개요 화면 노출 | PASS |
| B4 | 관리자 화면의 사용자 모드 전환 | `/workspaces`, 다중 회사 선택 화면 노출 | PASS |
| B5 | 회사 선택 | `/w/{redacted}`, 본문과 앱 셸 노출 | PASS |
| B6 | 회사 화면 계정 메뉴의 관리자 모드 전환 | `/platform` 복귀 | PASS |
| B7 | 인증 후 `/mode` 직접 재진입 | 저장된 현재 모드인 `/platform`으로 이동 | OBSERVED |
| B8 | 전체 구간 브라우저 콘솔 | warning/error 0 | PASS |
| B9 | 현재 세션 로그아웃 POST | 미실행 | NOT_RUN |

## 5. Preview OAuth

| ID | 시나리오 | 판정 | 이유 |
| --- | --- | --- | --- |
| P1 | Preview `/login` 렌더링 | NOT_RUN | BBE-92 Preview URL 미생성 |
| P2 | Preview Google OAuth callback | NOT_RUN | Preview URL과 redirect allowlist 현재 상태 미확인 |
| P3 | 광범위한 `*.vercel.app` 허용 금지 | PASS_STATIC | BBE-92 계약 확인. 환경 변경은 수행하지 않음 |

Preview에서는 실제 배포 URL이 생긴 뒤 해당 URL만 대상으로 OAuth를 왕복한다. Supabase Site URL 변경, 광범위 wildcard 추가, 비밀값 조회·출력은 범위 밖이다.

## 6. 결함과 잔여 위험

- 신규 결함: 없음.
- BBE-89: 다중 회사 계정의 `/workspaces` 진입과 비인가·비멤버 라우팅 일관성은 기존 카드에서 추적한다. 이번 실측은 권한 있는 다중 회사 계정의 정상 진입만 증명한다.
- Preview OAuth: `NOT_RUN`. Preview 배포가 생긴 뒤 별도 증거가 필요하다.
- 사용자 유형: 이번 실행은 관리자 권한과 다중 회사 멤버십을 가진 단일 실제 계정만 검증했다. 일반 사용자 전용 계정과 0·1개 회사 계정은 `NOT_RUN`이다.
- 고객 데이터: 화면 진입 여부만 확인했으며 값·행·식별자는 수집하거나 기록하지 않았다.

## 7. 릴리스 게이트

| 게이트 | 상태 | 비고 |
| --- | --- | --- |
| 제품 코드 변경 | N/A | 변경 0 |
| 문서 diff | PASS | 신규 파일 1개만 존재, `git diff --check` 통과 |
| `scripts/check.sh` | PASS | lint·app/worker typecheck 통과, app 1,236 pass/9 skip, worker 31 pass |
| GitHub CI | PENDING | PR 생성 후 확인 |
| GT08 독립검수 | PENDING | exact 문서 SHA 기준 요청 |
| 1440px UI 증거 | N/A | UI 파일 변경 0 |
| 제품 배포·Production health | N/A | 문서 전용 변경. 기존 Production `/login` 200은 §3 증거 |

## 8. 롤백

이 변경은 신규 QA 문서 1개뿐이다. 철회가 필요하면 해당 문서 커밋을 revert한다. 제품 코드, Supabase, Vercel 환경, 고객 데이터에는 변경이 없다.

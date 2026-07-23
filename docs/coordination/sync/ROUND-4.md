# SYNC Round 4 — OAuth 조직 프로비저닝 장애 수정

> 작성: MoaWork Control(MWC) · 2026-07-23 KST
> 트리거: 프로덕션 Google 로그인 후 `login?error=provisioning` 재현

## 컨트롤러

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| claude provider | `exhausted / FROZEN_PROVIDER` |
| 구현 writer | `DEV-1` 역할의 전용 Codex worktree |
| 검수 gate | `T10` |

## 프로덕션 재현과 근거

- Google authorize, OAuth callback, 토큰 교환, `public.users` upsert, `app_admin_role()` 호출은 성공했다.
- 최초 조직을 찾는 `org_members` 조회도 정상 응답했으며 결과는 0건이었다.
- 이어진 `POST /rest/v1/orgs?select=id`만 403으로 실패했다.
- Postgres 오류는 `42501: new row violates row-level security policy for table "orgs"`였다.
- `orgs_insert` 정책은 인증 사용자의 INSERT를 허용하고, `trg_orgs_add_owner`와 SECURITY DEFINER 함수도 활성 상태였다.
- 비밀값, OAuth code, token, 사용자 ID는 이 기록에 남기지 않았다.

## 원인

콜백의 `insert(...).select("id").single()`은 삽입된 행을 표현 응답으로 돌려받기 위해 `orgs_select` RLS까지 평가한다. owner 멤버십은 AFTER INSERT 트리거에서 생성되므로, RETURNING 행의 SELECT 정책 평가와 멤버십 생성 순서가 충돌해 전체 INSERT가 롤백됐다.

## 구현 조치

1. 애플리케이션에서 조직 UUID를 먼저 생성한다.
2. `orgs`에는 `{ id, name }`만 삽입하고 표현 응답을 요청하지 않는다.
3. INSERT 성공 후 미리 생성한 UUID를 `mw_org` 쿠키에 사용한다.
4. 기존 RLS 정책과 owner 자동생성 트리거는 완화하거나 변경하지 않는다.
5. 콜백이 `.select()` 없이 UUID를 삽입하고 리다이렉트·쿠키를 설정하는 회귀 테스트를 추가한다.

## 현재 검증

- 대상 회귀 테스트: PASS (1/1)
- `scripts/check.sh`: PASS — app 472 passed / 5 skipped, worker 14 passed
- `npm.cmd run build -w app`: PASS — Next.js 16.2.10 프로덕션 빌드 및 22개 정적 페이지 생성
- `git diff --check`: PASS

## T10 및 운영 완료 조건

- [ ] 변경 범위가 OAuth 콜백, 회귀 테스트, 이번 ROUND·WORKLOG에 한정됨
- [ ] 비밀값·고객 데이터·OAuth code가 diff에 없음
- [ ] GitHub 필수 체크가 모두 PASS
- [ ] PR 병합 후 Vercel Production 배포가 Ready
- [ ] 동일 사용자로 Google 로그인을 다시 수행해 `/` 진입 확인
- [ ] 새 조직·owner 멤버십·`mw_org` 세션 지속 확인

현재 상태는 **코드 수정·로컬 검증 완료 / PR·배포·프로덕션 재검증 대기**다.

# 머지 경로 진단 — 로그인·공개 워크스페이스 진입 (MWC 초안)

> 실측 2026-07-27 · MWC(코워크) · canonical **읽기 전용** 조사(git 쓰기 0, 코덱스 무간섭)
> 목적: "코덱스가 다 만들었는데 배포가 안 됐다"가 사실인지 확인하고, **최단 머지 경로**를 제시.

---

## 결론 (3줄)

1. **코덱스 말이 맞다.** 코드는 전부 존재한다 — `feat/public-workspace-entry`에 **153파일 / +25,091줄**.
2. **문제는 코딩이 아니라 머지다.** main의 마지막 *코드* 커밋은 **07-22**. 이후 5일간 main에는 docs만 들어갔고, **모든 기능이 브랜치에 갇혀 있다.** 배포는 main→Vercel이므로 프로덕션엔 아무것도 반영되지 않았다.
3. **8개를 다 머지할 필요 없다.** `feat/public-workspace-entry` **1개**가 belie 요구를 거의 다 담고 있다.

---

## 1. 실측 데이터

### main 상태
```
main 최신:        e774a45 docs(sync): Codex 비상관제 인수 Round 2   (07-23)
main 마지막 코드:  6a57489 feat(T09) B4 정산 …                      (07-22)
→ 5일간 코드 머지 0건
```

### 브랜치별 미머지 커밋 (behind는 전부 0 = **main과 충돌 없음, 리베이스 불필요**)
| 브랜치 | 미머지 | 최종 |
|---|---|---|
| **feat/public-workspace-entry** | **8** | **07-27 17:29** |
| feat/public-workspace-entry-db | 9 | 07-27 15:48 |
| feat/public-workspace-entry-auth | 7 | 07-27 14:31 |
| feat/public-workspace-entry-ui | 6 | 07-26 17:18 |
| agent/p0-session-integration | 14 | 07-24 |
| agent/p0-authz-invite | 11 | 07-24 |
| feat/workspace-bootstrap | 8 | 07-24 |
| fix/oauth-org-provisioning | 3 | 07-23 |

### 스택 구조 (포함관계)
```
feat/public-workspace-entry-ui ──┬─ feat/public-workspace-entry-auth
                                 ├─ feat/public-workspace-entry-db
                                 └─ feat/public-workspace-entry   ★ 최신·최상위

feat/workspace-bootstrap ────────┬─ agent/p0-session-integration
                                 └─ agent/p0-authz-invite

fix/oauth-org-provisioning ────── 독립(3커밋)
```

### 왜 머지가 어려웠나 (형제 충돌)
8개 브랜치 **전부**가 같은 핵심 파일을 수정한다:
`app/src/lib/auth/session.ts` · `lib/auth/oauth.ts` · `app/auth/callback/route.ts` · `src/proxy.ts` · `lib/supabase/{client,server,env}.ts`
→ 형제 브랜치를 순차 머지하면 **2번째부터 충돌**. 이게 병목의 정체로 보인다.

---

## 2. `feat/public-workspace-entry`가 담고 있는 것 (belie 요구와 대조)

**belie 요구 ①「로그인 문제 해결」**
- `c1e8ffd feat(auth): complete Google OAuth and production guards (#15)`
- `639d629 fix(auth): 최초 owner 조직 프로비저닝 복구 (#17)` ← **MWC가 오늘 발견한 P0(역할 "확인 중" 고착)의 수정본으로 보임**
- `app/src/app/auth/callback/route.ts` 재작성 + `route.test.ts`

**belie 요구 ②「어떤 아이디든 워크스페이스 입장화면으로」**
- `app/src/app/workspace-entry/page.tsx` ← **입장 화면 본체**
- `app/src/app/workspaces/page.tsx` (워크스페이스 목록)
- `app/src/app/w/[slug]/route.ts` · `app/src/app/[alias]/route.ts` (진입 라우팅)
- `app/src/app/api/workspace-requests/route.ts` + `platform/workspace-requests/page.tsx` (가입 요청·승인)
- `351a530 feat(workspace-entry): add approved public entry flow`
- `172f007 feat(auth): route verified workspace memberships`
- `b79e63a feat(auth): apply Open Workspace login design (#18)`
- 부수: `account/`·`settings/account/{privacy,sessions}`·`AccountHub`

> 즉 **①②가 모두 이 브랜치 안에 있다.** entry-ui·entry-auth의 내용도 여기 포함(동일 제목 커밋).

---

## 3. 권고 머지 경로 (최단)

| 순서 | 대상 | 이유 | 비고 |
|---|---|---|---|
| **1** | **`feat/public-workspace-entry` → main** | belie 요구 ①② 전부 포함. behind:0이라 main 충돌 없음 | 머지 후 **Vercel 자동배포 확인** |
| 2 | `feat/public-workspace-entry-db` 고유 3커밋 | **보안 수정 포함** — `fix-public-entry-join-enumeration`(가입 열거 취약점), `fix-reserve-direct-alias-routes`(예약어 라우트) | cherry-pick 권장(형제 충돌 회피) |
| 3 | 나머지 5브랜치 | entry-ui/auth는 1에 흡수됨. `fix/oauth-org-provisioning`은 1의 `#17`과 동일 목적 → **중복 여부 확인 후 폐기 판단** | p0-*·workspace-bootstrap은 별도 스택, 후속 정리 |

**핵심 판단**: 형제 8개를 순차 머지하지 말고 **최상위 통합 브랜치 1개만 올린다.** 25k줄 단일 머지가 커 보이지만, 이미 브랜치에서 통합·테스트된 상태이고 대안(8회 충돌 해결)보다 안전하다.

---

## 4. 머지 후 검증 (MWC가 즉시 수행 가능)

- [ ] `www.moa-work.com/login` → 구글 로그인 → **`workspace-entry` 화면 진입**
- [ ] `user1@example.com`: 좌하단 **"회사 역할 확인 중" 고착 해소**, 오너 표기
- [ ] **다른 계정**(예: `user1@example.com`)으로도 로그인 → 입장/가입요청 화면 도달
- [ ] 사이드바 잠금(🔒) 해제 — 최소 MVP 메뉴 진입
- [ ] `core.dash` "Phase 2 잠김" 문구 소거
- [ ] 375px 무깨짐

---

## 5. 남는 의문 (코덱스만 답할 수 있음)

- 머지를 막고 있는 것이 **T10 게이트 판정**인가, **형제 충돌**인가, **belie 승인 대기**인가?
- `fix/oauth-org-provisioning`(3커밋)은 entry의 `#17`과 중복인가 별개 수정인가?
- p0-session-integration(14)·p0-authz-invite(11)는 entry 스택과 **같은 파일을 다르게** 고쳤다 — 어느 쪽이 정본인가?

---

> ※ MWC는 canonical에 **쓰기·git 명령을 일절 수행하지 않았다**(읽기 전용 조사). 실제 머지·배포는 코덱스 레인.

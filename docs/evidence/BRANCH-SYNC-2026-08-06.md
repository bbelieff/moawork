> ## ⏱ 2026-08-06 시점의 **기록물**이다
>
> 브랜치 동기화 당시의 상태를 남긴 증거 문서다. **지금 저장소 상태를 설명하지 않는다.**
> 2026-08-18 에 원 브랜치(#119)에서 이어받아 올렸다 — 그 사이 저장소는 여러 번 움직였다.

# BRANCH-SYNC-2026-08-06 — 뒤처진 브랜치 최신화 + 검증

> 실행 2026-08-10 · 세션: 모아워크 노트북CT작업반장(Claude Code)
> 방식: 전용 worktree(`클로드/wt-branchsync-ct`, origin/main 기준 신규 생성, 기존 활성 worktree 무간섭)에서
> 브랜치 하나씩 순차 처리. rebase 금지 · force-push 금지.

---

## 배정 목록 대조 (15건)

배정받은 15개 브랜치 중 **6개는 origin에 존재하지 않는다**(정확한 이름·유사 이름 모두 grep 0건).
로컬 전용으로만 존재했던 브랜치이거나, 이미 삭제된 것으로 추정된다. 실행 전 확인이 필요하다.

| 브랜치 | 상태 |
|---|---|
| docs/login-a-handoff-round5 | **origin에 없음** |
| agent/p0-session-integration | **origin에 없음** |
| agent/p0-authz-invite | **origin에 없음** |
| agent/p0-compat-app | **origin에 없음** |
| feat/c1-workspace-switcher-stack | **origin에 없음** |
| feat/monday-automation-surface | **origin에 없음** |

나머지 10개는 origin에 실존 확인 후 아래 절차대로 처리했다.

## 판정 표 (10건)

| 브랜치 | 머지 | typecheck | build | test | 판정 | 실패/보류 원인 |
|---|---|---|---|---|---|---|
| feat/codex-t03-oauth | 충돌(10파일, add/add) | N/A | N/A | N/A | **[보류]** | OAuth 구현이 origin/main에 이미 PR #15로 병합됨(동일 내용, 다른 SHA). 브랜치 자체가 중복/완료 상태 — sync 불필요, 브랜치 정리(삭제) 여부를 총괄이 판단해야 함 |
| docs/mwc-agents-round3 | 충돌(worklog.md 1파일, append 규칙대로 양쪽 보존 해소) | ✅ | ✅ | ✅ (app 1230 passed/9 skipped · worker 21 passed) | **[통과]** | — → [PR #117](https://github.com/bbelieff/moawork/pull/117) |
| feat/login-a-workspace | 충돌(3파일: login.module.css·page.tsx·login-ui.test.ts, 13헝크) | N/A | N/A | N/A | **[보류]** | 베이스 기능("Open Workspace 로그인 디자인")은 main에 PR #18로 이미 병합됨. 브랜치엔 그 위에 디자인 다듬기 커밋 3개(calm interactions·brand mark 확대 등)가 얹혀 있어 CSS 모듈을 자동 해소하면 배포된 스타일이 조용히 깨질 위험 — 디자인 오너 검토 필요 |
| feat/first-lead-flow | 충돌(6파일: layout·newcust·auth callback route+test·FeatureGate·nav-items) | N/A | N/A | N/A | **[보류]** | main은 엔타이틀먼트 해제 fix(#95)를, 브랜치는 워크스페이스 bootstrap 기능을 같은 파일들(FeatureGate 등)에 독립적으로 추가 — 실제 비즈니스 로직 충돌. 자동 해소 시 권한 게이팅 오동작 위험 |
| feat/workspace-bootstrap | 충돌(4파일: layout·auth callback route+test·FeatureGate) | N/A | N/A | N/A | **[보류]** | feat/first-lead-flow와 동일 원인(워크스페이스 bootstrap 커밋 공유) — 같은 엔타이틀먼트 vs bootstrap 로직 충돌 |
| feat/public-workspace-entry-db | 충돌(3파일: migration 006 + 테스트 2종, add/add) | N/A | N/A | N/A | **[보류]** | migration 006 본문은 거의 동일(예약 슬러그 2개 차이)하나, main은 그 위에 **007~009 마이그레이션을 3개 더** 쌓았고(브랜치는 모름), 테스트에서 심사 마감기한이 **main=14일 vs 브랜치=7일**로 실제 비즈니스 규칙 값이 상충. DB 마이그레이션 추측 해소 금지 원칙(F3/F4)에 따라 보류 |
| feat/c1-workspace-switcher-main | 충돌(6파일: layout·AccountMenu·SidebarNav·WorkspaceSwitcher×3, add/add 포함) | N/A | N/A | N/A | **[보류]** | WorkspaceSwitcher는 main에 이미 PR #31→#39→#70으로 더 진화된 형태로 병합됨. 브랜치는 초기 단일 커밋뿐 — 사실상 구형 중복 구현, 브랜치 정리 후보 |
| feat/account-platform-product | 충돌(2파일: settings/account privacy·sessions page) | ✅ | ✅ | ✅ | **[통과]** | main의 PR #111(BBE-100, 계정 개인정보 안내 쉽게 정리) 카피로 정리 — 브랜치 쪽 구버전(JSON 원본 노출) 폐기 → [PR #118](https://github.com/bbelieff/moawork/pull/118) |
| verify/mwc-r1-posthog | 충돌(4파일: .env.example·events.ts+test·useTrack.test.ts) | N/A | N/A | N/A | **[보류]** | PostHog 기능은 main에 이미 PR #53으로 병합되고 갭보정 fix(#55)까지 끝남. 브랜치 고유 커밋은 중복 feat 1개 + 내용 없는 chore 1개뿐 — 명백한 삭제 후보 |
| feat/developer-mode-ring-integration-t04 | 충돌(7파일: mode/page·AccountMenu.test·PlatformConsolePage·PlatformShell·release-rings resolve+test·supabase migration test, add/add 포함) | N/A | N/A | N/A | **[보류]** | 베이스 기능(developer mode/release rings)은 main에 PR #70으로 이미 병합. 브랜치엔 fixup 3개(mode preference endpoint 이동·slug 예약·테스트 정렬)가 더 있으나, release_rings Supabase migration 테스트까지 add/add 충돌이라 DB 관련 추측 해소 금지 원칙상 보류 |

## 요약

- **[통과] 2건** — docs/mwc-agents-round3(PR #117), feat/account-platform-product(PR #118). 둘 다 push 완료, PR 오픈.
- **[보류] 8건** — 전부 "머지 자체보다 판단이 필요"한 케이스. 크게 2가지 패턴:
  1. **베이스 기능이 이미 main에 다른 SHA로 병합된 중복 브랜치** (codex-t03-oauth · login-a-workspace · c1-workspace-switcher-main · verify/mwc-r1-posthog · developer-mode-ring-integration-t04) — 5건. 이 중 verify/mwc-r1-posthog · c1-workspace-switcher-main · codex-t03-oauth 는 브랜치에 남은 고유 가치가 사실상 없어 **삭제가 더 합리적**으로 보임. login-a-workspace · developer-mode-ring-integration-t04 는 위에 유의미한 fixup이 있어 디자인/도메인 오너 검토 후 재시도가 맞음.
  2. **main과 브랜치가 같은 파일을 각자 다르게 발전시켜 실제 로직이 충돌** (first-lead-flow · workspace-bootstrap · public-workspace-entry-db) — 3건. 특히 public-workspace-entry-db 는 심사 마감기한 7일 vs 14일이라는 **눈에 보이는 비즈니스 규칙 불일치**가 있어 총괄 확인이 시급.
- **[확인필요] 6건** — origin에 브랜치 자체가 없음. 배정 목록 출처 재확인 필요.

## 부산물

- 로그·증거 전용 브랜치 `docs/branch-sync-ct-log`(origin/main 기준)에 이 문서와 진행 BEAT를 기록. 앱 코드는 건드리지 않음.
- 통과 2건은 각각 원 배정 브랜치에서 직접 push + PR — 로그 브랜치와 무관하게 독립적으로 머지 가능.

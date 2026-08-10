# SYNC Round 24 — C안 `내 계정과 팀` 제품 구현

> 작성: MoaWork Control(MWC) · 2026-07-24 KST

## 사용자 결정

- 계정 화면 4안 중 C `내 계정과 팀`을 제품 기본 방향으로 확정했다.
- 이번 실행 범위는 실제 제품 구현, 자동·수동 검증, 독립 T10 검수, PR, 사용자 실화면 승인, merge, Vercel Production 배포와 `www.moa-work.com` read-back까지다.
- 디자인 선택은 끝났지만 실제 구현 화면을 merge 전에 시각적으로 확인하는 공통 게이트는 유지한다.

## 현재 원격 기준선

- GitHub `bbelieff/moawork` 기본 브랜치 최신 확인값: `639d629`.
- 열린 Draft PR: #18 로그인 UI, #19 Workspace bootstrap/006, #20 first lead/007.
- 계정 C 화면은 위 세 PR과 파일·계약 충돌을 먼저 확인하고 독립 `main` 기반 구현을 우선한다.
- 공유 조정 checkout은 문서 변경이 있으므로 제품 코드를 수정하지 않는다.

## 역할 배정

| 트랙 | WORK-ID | 실체 산출물 | 다음 소비자 |
|---|---|---|---|
| T01 / DEV-1 | `ACCOUNT-C-IMPLEMENT-01` | 독립 worktree의 제품 코드·테스트·commit | T08, T10, 사용자 |
| T02 | `ACCOUNT-C-INTEGRATION-GATE-01` | `docs/design/round-24/02-account-c-integration-gate.md` | DEV-1, T10, MWC |
| T04 | `ACCOUNT-C-PRODUCT-CONTRACT-01` | `docs/design/round-24/04-account-c-product-contract.md` | DEV-1, 사용자, T10 |
| T09 | `ROUND-24-ACCOUNT-C-COLLECTOR` | `docs/design/round-24/account-c-collector.md` | MWC, T08, T10 |
| T08 | 후속 배정 | 회귀·접근성·상태 테스트 결과 | T10 |
| T10 | 후속 배정 | 독립 코드·브라우저·배포 게이트 | MWC |

## 제품 계약의 상한

- 작은 조직의 첫 화면은 `내 정보`, `현재 회사와 팀`, `대표/팀장/사원`, `계정 보안`, `로그아웃`에 집중한다.
- Platform 1~4급, 지원 모드, 권한식은 일반 구성원 기본 화면에서 숨긴다.
- Owner의 회사 관리와 향후 고급 조직 설정은 점진적으로 노출한다.
- 실제 session, membership, profile 계약만 사용하며 가짜 운영 데이터나 동작하지 않는 버튼을 만들지 않는다.
- 전체 한글, 친절하고 짧은 UX 문구, MoaWork 브랜드 토큰, Light/Dark, 390px, 키보드·스크린리더·reduced-motion을 만족한다.

## 실행 게이트

1. DEV-1이 독립 worktree에서 구현하고 대상 테스트·`scripts/check.sh`·production build를 완료한다.
2. T08이 회귀/경계 검증을 수행한다.
3. T10이 diff, 실제 브라우저, 접근성, 숨은 다음 시퀀스를 독립 검수한다.
4. MWC가 실제 구현 화면을 로컬 URL로 사용자에게 열고, 동일 상태 전후 비교와 이해 확인 퀴즈를 제시한다.
5. 사용자 명시 승인 뒤 Draft PR을 merge-ready로 전환·merge한다.
6. Vercel Production 배포 성공과 `www.moa-work.com` 실제 route·로그인·계정 진입 read-back을 확인한다.
7. WORKLOG와 다음 ROUND에 commit/PR/merge/deploy 증거를 남긴다.

## HOLD

- 실제 구현 화면의 사용자 승인 전 merge 금지.
- T10 PASS 전 merge 금지.
- 운영 OAuth, 회원·권한, DB migration을 이 UI 작업의 편의 때문에 우회하거나 확장하지 않는다.
- 배포 성공 로그만으로 완료 처리하지 않고 공개 Production 화면을 다시 확인한다.

## 2026-07-24 실행 체크포인트 — 사용자 시각 승인 대기

- 구현 worktree: `moawork-wt-account-c`, branch `agent/account-c-screen`.
- 최종 로컬 후보: `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c` (`feat(account): add account and team hub`).
- 변경 범위: 20파일, 1,510 insertions / 27 deletions. 제품 코드·테스트·구현 영수증만 포함하며 migration·회원/profile write·모든 기기 로그아웃 성공·privacy write는 0건이다.
- 실제 구현: `/account` canonical redirect, `/settings/account` C안 허브, 상단 계정 메뉴, 회사·팀/세션/개인정보의 안전한 안내 route, 현재 기기 전용 로그아웃, Light/Dark·모바일·접근성 UI.
- P0 보강: `AccountHub` links 미전달 fail-safe, Platform role의 Workspace 역할 오표시 차단, sign-out 오류/throw 시 쿠키 미삭제와 오류 복귀.
- DEV 검증: targeted 14/14, lint, typecheck, `scripts/check.sh` app 486 pass/기존 RLS 5 skip·worker 14 pass, production build PASS.
- T08 실제 브라우저: `/account → /settings/account`, raw email 0·masked only, Platform 등급 0, 390px overflow 0, Light/Dark·메뉴·키보드 PASS. reduced-motion 실제 emulation은 도구 미지원 gap이다.
- T10 최종 SHA 재검수는 정적 범위·보안·targeted·전체 check·build까지 PASS했고 실제 화면 최종 판정을 진행 중이다. 로그아웃 실제 클릭은 브라우저 승인 요구로 수행하지 않고 final-SHA 회귀테스트에 묶는다.
- 사용자 확인 URL: `http://localhost:3037/settings/account`. 사용자가 실제 화면을 승인하기 전 PR·push·merge·Production 배포는 HOLD다.

## 2026-07-24 종료 체크포인트 — 승인·병합·Production 완료

- 사용자가 실제 C 구현 화면을 확인하고 `승인, 머지 배포해`라고 명시 승인했다.
- 원격 branch `agent/account-c-screen`을 push하고 PR [#21](https://github.com/bbelieff/moawork/pull/21)을 생성했다.
- PR head `4e69ec2b7434ba36f261ea1d01b4358ab8e4685c`에 대해 GitHub CI run #88과 Vercel Preview가 모두 성공했다.
- PR #21을 ready로 전환하고 expected head SHA를 잠근 squash merge를 실행했다. 원격 `main`은 `ade79e753ff4c99eab68b5a36bd8195245a6d57b`가 됐다.
- Vercel deployment `7zcsdMk4N88GxS8pme5AtZNGqyuB`를 실제 dashboard에서 확인했다: `Ready`, `Latest`, `Environment Production`, `Current`, domain `www.moa-work.com`, source `main@ade79e7`.
- 공개 `https://www.moa-work.com/account`는 정상 응답하고 비인증 브라우저를 `https://www.moa-work.com/login?next=%2Faccount`로 보호했다.
- 현재 인앱 브라우저에는 인증된 Production 세션이 없어 post-login C DOM을 운영 실증으로 과장하지 않는다. 동일 final SHA의 local actual browser, Vercel Preview, CI, exact SHA→Production binding, 공개 auth redirect를 완료 증거로 사용한다.
- Account C Safe Slice는 `MERGED / PRODUCTION_DEPLOYED`다. 전체 회원·세션 P0 완료를 의미하지 않는다.
- 다음 직렬 작업은 PR #19를 새 `main@ade79e7`에 rebase하고 AccountMenu를 보존한 뒤 006 migration/실DB/T10 gate를 다시 수행하는 것이다. PR #19의 운영 적용은 계속 HOLD다.

# SYNC Round 8 — 로그인 A안 디자인 v1.1

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 트리거: `로그인페이지 디자인개선 시작해`  
> 상세 근거: `docs/worklog.md`의 `로그인 A안 디자인 개선 v1.1` 항목

## 1. controller·GitHub

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| coordination writer | `MWC` 단독 |
| 대상 PR | Draft PR `#18` |
| branch | `feat/login-a-workspace` |
| 이전 head | `9d79290` |
| v1.1 head | `1b41a2c` |
| Production 반영 | 미실시 |

## 2. 시작 기준선

- 운영 `https://www.moa-work.com/login`은 중앙 단일 폼으로 인증 기능만 드러나고 브랜드 철학·제품 연상·신뢰 정보가 약했다.
- PR #18 A안은 62:38 분할, `흐름은 단단하게, 방식은 자유롭게` 문구, 네 업무 카드를 이미 구현했다.
- 1280×720과 1366×768에서 문서 스크롤 없이 CTA가 노출됐고, 390×844에서도 로그인 패널이 먼저 나왔다.
- 개선 목표는 레이아웃 교체가 아니라 `Moa · 모으다` 연상 강화, CTA 신뢰감, 접근성, 모바일 첫 viewport 유지로 한정했다.

## 3. 병렬 감사

시각 감사:

- 좌측 카드가 서로 독립적으로 보여 하나로 모이는 장면이 약했다.
- 로고가 작고 76px 제목은 다소 과했다.
- `Work Blue`, `Moa Violet` 같은 디자인 시스템 이름이 실제 제품 문맥을 깨뜨렸다.
- Google 버튼의 문자 `G`가 임시 UI처럼 보였다.

반응형·접근성 감사 1차 판정은 `조건부 FAIL`이었다.

1. CTA 기본 경계 대비 light 1.20:1, dark 1.17:1.
2. Tailwind `dark:`와 앱 `data-theme`가 엇갈릴 때 OAuth 오류색 대비 실패 가능.
3. 실제 링크가 아닌 약관 span이 밑줄로 링크처럼 보임.

반응형 배치 자체는 1440×900, 1366×768, 1280×720, 390×844 모두 PASS였다.

## 4. v1.1 구현

- 좌측 중앙에 심볼과 `하나의 워크스페이스 / 모든 업무 흐름의 중심` 허브를 추가했다.
- 네 카드는 허브를 중심으로 회전 -2°~2° 이내에 배치하고 연결선은 저채도로 낮췄다.
- 로고를 34px에서 42px로 키우고 제목 상한을 76px에서 66px로 절제했다.
- `자유롭게.`만 Moa Violet로 강조했다.
- 본문을 `고객·계약·정산은 한 흐름으로. 팀은 각자의 방식대로.`로 단축했다.
- 카드 카피를 `기록됨`, `자동 정리`, `한곳에 모임`, `함께 진행`으로 교체했다.
- 우측 중복 문장을 줄이고 `하나로 모으고, 자유롭게 일하세요`로 통일했다.
- 공식 4색 Google G SVG 자산을 추가하고 문자 `G`를 교체했다.
- CTA 경계는 `fg/card 50% color-mix`로 light 약 3.3:1 이상을 확보했다.
- hover 이동을 제거하고 `aria-busy`, `aria-live`, theme 기반 `text-mw-error`를 추가했다.
- login section을 `aria-labelledby`로 제목과 연결했다.
- 실제 URL이 없는 약관·개인정보 문구는 가짜 링크 스타일을 제거하고 plain text로 유지했다.
- 개발 계정 버튼에 focus-visible을 추가했다.

OAuth `safeNextPath`, Supabase `signInWithOAuth`, pending/error, callback, session은 변경하지 않았다.

## 5. 브라우저 QA

Production-mode 로컬 build로 검증했다.

| 화면 | 결과 |
|---|---|
| 1280×720 | 62:38, scrollHeight=720, scrollWidth=1280, 개발 계정 DOM 없음 |
| 390×844 | 로그인 패널 우선, CTA·보안 문구 첫 viewport, 수평 overflow 없음 |
| 390×844 `?error=config` | alert·CTA·보안 문구 동시 첫 viewport |

모바일 문서는 브랜드 story를 아래에 유지해 세로 스크롤은 존재하지만, 로그인 진행에는 스크롤이 필요 없다.

## 6. 검증·T10

| 검증 | 결과 |
|---|---|
| targeted login UI | 5/5 PASS |
| app 전체 | 39 files, 477 PASS / 5 RLS skip |
| worker | 3 files, 14 PASS |
| lint/typecheck | PASS, warning 0 |
| production build | PASS, static pages 22/22 |
| `git diff --check` | PASS |
| 독립 T10 | `PASS / PR CANDIDATE` |

T10 차단 결함은 없다. 실제 정책 URL이 확정되면 plain text를 semantic link로 바꾸는 항목만 비차단 후속으로 남겼다.

## 7. GitHub·운영 게이트

- commit: `1b41a2c` — `feat(auth): refine the Open Workspace login`.
- 변경: 5 files, +197/-79.
- branch를 push해 기존 Draft PR [#18](https://github.com/bbelieff/moawork/pull/18)을 업데이트했다.
- PR 본문도 v1.1 설계·접근성·검증 결과로 갱신했다.
- main merge와 Production 배포는 수행하지 않았다.
- 원격 최종 checks는 모두 PASS: GitHub `check (lint + typecheck + test)` 48초, GitGuardian, Vercel Preview Ready, Preview Comments.

## 8. Claude 복귀 HANDOFF

1. 이 ROUND-8과 최신 WORKLOG 항목을 먼저 읽는다.
2. GitHub PR #18 head가 `1b41a2c`인지와 checks를 live 재조회한다. 기록 시점 checks는 모두 PASS였다.
3. PR #18은 여전히 Draft이며 사용자 승인 전 merge·Production을 수행하지 않는다.
4. `/login`, `/login?error=config`, 실제 Google OAuth callback을 Production에서 별도 검증한다.
5. 정책 URL 확정 전에는 가짜 링크를 다시 만들지 않는다.
6. PR #19·#20의 migration-before-app 게이트와 로그인 UI 병합 순서를 함께 조정한다.

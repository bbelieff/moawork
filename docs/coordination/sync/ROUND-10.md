# SYNC Round 10 — 로그인 우측 상단 브랜드 심볼 확대

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 트리거: `메인화면 우측상단에 로고 더 키워줘`

## 1. 범위와 기준 상태

| 항목 | 상태 |
|---|---|
| 대상 | 로그인 A안 우측 로그인 패널의 브랜드 심볼 |
| 기존 PR | Draft PR `#18` |
| branch | `feat/login-a-workspace` |
| 시작 head | `20f541e` |
| 변경 head | `a50000b` |
| main merge·Production | 미수행 |

- 운영 화면 `https://www.moa-work.com/login`은 아직 기존 단일 로그인 화면이며, 이번 변경은 Draft PR Preview에만 반영한다.
- 화면 실검수에서 왼쪽 스토리 패널의 전체 MoaWork 락업과 우측 로그인 패널의 작은 컬러 심볼을 구분했다.
- 사용자 위치 표현과 일치하는 우측 로그인 패널 심볼만 확대하고 왼쪽 락업은 기존 42px을 유지했다.

## 2. 구현

- 우측 상단 `Symbol` 높이: `18px → 26px`.
- 심볼 배경 컨테이너: `26×26px → 38×38px`.
- 컨테이너 radius: `9px → 12px`.
- 심볼과 문구 간격: `9px → 11px`.
- 보조 문구 크기: `12px → 13px`.
- 헤드라인, Google CTA, 로그인 패널 너비, 좌우 62:38 비율, 애니메이션 규칙은 변경하지 않았다.

## 3. 시각·회귀 검증

- 로컬 1280px 화면에서 우측 심볼 확대 후 헤드라인과 CTA 위치가 유지되는 것을 스크린샷으로 확인했다.
- 좌측 워드마크는 기존 크기와 위치를 유지한다.
- targeted login UI: `7/7 PASS`.
- 전체 게이트: app `479 passed / 5 skipped`, worker `14 passed`.
- lint/typecheck: PASS.
- production build: PASS, static pages `22/22`.
- `git diff --check`: PASS.

## 4. GitHub·운영

- commit: `a50000b` — `feat(auth): enlarge login panel brand mark`.
- 기존 Draft PR [#18](https://github.com/bbelieff/moawork/pull/18)에 push했다.
- 원격 최종 checks는 모두 PASS: GitHub `check (lint + typecheck + test)` 53초, GitGuardian, Vercel Preview Ready, Preview Comments.
- 사용자 승인 전 main merge와 Production 배포를 수행하지 않는다.

## 5. Claude 복귀 HANDOFF

1. 이 ROUND-10과 최신 WORKLOG 항목을 읽는다.
2. PR #18 head가 `a50000b`인지, 원격 checks와 Vercel Preview가 PASS인지 live 재조회한다. 기록 시점에는 모두 PASS였다.
3. Preview에서 우측 상단 심볼 26px·컨테이너 38px을 시각 확인한다.
4. 사용자가 크기 확정을 하면 병합·Production 여부를 별도로 승인받는다.

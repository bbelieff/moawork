# SYNC Round 9 — 로그인 잔잔한 인터랙션

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 트리거: `로그인화면에 잔잔한 인터렉션도 있으면 좋겠다`  
> 상세 근거: `docs/worklog.md`의 `로그인 잔잔한 인터랙션` 항목

## 1. controller·대상

| 항목 | 상태 |
|---|---|
| active_controller | `codex : MoaWork Control(MWC)` |
| 대상 PR | Draft PR `#18` |
| branch | `feat/login-a-workspace` |
| 시작 head | `1b41a2c` |
| interaction head | `20f541e` |
| Production 반영 | 미실시 |

## 2. 디자인 원칙

- 자동 모션은 제품 구조 이해를 돕는 수준으로만 사용한다.
- 상승그래프, 패럴랙스, 큰 이동, 반복 부유, CTA 이동은 사용하지 않는다.
- Google CTA는 모션보다 항상 먼저 보여야 한다.
- 모바일 성능과 모션 민감 사용자를 우선한다.
- 레이아웃 속성 대신 opacity·translate·pseudo transform 위주로 애니메이션해 layout shift를 만들지 않는다.

## 3. 구현 강도

| 대상 | 동작 |
|---|---|
| 로고·브랜드 문구 | 0.56~0.62초 1회 진입 |
| 업무 카드 4개 | 0.64초 순차 진입 |
| 중앙 workspace core | 0.68초 1회 진입 |
| core outline | 5.6초의 약한 호흡 |
| 연결선 | 6.4초 저채도 호흡 |
| story glow | 12초 명암 변화 |
| 카드 hover | fine pointer에서만 최대 3px |
| CTA | 첫 프레임 상시 노출, 테두리·그림자 hover만 유지 |

620px 이하에서는 glow, flow, core pulse, secure dot 반복 모션을 모두 끈다. `prefers-reduced-motion: reduce`에서는 진입·호흡·이동 animation과 카드 transition을 모두 제거한다.

## 4. 브라우저 QA

- 1280×720에서 scrollWidth=1280, scrollHeight=720으로 기존 no-scroll를 유지했다.
- computed style로 story glow 12s infinite, flow 6.4s infinite, card reveal 0.64s 1회, core reveal 0.68s 1회를 확인했다.
- 390×844에서 glow/flow/core pulse/secure pulse가 모두 `animation-name:none`이었다.
- 모바일 첫 프레임 Google CTA의 opacity가 1임을 확인했다.
- 최초 초안은 CTA wrapper도 fade-in시켜 첫 프레임 버튼이 보이지 않았다. 즉시 제거해 핵심 인증 동작을 모션보다 우선했다.

## 5. T10 반려·수정

T10 1차 판정은 `FAIL / 수정 후 재검수`였다.

1. moduleCard 진입 animation의 `both`가 종료 후에도 `translate` 최종값을 소유해 hover lift를 막음.
2. reduced-motion 블록보다 fine-pointer hover selector 우선순위가 높아 모션 감소 상태에서 3px 이동이 다시 적용될 수 있음.

수정:

- 네 카드의 `cardReveal` fill-mode를 `backwards`로 변경해 delay 중 첫 프레임만 보존하고 종료 후 hover가 translate를 소유하게 했다.
- 카드 이동 hover를 `prefers-reduced-motion: no-preference + hover:hover + pointer:fine` 안으로 제한했다.
- Google 아이콘의 group-hover scale은 coarse pointer 기준이 부족해 제거했다.
- 계약 테스트가 네 카드 `backwards`, 정확한 hover media 조건, group-hover 부재를 검사하도록 강화했다.

재검수 최종 판정: `PASS / PR CANDIDATE`.

## 6. 검증

| 검증 | 결과 |
|---|---|
| targeted login UI | 6/6 PASS |
| app 전체 | 39 files, 478 PASS / 5 RLS skip |
| worker | 3 files, 14 PASS |
| lint/typecheck | PASS, warning 0 |
| production build | PASS, static pages 22/22 |
| `git diff --check` | PASS |
| T10 재검수 | `PASS / PR CANDIDATE` |

## 7. GitHub·운영

- commit: `20f541e` — `feat(auth): add calm login interactions`.
- 변경: 3 files, +122/-1.
- 기존 Draft PR [#18](https://github.com/bbelieff/moawork/pull/18)을 push로 업데이트했다.
- PR 본문에 모션 강도, 모바일·reduced-motion 정책, T10 반려·수정 이력을 추가했다.
- main merge·Production 배포는 수행하지 않았다.
- 원격 최종 checks는 모두 PASS: GitHub `check (lint + typecheck + test)` 53초, GitGuardian, Vercel Preview Ready, Preview Comments.

## 8. Claude 복귀 HANDOFF

1. 이 ROUND-9와 최신 WORKLOG 항목을 읽는다.
2. PR #18 head `20f541e`와 checks를 live 재조회한다. 기록 시점 checks는 모두 PASS였다.
3. Preview에서 첫 진입, 카드 hover, 모바일, OS reduced-motion을 실제 사용자 관점으로 다시 확인한다.
4. 모션 수치를 올리거나 CTA에 진입 지연을 다시 넣지 않는다.
5. 사용자 승인 전 merge·Production을 수행하지 않는다.

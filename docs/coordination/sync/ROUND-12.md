# SYNC Round 12 — MWC 가시적 세션 배정 구조 교정

> 작성: MoaWork Control(MWC) · 2026-07-23 KST  
> 트리거: `왜 너가 혼자 일하고 있어 세션들한테 시키라고 구조도 만들어놨는데`

## 1. 확인된 원인

1. 운영 프롬프트는 T01~T10을 역사적 식별자, 실제 코드 writer를 DEV-1~3이라고 구분했지만 사이드바에는 T01~T10 영구 세션만 존재하고 실제 DEV-1~3 thread는 0개였다.
2. MoaWork Worktree는 9개 존재하지만 `영구 T세션 ↔ DEV thread ↔ Worktree ↔ file lease` 연결 작업판이 없었다.
3. 이전 검수는 내부 임시 subagent를 사용해 사이드바의 영구 T10이 유휴로 보였다.
4. 최근 소규모 UI 수정에서 MWC가 DEV writer를 배정하지 않고 제품 코드를 직접 수정해 오케스트레이터와 구현자 역할이 합쳐졌다.
5. 사용자는 배정·진행·회수 상태를 볼 수 없었고, 시각 결과도 뒤늦게 전달됐다.

## 2. 이번에 실제 전달·회수한 세션

| WORK-ID | 관련 T | 담당 영구 세션 | DEV writer | thread ID | worktree | 상태 | 마지막 증거 | 다음 행동 |
|---|---|---|---|---|---|---|---|---|
| ORCH-AUDIT-01 | T01 | `!통합 T01(260721)codex` | 없음·READ-ONLY | `019f7fe4-f9ca-76a2-b6ad-5dca321f546e` | 전체 구조 읽기 전용 | DONE | 구조 감사 최종 보고 회수 | 운영 규칙 반영 |
| LOGIN-VISUAL-VERIFY | T10 | `!통합 T10(260721)codex` | 없음·VERIFY | `019f8056-311c-7402-81cd-247526ca457c` | `moawork-wt-login-a` 읽기 전용 | VISUAL_REVIEW_PENDING | T10 PASS, P0/P1 없음 | 사용자 시각 승인 또는 수정 지시 |
| LOGIN-UI-PR18 | 로그인 UI | MWC | 과거 MWC 직접 수정·정책 위반 | 현재 MWC thread | `moawork-wt-login-a` | VISUAL_REVIEW_PENDING | PR #18 head `a50000b`, checks PASS | 사용자 승인 전 merge 금지 |
| NEXT-UI-ITERATION | 관련 T 추후 지정 | 관련 영구 T세션 | DEV-1 예정 | 미생성 | 독립 Worktree 지정 | PARKED | 사용자 다음 지시 대기 | 지시 후 실제 DEV dispatch |

현재 나머지 T02~T09는 관련 배정이 없으므로 `PARKED`다. 모든 세션을 억지로 활성화하지 않는다.

## 3. T01 구조 감사 회수

- Worktree는 작업환경이지 작업자가 아니며, 담당 thread·WORK-ID 연결이 필요하다.
- MWC는 기획·계약·배정·추적·수집·통합·문서화만 담당하고 제품 코드 writer가 되지 않는다.
- 영구 T01~T09는 도메인 책임자·장기 문맥, DEV-1~3은 실제 writer, 영구 T10은 최종 검수자다.
- 내부 subagent는 사전 분석용이며 사이드바에 보이는 영구 T10을 대체하지 않는다.
- 상태판은 PARKED부터 DONE까지 명시하고 사용자에게 단계별로 진행을 보여 준다.

## 4. 영구 T10 시각 검수 회수

최종 판정: `PASS`, P0/P1 없음.

| 조건 | 결과 |
|---|---|
| 1280×720 | 전체 무스크롤, CTA 하단 308px |
| 390×844 | CTA 하단 336px, 수평 넘침 없음 |
| 320×568 | CTA 하단 275px, 즉시 노출 |
| reduced-motion | 실행 CSS에서 관련 애니메이션 차단 확인 |
| 다크모드 | 다크 토큰·SVG 전환 규칙 확인, 크기 변경과 독립 |

- 심볼은 18→26px, 배지는 26→38px로 선형 약 45%, 면적 약 2.1배 확대됐다.
- 우측 브랜드 표식→제목→CTA 위계가 유지되고 모바일 CTA가 밀리지 않았다.
- 비차단 P2: 향후 데스크톱·모바일·다크·reduced-motion 스크린숏 회귀 자동화 권장.
- 사용자 시각 승인은 별도이며 현재 `VISUAL_REVIEW_PENDING`이다.

## 5. 운영 프롬프트 교정

`01-MoaWork-Control-운영프롬프트.txt`에 다음을 추가했다.

- MWC 제품 코드 직접 수정 금지, 사용자 명시 승인 `MWC-HOTFIX`만 예외.
- 영구 T세션·DEV writer·T10·임시 subagent 역할 분리.
- 실제 DEV 전달과 수락 확인 전 `RUNNING` 선언 금지.
- 최신 ROUND 작업판 필수 열과 상태값 표준화.
- 배정·첫 체크포인트·리뷰 준비·시각 검수·T10 판정 시 사용자 가시 보고.
- 완료마다 문제·규칙 변경·다음 적용점을 회수하는 재귀개선 루프.

## 6. 다음 단계

- 현재 로컬 화면과 서버는 사용자 검수를 위해 유지한다.
- 사용자가 수정 지시를 주면 MWC는 먼저 수용 기준과 file lease를 작성하고 실제 DEV-1 Worktree thread에 전달한다.
- 구현 결과는 MWC가 회수해 로컬 화면을 갱신하고 다시 사용자에게 보여 준다.
- 사용자 시각 승인 뒤 영구 T10 검수와 merge 승인을 분리한다.

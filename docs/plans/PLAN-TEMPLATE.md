---
plan: PLAN-000            # 번호는 총괄이 발급 (기존 최대 번호 +1)
title: <한 줄 제목>
size: S | M | L           # 규약은 README.md
status: DRAFT             # DRAFT → APPROVED → DISPATCHED → IN_PROGRESS → DONE
foreman: <반장 세션 이름 | 없음(S는 생략)>
workers: [W1, W2]         # 독립 클로드코드 세션 라벨
linear: <카드 ID — 디스패치가 기입>
base_sha: <디스패치 회수 시점 origin/main SHA로 확정>
reviewer: <T10 | MWC>     # 작성자와 반드시 분리
visual: <목업 컨펌 일시 | 해당 없음>   # 비주얼 컨펌 게이트 — 규약은 README
created: <YYYY-MM-DD>
---

# PLAN-000 — <제목>

## 1. 목표·배경 (클라이언트 의중)

- 무엇을, 왜 만드는가. 성공하면 사용자 화면에서 무엇이 달라지는가 2~3줄.

## 2. 범위

- 포함: …
- 제외: … (이번에 하지 않는 것을 명시해 워커의 범위 확장을 차단)

## 3. 단계 매트릭스 (직렬 ↓ · 병렬 →)

| Stage | 병렬 트랙 | WO | blocked_by |
| --- | --- | --- | --- |
| 0 준비 | 단일 | WO-1 | - |
| 1 구현 | A ∥ B | WO-2 ∥ WO-3 | WO-1 |
| 2 통합 | 단일(반장) | WO-4 | WO-2, WO-3 |
| 3 검수 | 단일(reviewer) | 게이트 판정 | WO-4 |

## 4. 파일 소유(lease) 매트릭스 — PLAN 승인 시 일괄 lease

| WO | owner | 파일/디렉터리 | migration 소유 |
| --- | --- | --- | --- |
| WO-2 | W1 | `app/src/...` | X |
| WO-3 | W2 | `app/src/...` | O (1개 WO만) |

한 파일 1소유. 겹침 발견 시 이 설계도는 반려한다.

## 5. 작업지시서 (WO 카드 — 워커 세션에는 해당 블록만 복붙)

### WO-2 · <제목>

- task_id: `PLAN-000/WO-2` (Linear 하위이슈: <ID>)
- base SHA: frontmatter와 동일 · branch: `feat/plan000-wo2-<slug>` · 전용 worktree 필수
- owner: W1 · reviewer: <…> · blocked_by: WO-1 (선행 END 보고 확인 후 착수)
- 맥락: 이 WO가 전체 설계에서 갖는 위치와 의미 2~3줄.
- 할 일: 구체 작업 내용.
- acceptance criteria: 사용자 관점 판정 기준. "에러 없음"이 아니라 값·화면의 **긍정 확인**으로 쓴다.
- NOT_RUN 경계: hosted DB · 실로그인 · 실기기 등 이번에 검증하지 않는 범위 명시.
- DoD: `bash scripts/check.sh` 초록 + 아래 보고 양식 제출.
- 비주얼: UI 변화 시 스크린샷(1440 + 핵심 상호작용) 첨부. 판정은 검수자·총괄이 하며
  **belie 승인 대기 없음**(2026-08-09 자율 완주 정책). UI 무관 WO는 `해당 없음` 명시.
- 보고 양식(END): ① 결과 요약 ② 변경 파일 ③ 게이트 결과 ④ 스크린샷 ⑤ NOT_RUN ⑥ 다음 소비자.

### WO-3 · <제목>

(동일 구조 반복)

## 6. QA 계획

- 게이트: `check.sh` + focused test + production build 여부.
- 비주얼 컨펌 게이트: 설계 목업 컨펌 + merge 전 스크린샷 컨펌(README 규약).
- 독립검수: reviewer가 exact SHA 기준 판정. 작성자 자기검수로 Done 승격 금지.
- live QA 범위와 NOT_RUN 경계, `NOT_RUN`은 PASS로 바꾸지 않는다.

## 7. 디스패치 지시 (꼬리표)

1. `base_sha` 확정·기입 → 본 파일 커밋 → Linear 카드(+WO 하위이슈) 발행, status를 `DISPATCHED`로.
2. Stage 순서대로 WO 카드를 각 워커 세션에 전달. `blocked_by` 미해소 WO는 보류.
3. END 보고 수신 시 worklog 박제. 전체 완료 + reviewer PASS 시 status를 `DONE`으로.

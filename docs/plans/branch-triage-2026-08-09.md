# 브랜치·카드 3분류 판정 — 2026-08-09 (모아워크 데탑 C작업반장)

기준: `origin/main` = `cf1055d` (BBE-44 머지 반영) · 방법: `git cherry origin/main <브랜치>`(patch-id 동등 대조)
\+ `git ls-tree origin/main` 파일 실존 확인. **로컬 main은 낡아서 판정 근거로 쓰지 않았다.**

## 0. 소유권 원칙 (belie 확정 2026-08-09 · 최우선)

> **"코덱스가 할 일은 남겨놔"**

- `codex/*` 브랜치와 코덱스 구역 카드는 **CT(클로드) 재배정·인수·폐기 판정 대상이 아니다.**
- 상태는 정직하게 표기하되 사유는 **"코덱스 재개 대기"** 로 적고 **소유는 코덱스에 유지**한다.
- **예외(belie 개별 승인분 — "하던 거까지는 해")**: 이미 착수·완주한 인수 3건은 그대로 진행한다.
  - CT02 → BBE-5 (NO-OP 종결, 완료)
  - CT03 → BBE-44 (머지 완료, `cf1055d`)
  - CT04 → BBE-15 (확인 후 반납)
- 앞으로 새로 손대는 codex 자산은 **belie 개별 승인 없이 건드리지 않는다.**

## A. 이미 origin/main에 반영됨 — 정보용 (삭제 판단은 소유자 몫)

| 브랜치 | 카드 | 소유 | 근거 | 조치 |
| --- | --- | --- | --- | --- |
| `codex/bbe-5-mode-chooser-ui` | BBE-5 | **CT 인수(승인분)** | `0282df8` upstream 동등 | 완료 — 카드 Done 처리됨 |
| `codex/bbe-15-company-master-detail` | BBE-15 | **CT 인수(승인분)** | `95d229e` upstream 동등 | CT04 확인 후 반납 |
| `codex/bbe-work-monday-v1` | BBE-44 | **CT 인수(승인분)** | `cf1055d` 로 머지 완료 | 완료 |
| `codex/bbe-11-platform-shell-ui` | BBE-11 | 코덱스 | patch-id 1/1 반영 | **삭제 판단은 코덱스.** CT 손대지 않음 |
| `codex/bbe-24-ux-copy` | BBE-24 | 코덱스 | patch-id 1/1 반영 | 〃 |
| `codex/bbe-6-single-option-selection-flow` | BBE-6 | 코덱스 | patch-id 1/1 반영 | 〃 |
| `codex/bbe-platform-org-onboarding` | BBE-32 | 코덱스 | patch-id 1/1 반영 | 〃 |
| `codex/bbe-workspace-create-deadline-repair` | BBE-34 | 코덱스 | PR #91 머지 | 〃 |

## B. 코덱스 재개 대상 — 미반영, **CT 인수 금지** (5건)

| 브랜치 | 파일 | 카드 | 상태 |
| --- | --- | --- | --- |
| `codex/bbe-newcust-monday-board-v1` | 32 | BBE-26·27 | 08-03 정지. PLAN-002 WO-7이 이 브랜치를 기초로 통합 예정 → **통합 시점에 belie 승인 필요** |
| `codex/bbe-contact-pipeline-v1` | 0 | BBE-28 | 브랜치가 origin/main과 동일 = **산출물 0**. 계약만 존재 |
| `codex/bbe-25-workspace-shell` | 6 | BBE-25 | 잔여 fix |
| `codex/bbe-6-demo-crm-csv-modal` | 10 | BBE-6 | 데모 CSV |
| `codex/bbe-demo-workspace-shell` | 6 | BBE-25 | 25번과 중복 가능 — 대조는 코덱스가 |

## C. CT 완주 대상 — 클로드 세션 소유 (4건)

| 브랜치 | 파일 | 카드 | 담당 |
| --- | --- | --- | --- |
| `claude/plan002-wo1-structure-seed` | 11 | BBE-46 | CT05 작성 · CT02 검수 · PR #94 |
| `claude/plan002-wo2-newcust-ui` | 2 | BBE-47 | CT06 |
| `claude/bbe-17-notices-notify` | 12 | BBE-17 | CT02 검수 · PR #92 |
| `claude/bbe-8-hosted-inventory` | 2 | BBE-8 | 조사 증거 문서 |

## D. 신규 진행 (2건)

| 브랜치 | 카드 | 담당 |
| --- | --- | --- |
| `claude/ct01-p0-org-first-screen` (+1c/6f) | BBE-86 | CT01 |
| `claude/ct07-record-reform` (+1c/9f) | 기록 개편 | CT07 |

## 카드 상태 판정 (드레인 결과)

| 카드 | 상태 | 소유 | 사유 |
| --- | --- | --- | --- |
| BBE-5 | **Done** | CT02(승인 인수) | 잔여는 BBE-92로 분리 |
| BBE-44 | **Done** | CT03(승인 인수) | `cf1055d` 머지 |
| BBE-46 · 17 · 47 | In Progress | CT | 담당·다음 단계 확정 |
| BBE-26 · 27 · 28 · 29 · 31 | Backlog | **코덱스** | **코덱스 재개 대기** — CT 재배정 금지 |
| BBE-86 · 87 · 88 · 89 · 90 · 92 | Todo | CT | 신규 발행분 |

## E. 교차 사무소 조율 (belie ↔ 코덱스 직접 합의, 2026-08-09 회수)

코덱스 공식 확인: **BBE-44·BBE-15는 Claude 담당 유지** — "코드·브랜치·PR·Linear 상태 안 건드림,
충돌 없이 다른 대기 항목만 진행, Claude 완료 후 결과만 확인해 후속 연결".

- **CT03·CT04 레인 = 충돌 위험 0 확정.** 그대로 완주.
- **코덱스가 다시 가동 중이다.** "코덱스 재개 대기"로 분류한 카드들이 실제로 움직이기 시작할 수 있다.
  → 아래 겹침 감시표를 유지하고, 코덱스 착수 신호가 보이면 즉시 레인 판정한다.

### E-1. 현재 겹침 실측 (2026-08-09, origin/main `cf1055d` 기준)

**활성 브랜치 간 파일 겹침 = 0.** CT06(BBE-47)이 현재 `boards/` 2파일만 잡고 있어 아직 안 부딪힌다.

### E-2. 앞으로 부딪힐 지점 (선제 경고)

| 위험 | 코덱스 쪽 | CT 쪽 | 성격 |
| --- | --- | --- | --- |
| **높음 · newcust 본체** | BBE-26 `codex/bbe-newcust-monday-board-v1` — `components/newcust/**`, `lib/newcust/**`, `lib/boards/**`, `components/shell/nav-items.ts` (23파일) | BBE-47(CT06) — PLAN-002 WO-2가 **같은 `components/newcust/**`** 로 확장 예정 | 지금은 0이지만 CT06이 설계대로 진행하면 **정면 충돌** |
| **높음 · 마이그레이션 번호** | 코덱스 브랜치가 **026** 선점(낡음) | CT05가 **031** 사용, origin/main 최신 **030** | 코덱스가 026 그대로 푸시하면 **순서 역전·충돌**. 재개 시 **032+로 재부여 필요** |
| 중간 · 공용 nav | BBE-26이 `components/shell/nav-items.ts` 수정 | 향후 CT 탭 작업이 같은 파일 사용 | 공용부 — 단독 PR 원칙 적용 |
| 낮음 | BBE-28 contact, BBE-25 demo shell | 현재 CT 작업 없음 | 겹침 없음 |

### E-3. 감시·처리 규칙

1. 총괄이 라운드마다 `git diff origin/main...<브랜치> --name-only` 교차 비교로 겹침을 재측정한다.
2. 겹치면 **먼저 선언한 쪽 우선**, 나중 쪽이 비켜 다른 작업으로(대기 금지).
3. **PLAN-002 WO-2(CT06)가 `components/newcust/**` 로 확장하기 직전에 총괄에게 보고**한다.
   코덱스 BBE-26이 살아 있으면 그 시점에 belie 조정이 필요하다.
4. 코덱스가 BBE-26/27을 재개하면 **PLAN-002 WO-7(통합 릴리스)의 기초 브랜치 전제가 바뀐다** —
   WO-7 계약을 재작성해야 한다.
5. 마이그레이션 번호는 **머지 직전에 최신+1로 재확정**한다(선점 금지). 현재 예약: 031(CT05).

## 재발 방지

- 판정은 항상 `git fetch` 후 `origin/main` 기준. 중복 여부는 `git cherry origin/main <브랜치>`(접두 `-` = 반영됨).
- **소유자 확인이 판정보다 먼저다.** `codex/*` 자산에 대한 인수·폐기 판정은 belie 개별 승인 없이 하지 않는다.

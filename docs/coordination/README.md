# coordination — 트랙 조율 SSOT

여러 작업 세션(트랙)이 병렬로 moawork 를 만들 때 서로의 상태를 공유하기 위한 단일 진실 소스(SSOT).

> **2026-07-22 SYNC R1 개편**: `session-registry.yaml`·`dispatch-queue.yaml`·`provider-status.yaml` 폐기.
> 트랙 상태·규칙의 정본은 **최신 `sync/ROUND-N.md`** 다. 폐기 원문은 git 히스토리 참조.
>
> **2026-08-05 기록 개편**: **상태·이력은 Linear, 규칙·결정은 저장소 문서.**
> `decision-inbox.md`·`T02-repo-contract-review.md`·`T03-handoff-requests.md`·T10 판정 이력은 동결돼
> `docs/archive/` 로 이동했다. T10 **검수 기준부**는 `docs/plans/qa-gate.md` 로 이관.
> 이 디렉터리에 남는 것은 **`sync/ROUND-N.md` 와 이 README 뿐**이다.
> 근거·수치: `docs/plans/system-audit-2026-08-05.md`.

## 파일

| 파일 | 역할 | writer |
| --- | --- | --- |
| `sync/ROUND-N.md` | **정본**. 규칙·승계 변경 로그(계약 단일소유·승인기록·미해소 DQ) | 디스패치 |
| `README.md` | 이 문서 — SYNC 프로토콜·경계 규칙·ROUND 작성 규칙 | 디스패치 |

이동된 문서 (동결 · 열람 전용)

| 이동 후 | 이전 위치 |
| --- | --- |
| `../plans/qa-gate.md` (**기준부 · 살아있음**) | `T10-gate-checklist.md` §0~§4 |
| `../archive/T10-gate-checklist-history.md` | `T10-gate-checklist.md` §5~ |
| `../archive/decision-inbox.md` | `decision-inbox.md` |
| `../archive/T02-repo-contract-review.md` | `T02-repo-contract-review.md` |
| `../archive/T03-handoff-requests.md` | `T03-handoff-requests.md` |
| `../archive/worklog.md` | `../worklog.md` |

## SYNC 프로토콜 — 순환

```
코워크(두뇌·판정) → 디스패치(허브) → 코드트랙(실행) → 디스패치(종합) → 코워크(판정)
```

- 한 바퀴 = 1 라운드. 라운드 결과는 **`sync/ROUND-N.md` 로 박제**한다(덮어쓰지 않고 N 증가).
- 코드트랙은 디스패치와만 대화한다. 트랙끼리 직접 조율하지 않는다.

## ★ ROUND 작성 규칙 (2026-08-05 기록 개편)

ROUND 는 **규칙·승계 변경 로그**다. 상태 보드가 아니다.

| 적는다 | 적지 않는다 |
| --- | --- |
| 규칙 신설·개정·폐기 | 카드/이슈 **상태 스냅샷 복붙** (레인 배치·진행률·담당자 표) |
| 계약 단일소유·writer 이동 | 개별 작업의 START/END 서술 |
| 승인 기록(누가 무엇을 언제 승인했는지 1줄) | PR·커밋 목록 나열 |
| 미해소 DQ(결정 대기 항목) | Linear 에서 그대로 볼 수 있는 것 |

- **분량 목표: 30줄 이내.** 넘으면 상태를 적고 있다는 신호다.
- 상태는 쓰지 말고 **Linear 링크로 대체**한다.
- **안전장치**: Linear 는 외부 서비스다. 이슈를 **월 1회 이상 export** 해 보관하고,
  **규칙·핵심 결정은 유실 대비로 ROUND 에도 1줄** 남긴다.

## 디스패치(허브) 상설 역할

1. **`coordination` 유일 writer** — 트랙은 이 디렉터리를 직접 수정하지 않는다(T10 의 `T10-gate-checklist.md` 는 예외).
2. **git 브리지** — main clone 을 쥐고 문서 계층을 main 에 직접 반영한다.
3. **트랙 유일 대화 창구** — 배정·수집·종합.

## ★ 문서 / 코드 경계 규칙 (기획2 확정 2026-07-22)

| 대상 | 경로 | 절차 |
| --- | --- | --- |
| **문서** | `docs/coordination/**` | 디스패치가 **main 직접 커밋·push 허용** |
| **코드** | `app/`, `worker/`, `supabase/`, `scripts/`, 루트 설정 | **PR + T10 게이트 필수** |

코드 경로는 예외 없이 PR 로 간다. 문서 직접 push 는 디스패치 권한이며, 다른 트랙에 위임되지 않는다.

### `wip/*` 브랜치 규칙 (기획2 확정 2026-07-22)

| 항목 | 내용 |
| --- | --- |
| 용도 | **보존 전용**. 미추적·미완성 산출물이 사라지는 것을 막는다 |
| 게이트 | **pre-commit 우회 허용**(`--no-verify`). 컴파일 불가 상태여도 커밋한다 |
| 머지 | **main 머지 금지** |
| 승격 | 담당 트랙 재개 시 의존성·수정 보완 후 **정식 게이트 + PR** 로만 승격 |

`wip/*` 는 게이트를 통과하지 않은 코드다. 다른 트랙이 참조하거나 체크아웃해 빌드하지 말 것.

현재 브랜치:
- `wip/t03-oauth` — T03 구글 OAuth 플러밍 10파일(`lib/supabase/*`, `proxy.ts`, `auth/{callback,signout}`, `membership.ts` 등).
  **main 에 없는 기능**이며 `@supabase/ssr`·`@tanstack/react-query` 미선언으로 typecheck 실패 상태.

> **T10 주의**: 문서 직접 push 는 `check.sh` 가 마크다운/YAML **삭제를 잡지 못한다**.
> 커밋 전 `git diff --stat` 의 **deletions 를 반드시 확인**할 것(실제 사고 이력 있음 — 판정 이력 150줄 소실 후 복구).

## 진행 기록 규약 (2026-08-05 개편)

- 상세 진행 내역은 **해당 Linear 이슈의 코멘트**로 남긴다. 저장소에 진행 로그를 쌓지 않는다.
- 양식은 종전 워크로그와 동일하게 유지: 결과 · 파일 · 게이트 · NOT_RUN · 소비자.
- **END 코멘트 미작성 시 다음 배정을 보류**한다.
- 과거 워크로그는 [`../archive/worklog.md`](../archive/worklog.md) 에 동결 보존(열람 전용, 추가 금지).

## 공통 규칙

- 비밀값(키·토큰·비밀번호·연결 문자열)은 이 문서들에 **절대 기록하지 않는다**. 변수명만 적고 값은 `.env*`(gitignore).
- 트랙 정체성·활성/휴면 상태는 최신 `sync/ROUND-N.md` 를 따른다.

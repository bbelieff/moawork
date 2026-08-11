# AGENTS.md — moawork

이 문서는 `bbelieff/moawork`에서 작업하는 Claude·Codex 에이전트의 저장소 공통 규칙이다.
트랙 상태·controller·writer·file lease의 현재값은 이 문서에 고정하지 않고 최신 coordination 라운드에서 확인한다.

## 1. 정본과 작업 전 확인

- 코드 정본은 GitHub `bbelieff/moawork`다.
- `서울리드프로젝트/모아워크` 등 이름이 비슷한 로컬 폴더는 기획·과거 작업본일 수 있으므로 코드 정본으로 간주하지 않는다.
- 작업 전 `git rev-parse --show-toplevel`, remote, branch, status, worktree와 GitHub `main`·열린 PR을 독립 대조한다.
- 로컬 `main`이나 보고서의 SHA를 최신으로 가정하지 않는다. 확인하지 못한 값은 `unknown` 또는 `미검증`으로 기록한다.
- 다음 순서로 지침을 읽는다: `CLAUDE.md` → `docs/coordination/README.md` → 가장 번호가 큰 `docs/coordination/sync/ROUND-N.md` → `docs/worklog.md` → `docs/coordination/T10-gate-checklist.md` → 관련 설계·결정 문서.

## 2. 조정 정본과 역할

- 트랙 상태와 승계 규칙의 정본은 최신 `docs/coordination/sync/ROUND-N.md`다. 새 라운드는 번호를 증가시켜 추가하고 이전 라운드를 덮어쓰지 않는다.
- `session-registry.yaml`, `dispatch-queue.yaml`, `provider-status.yaml`은 SYNC-R1에서 폐기됐다. 과거 문서가 요구하더라도 다시 만들거나 조정 정본으로 사용하지 않는다.
- `docs/worklog.md`는 append-only 이력이다. 새 기록을 추가하되 기존 기록을 수정·삭제·재작성하지 않는다. END 기록이 없는 작업에는 다음 배정을 내리지 않는다.
- coordination writer는 동시에 한 명만 둔다. 구현 작업자는 `docs/coordination/**`를 직접 수정하지 않는다. 독립 검수자가 판정하는 `T10-gate-checklist.md`만 예외다.
- T01~T10은 역사적 작업·요구사항·검수 식별자로 유지한다. T번호를 에이전트 세션 수나 고정된 Codex 작업자 이름으로 해석하지 않는다.
- Codex 구현이 필요할 때만 범용 `DEV-1`~`DEV-3` 작업을 최소 개수로 만든다. 각 작업에는 관련 T번호, 기준 GitHub `main` SHA, 전용 branch/worktree, feature owner와 file lease를 명시한다.
- T10은 구현 트랙이 아니라 독립 검수·merge gate 역할을 우선한다. 가능한 경우 기능 작성자와 검수자를 분리한다.

## 3. Git·worktree 안전

- 공유 checkout에서 코드 작업하지 않는다. 실제 구현은 최신 `origin/main`에서 만든 전용 worktree에서 수행한다.
- 하나의 파일에는 한 명의 활성 writer만 둔다. 다른 작업자의 미커밋·미추적 파일을 수정·stage·삭제하지 않는다.
- 다른 작업자의 branch를 checkout, rebase, force-push, reset, clean, delete하지 않는다. `wt/` 같은 worktree 컨테이너도 stage·commit하지 않는다.
- `wip/*`는 유실 방지용 보존 브랜치다. 직접 수정하거나 `main`에 병합하지 않으며, 최신 정본 위의 새 feature branch에서 정식 게이트와 PR을 통과한 경우에만 승격한다.
- Supabase 스키마 변경은 새 migration으로만 추가하고 기존 migration은 수정하지 않는다.

## 4. 변경·검수·운영 경계

- 코드 경로(`app/`, `worker/`, `supabase/`, `scripts/`, 루트 설정)는 feature branch + PR + T10 검수를 거친다.
- coordination·worklog 문서는 활성 controller가 단독 관리한다. 커밋 전 `git diff --stat`과 삭제 행을 확인하고 의도하지 않은 축약·삭제가 있으면 중단한다.
- 커밋 전 `bash scripts/check.sh`를 통과한다. 필요한 경우 production build, DB/RLS, PR CI와 공개 서비스의 핵심 사용자 흐름까지 독립 검증한다.
- 코드 완료와 운영 완료를 구분한다. OAuth·Supabase·Vercel·외부 API는 환경변수 존재, provider 설정, callback, 실제 브라우저 흐름을 각각 확인한다.
- 사용자 로그인·동의·계정 선택이 필요한 단계는 대신 진행하지 않는다.
- 키·토큰·쿠키·비밀번호·OAuth 코드·연결 문자열·실제 고객 데이터는 출력·문서화·커밋하지 않는다. 설정 여부와 변수명만 기록한다.

## 5. 개발 명령

```bash
npm install
npm run dev
bash scripts/check.sh
```

---

# 6. 2026-08-09 운영 규약 (전 세션 자동 적용 · belie 확정)

이 절은 **모든 세션이 세션 시작 시 자동으로 적용**한다. 상세는 `docs/playbooks/` 참조.

## 6.1 세션명

```
모아워크 <노트북|데탑> <C|G>T<01~10|작업반장>     C=클로드 · G=지피티(코덱스)
서명: [모아워크 노트북 GT03(260809)]              공백 금지 · 몸버전 YYMMDD 필수
```

T번호는 **창 식별자일 뿐 전문분야가 아니다.** 구역은 착수 시 선언한 리스만 자기 것이다.
카드번호는 **`BBE-44(MoaWork)`** 처럼 프로젝트명을 병기한다(Linear 팀이 하나라 경영일지와 번호가 섞인다).

## 6.2 자율 완주 정책 — 가장 중요

- **머지와 배포까지 belie 승인 없이 진행한다.** "승인 대기"로 멈추지 않는다.
- belie에게 올리는 것은 **4가지뿐**: ①고객·수강생 실데이터 비가역 변경 ②돈·보안 ③정책 방향 전환 ④외부 발행.
- 유지 게이트: `check.sh` · CI · **독립검수(작성자≠검수자)** · 배포 관찰 + health 200.
- 문제가 생기면 **revert가 복구 수단**이다. 사전 허락이 아니라 사후 되돌리기로 안전을 확보한다.
- 같은 승인 게이트가 다시 생기면 skill issue가 아니라 **harness issue** — 규정 문서를 고친다.

## 6.3 실행 체인 (순서 고정)

```
① git fetch → 최신 origin/main 위 rebase (충돌 시 임의 해결 금지 · 중단 보고)
② bash scripts/check.sh 초록 → ③ push → ④ PR(본문에 카드번호) → ⑤ CI 초록
⑥ 독립검수(작성자≠검수자)
⑥′ 비주얼 — UI 변경 시 스크린샷(1440px) 첨부. **판정은 검수자·총괄, belie 대기 없음.**
    UI 파일이 없으면 자동 "해당 없음". Preview 로그인 불가 시 로컬 `npm run dev` 화면으로 갈음.
    촬영 불가는 머지 중단 사유가 아니다.
⑦ squash merge → ⑧ 배포 확인 → ⑨ https://www.moa-work.com/login 200 → ⑩ END 보고
```

## 6.4 소유권 — 공급자 레인 불가침

- `codex/*` 브랜치와 코덱스 구역 카드(BBE-26·27·28·29·31·30)는 **Claude가 인수·폐기하지 않는다.**
- `claude/*` 브랜치와 Claude 진행 카드는 **코덱스가 인수·수정하지 않는다.**
- **소유 확인이 판정보다 먼저다.** 넘어가려면 belie 개별 승인이 필요하다.
- `docs/coordination/**` 는 디스패치(MWC) 단독 소유.

## 6.5 마이그레이션 번호

새 파일로만 추가하고 **머지 직전 최신+1로 재확정**한다(선점 금지).
2026-08-09 기준 origin/main 최신 **030**, 031은 Claude 예약 → 코덱스 신규는 **032부터**.
`codex/bbe-newcust-monday-board-v1` 의 `026_*` 은 번호가 낡았다 — 재개 시 재부여 필요.

## 6.6 제품 규칙 (요약)

UI 어휘 "회사" · **아이템 = 탭 안의 그룹**(먼데이 API item과 다름, 코드명 `sectionPreset`) ·
프리셋 = 아이템 단위 구조 템플릿 · 기준 뷰포트 **1440px**(375/390px 검증 **면제**) ·
브랜드 토큰 하드코딩 금지 · PostHog US 리전 + 프록시 · 비밀값 출력·커밋 금지.

## 6.7 기록·도장

- 하트비트: Linear **BBE-75** 에 코멘트 추가(수정 아님). Linear MCP가 없으면 디스패치(MWC) 경유 —
  기록 생략은 없다.
- 착수: 카드 In Progress + `접수 — 세션명 · 브랜치 · base SHA · 리스 · 착수범위`
- 완주: Done + `완주 — PR #n → 머지 sha · 배포 확인 · health 200 · 검증 수치`

# 7. 역할별 지침

세션은 시작 시 자기 역할을 판별하고 해당 절을 따른다. 상세: `docs/playbooks/codex-roles.md`

| 역할 | 판별 | 핵심 |
| --- | --- | --- |
| **작업원** `GT01~GT10` | 카드 1장을 배정받아 구현 | 좁은 리스 선언 → §6.3 체인 완주. 막히면 그 건만 파킹하고 다음으로 |
| **작업반장** `G작업반장` | 워커 배분·레인 판정 | 겹침 감시(`git diff origin/main...<브랜치> --name-only` 교차), 먼저 선언한 쪽 우선. 구현하지 않는다 |
| **총괄** | 설계도·판정·검수 | 계약 발행, 소유·충돌 최종 판정, 머지 순서 관리. **git 쓰기 없음** |

공통: `docs/playbooks/worker-onboarding.md`(규칙 정본) · `thinking-protocol.md`(사고 5단계) 를 읽는다.
두 파일이 `origin/main` 에 없으면 워킹트리 사본을 읽고 **부재 사실을 보고**한다.

# MoaWork 전체 설계도 (BLUEPRINT) — 정본

> 작성: 2C(데스크탑-클로드) · 2026-08-05 KST · 근거: origin/main `0816d2a` 실측 + docs/plans/* + ROUND-34
> 성격: **설계도 정본(구조·상태·담당의 단일 원본)**. 여기가 원본, Linear는 이 구조를 미러링하는 운영판.

## 0. 정본 경계 (ROUND-34 승계)

- **이 문서(BLUEPRINT)** = 건물 전체 설계도. 층위·모듈·상태·담당의 원본.
- **GitHub `main` + PR + CI + exact SHA** = 기술 정본("완공"의 증명). Linear/문서 기록만으로 배포·live PASS 주장 금지.
- **Linear** (팀 `Bbelieff` `4145d122-d0b8-423a-8abe-73443f62b3b4` / 프로젝트 `MoaWork·운영 안정화 및 어드민` `20e7779b-19d7-42cb-91c6-3b68841b19ca`) = 작업 점유·의존성·검토·이정표의 운영판. 이 설계도를 이슈 계층으로 반영.
- **갱신 규칙**: 구조·상태가 바뀔 때마다 이 문서를 먼저 고치고 → Linear에 반영 → git SHA로 완공 대조.

## 1. 상태 범례

| 기호 | 뜻 | 완공 증거 |
| --- | --- | --- |
| ✅ 라이브 | origin/main에 머지·배포됨 | 머지 SHA / PR |
| 🟡 진행중 | 브랜치·PR 존재, 미머지 | 브랜치명 + ahead 커밋 |
| ⬜ 예정 | PLAN/카드에만 있음, 코드 없음 | PLAN WO / 카드 |
| 🐞 결함 | 라이브인데 버그 카드 대기 | 카드 |
| ⚠️ 대조필요 | PLAN 상태와 git 실측이 어긋남 | 아래 §7 |

## 2. 건물 층위 (아키텍처)

스택: **Next.js(app/) + Supabase(supabase/migrations) + Node worker(worker/)**. 모노레포 workspaces=[app, worker].

```
[10] 메트릭·분석      platform/analytics, api/cron/platform-metrics, lib/metrics, migration 014
[ 9] 알림·공지         notices, notify, api/notifications, migration 019
[ 8] CRM·프리셋·자동화  lib/crm, presets, automation-presets, policyfund, migration 002/026(예정)
[ 7] 보드 엔진         boards, deals, pipelines, board-views, custom-views, migration 003
[ 6] 사용자모드 탭      /work(업무) · /newcust(신규고객) · /companies(회사)
[ 5] 워크스페이스 셸    mode, workspaces, components/shell, migration 021/022
[ 4] 플랫폼·어드민 콘솔  platform/* (access·admins·organizations·demo·billing·support·system)
[ 3] 인증·멤버십·라우팅  (auth), auth, workspace-entry, [alias], w, migration 005~018
[ 2] 데이터·RLS·RPC     supabase/migrations 0001~025 (+026 cutover 예정)
[ 1] 인프라·배포        Vercel(app) + Supabase(hosted DB) + Node worker, scripts/check.sh 게이트
```

## 3. 층별 상태표

| # | 모듈 | 상태 | 근거 |
| --- | --- | --- | --- |
| 1 | 인프라·CI 게이트(check.sh, squash→main 자동배포) | ✅ 라이브 | 운영 중 |
| 2 | DB 스키마·RLS·RPC (migrations 0001~016) | ✅ 라이브 | main |
| 2 | migrations 017~025 hosted 적용 | ⚠️ 대조필요 | `claude/bbe-8-hosted-inventory` 검증 중 — hosted 반영 미확인 |
| 2 | migration 026 (신규고객 legacy cutover) | ⬜ 예정 | PLAN-002, `codex/bbe-newcust-monday-board-v1`에 초안 |
| 3 | 인증·로그인 | ✅ 라이브 | main |
| 3 | 멤버십·workspace-entry lifecycle | ✅ 라이브 | PR #91 `0816d2a` (생성신청 lifecycle 수리) |
| 3 | 비멤버·비인가 라우팅 계약 | 🐞 결함 | 카드 P2(§5) — 3종 처리 혼재 |
| 3 | 로그인 계정(이메일) 화면 표시 | 🐞 결함 | 카드 P1(§5) — 표시명만, 이메일 미표시 |
| 4 | 플랫폼 콘솔 네비게이션 | ✅ 라이브 | PR #81 |
| 4 | 플랫폼 고객 승인 연결 | ✅ 라이브 | PR #90 |
| 4 | 관리자 데모 워크스페이스(풀 셸 임베드) | ✅ 라이브 | PR #87/#89 |
| 4 | 데모 CRM import 경계 | ✅ 라이브 | PR #85, migration 025 |
| 4 | 멤버 목록 표시(승인자 오표시) | 🐞 결함 | 카드 P1(§5) |
| 4 | 조용한 실패 구분(권한없음 vs 장애) | 🐞 결함 | 카드 P2(§5) |
| 5 | mode 선택 UI(사용자/관리자 진입) | ⚠️ 대조필요 | PR #80 머지됨. PLAN-001 WO-1은 "미머지"라 주장 — git과 어긋남(§7) |
| 5 | 워크스페이스 셸·스위처 | ✅ 라이브 | migration 021/022, PR #87 |
| 6 | 업무 탭 `/work` (Monday식 보드) | 🟡 진행중 | `codex/bbe-work-monday-v1` +1 (work foundation+UX), 미머지 |
| 6 | 신규고객 탭 `/newcust` (Monday 보드) | 🟡 진행중 | `codex/bbe-newcust-monday-board-v1` +2, PLAN-002 대상 |
| 6 | 회사 탭 `/companies` 목록→상세 | ⚠️ 대조필요 | PR #82 머지됨. PLAN-001 WO-3은 "미머지" 주장(§7) |
| 7 | 보드 엔진(boards/deals/pipelines/views) | ✅ 라이브 | migration 003, api/* 라우트 |
| 8 | CRM·정책자금 프리셋 | ✅ 라이브(기초) | migration 002, lib/crm, policyfund |
| 8 | 신규업체 구조 시드(그룹 14종·프리셋 32종) | ⬜ 예정 | PLAN-002 WO-1 |
| 8 | 저장뷰 다중값 필터 / 복수 담당 / 자동 인계 / CSV | ⬜ 예정 | PLAN-002 WO-3~6 |
| 9 | 공지·알림(쓰기권한·게시창) | 🟡 진행중 | `claude/bbe-17-notices-notify` +1, migration 019, 미머지 |
| 10 | 플랫폼 메트릭(일간·cron) | ✅ 라이브 | migration 014/016, api/cron/platform-metrics |

## 4. 진행중 릴리스 트레인

### PLAN-001 — 사용자모드 탭 릴리스 트레인 (APPROVED, 4건 중 1 완료)

| WO | 내용 | 상태 | 브랜치 | 담당 |
| --- | --- | --- | --- | --- |
| WO-5 | 생성신청 lifecycle 수리 | ✅ 완료 | PR #91 `0816d2a` | Codex |
| WO-1 | mode 선택 UI | ⚠️ PLAN=미머지 / git=#80에 반영됨 | `codex/bbe-5-mode-chooser-ui`(0 ahead) | Codex |
| WO-2 | 업무 탭 | 🟡 진행중 | `codex/bbe-work-monday-v1`(+1) | Codex |
| WO-3 | 회사 목록→상세 | ⚠️ PLAN=미머지 / git=#82에 반영됨 | `codex/bbe-15-company-master-detail`(0 ahead) | Codex |

체인(각 WO): 최신 main rebase → `bash scripts/check.sh` → push → PR → CI → MW-QA 독립검수 → **belief 비주얼 컨펌** → squash merge → 배포 확인 → END.

### PLAN-002 — 신규업체 보드 완성 (APPROVED, 미착수)

base_sha = PLAN-001 WO-3 머지 후 origin/main. Stage1만 2트랙 병렬.

| WO | 내용 | 상태 | 담당 |
| --- | --- | --- | --- |
| WO-0 | 디스패치(base SHA·Linear 카드·하위이슈 7) | ⬜ 예정 | 디스패치 |
| WO-1 | 서울경영 3보드 구조 시드(아이템 프리셋 32종) | ⬜ 예정 | Codex |
| WO-2 | UI 공간 재설계(ui-guidelines 11원칙) | ⬜ 예정 | Codex |
| WO-3 | 담당자 탭·필터 뷰 | ⬜ 예정 | Codex |
| WO-4 | 복수 담당 배정 | ⬜ 예정 | Codex |
| WO-5 | 보드 간 자동 인계+활동로그 | ⬜ 예정 | Codex |
| WO-6 | 공용 프리셋 라이브러리·CSV | ⬜ 예정 | Codex |
| WO-7 | 통합 릴리스 | ⬜ 예정 | Codex |

## 5. 결함 카드 (Linear 발행 대기 · 4건)

| # | 우선도 | 제목 | acceptance |
| --- | --- | --- | --- |
| 1 | P1 | 로그인 계정(이메일) 화면 미표시 | 로그인 시 이메일 즉시 확인, 계정 전환 시 값 변경 |
| 2 | P2 | 비인가·비멤버 라우팅 비일관(3종 혼재) | 목적지·안내문구를 한 계약으로 통일 |
| 3 | P1 | 멤버 목록 표시 오류(승인자 "보호된 대표" 오표시) | DB 정상(owner=belief@toktokhan.dev), 화면 표기 수정 |
| 4 | P2 | 조용한 실패 구분(not_platform vs unavailable) | 오류코드 분리(`/?error=platform-unavailable`)+서버로그 |

> P0-1(관리자 화면 차단)은 2026-08-05 데스크탑 실측 **재현 불가** → 발행 보류. 정본: `_인수인계_MWC/P0판정결과_2026-08-05.md`

## 6. 담당자 배정판 (작업자)

**역할(근거 있음):**
- **Codex 세션** — `codex/*` 브랜치 소유. PLAN-001/002 모든 WO의 workers=[Codex].
- **Claude 세션** — `claude/*` 브랜치 소유(bbe-17 공지알림, bbe-8 hosted 검증).
- **MWC** — coordination sole writer(ROUND-34). Linear 상태·의존성·이정표 기록 담당.
- **MW-QA** — WO 독립검수 게이트.

**물리 에이전트 매핑(1g/2g/1c/2c) — belief 확정 필요:**
- 2c = 나(데스크탑-클로드), 2g = 데스크탑-지피티(Linear OAuth 도구 보유). 1c/1g = 노트북 측 추정.
- 어느 브랜치 prefix가 어느 물리 에이전트(1 vs 2)인지 **확정 근거 없음 → 추측 안 함.** belief가 매핑 지정하면 이 표에 박제.

| 트랙 | 현재 담당(역할) | 물리 에이전트 |
| --- | --- | --- |
| PLAN-001 WO-1/2/3 | Codex | TBD (belief 확정) |
| PLAN-002 전체 | Codex | TBD |
| 공지·알림(bbe-17) | Claude | TBD |
| hosted 검증(bbe-8) | Claude | TBD |
| Linear 운영판·발행 | MWC / 2G | 2G |
| 설계도·조율(이 문서) | 2C | 2C |

## 7. git 진척 대조 (완공 판정)

원칙: **Linear/PLAN = 계획, git SHA = 완공 증명.** 하나를 다른 하나로 말하지 않는다.

**현재 대조 미스매치(실측 2026-08-05, origin/main `0816d2a`):**
1. PLAN-001 WO-1(mode UI)·WO-3(회사 상세)는 PLAN 문서상 "미머지"지만, git은 `codex/bbe-5`·`codex/bbe-15` 모두 **origin/main 대비 0 커밋 ahead** = 내용이 이미 main(PR #80·#82)에 반영된 것으로 보임. → **PLAN-001 상태표 재확정 필요.** (실제 미머지인 건 WO-2 업무탭뿐일 수 있음.)
2. `codex/bbe-platform-org-onboarding`·`codex/bbe-24-ux-copy`도 동명 PR(#90·#84) 머지 완료 → 브랜치 stale, 정리 대상.
3. 로컬 main이 origin보다 **behind 1** — `0816d2a` 미pull.

대조 방법(정기): `git log origin/main..<branch> --oneline`으로 ahead 커밋 확인 → 0이면 "완공/머지됨", >0이면 "🟡 진행중".

## 8. 유지보수·Linear 미러링

- **이 문서 갱신**: WO 상태·SHA·담당이 바뀌면 여기부터 수정. 상태 스냅샷 남발 금지, 구조·상태 변화만.
- **Linear 반영 매핑**: §2 층위 → Linear 이정표(Milestone). §3/§4 각 행 → 이슈. 상태기호(✅🟡⬜🐞) → Linear status. §6 담당 → assignee.
- **완공 대조**: 이슈 close는 머지 SHA를 근거로만. CI통과≠merge≠배포≠실사용확인.
```

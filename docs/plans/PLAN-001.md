---
plan: PLAN-001
title: 사용자모드 탭(업무·신규고객·회사)·mode 선택 UI 릴리스 트레인
size: L
status: APPROVED         # 사용자(클라이언트) 승인 2026-08-04 00:33 KST — §4 lease 매트릭스 일괄 승인 포함
foreman: 없음            # 전 구간 직렬 릴리스 체인 — 순서 통제는 디스패치
workers: [Codex]         # 4개 브랜치 전부 Codex 세션 소유 — 타 세션이 브랜치를 만지지 않는다
linear: <디스패치 기입>
base_sha: <디스패치 회수 시점 origin/main으로 확정 — 2026-08-03 관측값 e937330>
reviewer: MWC
visual: 목업 제시 2026-08-04 · 2026-08-09 자율 완주 정책 — 스크린샷은 사후 증거물, 승인 대기 없음
created: 2026-08-03
---

# PLAN-001 — 사용자모드 탭 릴리스 트레인

## 0. 진행 현황 (2026-08-05 MW-총괄 실측 · origin/main `0816d2a`)

| WO | 상태 |
| --- | --- |
| WO-5 생성신청 lifecycle 수리 | **완료** — PR #91로 main 머지(`0816d2a`), hosted 적용도 확인됨 |
| WO-1 mode 선택 UI | 미머지 (브랜치 +1커밋 대기) |
| WO-2 업무 탭 | 미머지 (브랜치 +1커밋 대기) |
| WO-3 회사 목록→상세 | 미머지 (브랜치 +1커밋 대기) |

→ **4건 중 1건 완료.** 남은 3건은 디스패치 전달 즉시 착수 가능.
PLAN-002는 파일 lease가 겹치지 않아 **병렬 착수 승인됨**(2026-08-05 사용자).

## 1. 목표·배경

Codex가 2026-08-03 로컬 브랜치에 완성해둔 사용자모드 탭 구현(업무 `/work`, 신규고객 `/newcust`,
회사 상세 `/companies`)과 BBE-5 mode 선택 UI 수정이 **push·PR·CI·머지·배포 전부 미실행**이라
프로덕션에 반영되지 않았다. 정식 게이트를 거쳐 순서대로 라이브에 올린다.
성공 시 사용자모드에서 탭별 Monday식 보드가 실제로 보인다.

추가 증상(2026-08-03 사용자 관찰): 관리자가 새 회사를 만들어도 만들기 흐름으로 가지 않고 데모 조직만 보인다.
유력 원인은 ⓐ 018이 관리자 직접생성을 추가하며 009의 14일 기한을 누락해 **create 신청이 기한 NULL
pending으로 남아 관리자 큐에서 숨겨지는 결함**(migration 030 주석에 문서화됨) ⓑ hosted DB의
migration 017~025 적용 미검증(ROUND-34). WO-0 진단과 WO-5로 처리한다.

## 2. 범위

- 포함(4개): `codex/bbe-5-mode-chooser-ui`(+1c/3f) · `codex/bbe-workspace-create-deadline-repair`(+1c/2f, migration 030)
  · `codex/bbe-work-monday-v1`(+1c/14f) · `codex/bbe-15-company-master-detail`(+1c/6f)
- 이관: `codex/bbe-newcust-monday-board-v1`(+2c/32f, migration 026)은 **PLAN-002로 이관**
  (2026-08-04 사용자 지시 — 먼데이 구조 격차를 메운 뒤 릴리스).
- 제외(4개, PLAN-002 후보): `bbe-11-platform-shell-ui` · `bbe-24-ux-copy` · `bbe-6-demo-crm-csv-modal`
  · `bbe-25-workspace-shell` 잔여 fix
- hosted DB cutover 실행은 **화이트리스트(고객 실데이터 비가역 변경)** 에 해당 → belie 승인 유지. 그 외 머지·배포는 자율.

## 3. 단계 매트릭스 (직렬 ↓)

| Stage | WO | 내용 | blocked_by |
| --- | --- | --- | --- |
| 0 정합·진단 | WO-0 | 디스패치: base SHA·Linear 발행 + **hosted ledger(017~025)·숨은 pending 신청 실측** | - |
| 1 소형 | WO-1 | mode 선택 UI (BBE-5 해소) | WO-0 |
| 1 수리 | WO-5 | 생성신청 lifecycle 수리(migration 030) 코드 머지 | WO-1 |
| 2 탭① | WO-2 | 업무 탭 `/work` | WO-5 |
| 2 탭② | WO-3 | 회사 목록→상세 `/companies` | WO-2 |
| 3 조건부 | hosted 적용 | 030(+필요 시 017~025 정합) hosted 적용 → 숨은 신청 복구·승인 | WO-5 + 전제조건 |
| ~~3~~ 이관 | ~~WO-4~~ | 신규고객 탭은 PLAN-002(구조 격차 해소+UI 재설계)로 이관 | - |
| 4 검수 | - | MWC 통합 production QA | 각 단계 직후 |

준비(rebase·gate)는 병렬 가능하나 **머지는 위 순서로만** 한다. 각 브랜치 base가 서로 달라
(afcfa754 / 2532f2d2 / 3b27483c) 매 머지 후 다음 브랜치는 최신 main 위 rebase가 필수다.

## 4. 파일 소유(lease) 매트릭스

| WO | owner | 파일/디렉터리 | migration |
| --- | --- | --- | --- |
| WO-1 | Codex | `app/src/app/mode/*` (3f) | X |
| WO-5 | Codex | `supabase/migrations/030_workspace_entry_create_deadline_repair.sql` + 동반 test 1f | O (030) |
| WO-2 | Codex | `app/src/app/(app)/work/*`, `components/work-management/*`, `lib/work-management/*`, `lib/repo/supabase/workManagementSource*` | X |
| WO-3 | Codex | `app/src/app/(app)/companies/*`, `components/company/*` | X |
| WO-4 | Codex | `app/src/app/(app)/newcust/*`, `components/newcust/*`, `lib/newcust/*`, `lib/boards/*`, `components/shell/nav-items.ts`, `lib/repo/supabase/{index,liveBoards,newcustLegacyMigrationSource,supabaseBoardsSource,supabaseCrmSource}*`, `lib/crm/http*`, `lib/custom/field-types.ts` | O (026) |

WO 간 파일 겹침 0 확인(2026-08-03). 단 WO-4는 공유 모듈(shell nav·boards·crm source)을 만지므로
반드시 마지막에, 최신 main 위 rebase 후 진행한다.

migration이 2건(030·026)이지만 직렬 머지이므로 허용한다. 단 현재 main 최신이 025이고 026~029가
비어 있으므로, **각 migration은 머지 시점의 최신+1 연번으로 재부여**하고 파일명·참조를 함께 갱신한다.

## 5. 작업지시서 (공통 체인 + WO별 조건)

**공통 체인(각 WO 동일)**: ① 최신 `origin/main` 위 rebase(충돌 시 중단·보고) → ② `bash scripts/check.sh` 초록
→ ③ push → ④ PR 생성 → ⑤ CI 초록 → ⑥ MWC 독립검수
→ ⑥′ **비주얼 확인(검수자·총괄 판정)** — 스크린샷(1440 + 핵심 상호작용) 첨부. **대기 없음.**
   UI 파일이 없는 WO는 `해당 없음`으로 자동 갈음. Preview 불가 시 로컬 dev 화면으로 갈음
→ ⑦ squash merge → ⑧ Vercel Production 배포 확인 → ⑨ README 보고 양식으로 END 제출. 게이트 실적이 워크로그에 없으므로 "이미 검증됨"으로 가정하지 않는다.

### WO-1 · mode 선택 UI 수정 (BBE-5)
- branch `codex/bbe-5-mode-chooser-ui` · task_id `PLAN-001/WO-1` · owner Codex · reviewer MWC · blocked_by WO-0
- 맥락: ROUND-34에서 BBE-5 = FAIL(선택지가 일반 텍스트처럼 보임) 판정. 이 릴리스가 Linear 대기열 선두를 해소한다.
- acceptance: `/mode?next=%2F` 두 선택지가 버튼으로 인지됨(배경·테두리·hover·focus·pointer), 390px 정상, console 0.

### WO-5 · 새 회사 생성신청 lifecycle 수리 (migration 030)
- branch `codex/bbe-workspace-create-deadline-repair` · task_id `PLAN-001/WO-5` · owner Codex · reviewer MWC · blocked_by WO-1
- 맥락: 018이 관리자 직접생성을 추가하며 009의 14일 기한을 누락 → create 신청이 기한 NULL pending으로
  남아 관리자 큐에서 숨겨짐. "새 회사를 만들어도 데모만 보이는" 증상의 유력 원인.
- 할 일: 공통 체인으로 코드 머지(파일 2개). 머지 시 migration 번호를 최신+1로 재부여.
- acceptance: check.sh 초록 + 마이그레이션 테스트 PASS.
- **2026-08-05 갱신**: hosted에는 이미 적용 확인됨 — `schema_migrations`에 `20260803113208
  workspace_entry_create_deadline_repair` 기록, pending 신청 2건의 검토기한도 정상 존재.
  따라서 이 WO의 남은 일은 **저장소 파일 정합(머지·번호 재확정)뿐**이며 hosted 적용 단계는 완료로 본다.

### WO-2 · 업무 탭 `/work` 첫 진입
- branch `codex/bbe-work-monday-v1` · task_id `PLAN-001/WO-2` · blocked_by WO-5
- acceptance: 사용자모드 `/work`에서 Monday식 보드 렌더·기본 편집 동작, console 0, 390px.
- 필수 사전확인: `rpc-contract.ts`·`workManagementSource`가 요구하는 테이블/RPC가 **hosted에 실존**하는지 검증.
  없으면 merge 중단하고 HOLD 보고(스키마 선행 필요 여부 판단은 총괄·사용자 몫).

### WO-3 · 회사 목록→상세 `/companies`
- branch `codex/bbe-15-company-master-detail` · task_id `PLAN-001/WO-3` · blocked_by WO-2
- 맥락: base(2532f2d2)가 오래됨 — rebase 충돌 가능성 가장 높은 WO. 충돌 시 임의 해결 말고 보고.
- acceptance: 회사 목록에서 상세 진입·복귀, scope 격리(타 회사 데이터 비노출), console 0, 390px.

### WO-4 · [PLAN-002로 이관] 신규고객 탭 `/newcust` + legacy cutover
> 2026-08-04 사용자 지시로 PLAN-002에 통합. 아래 내용은 PLAN-002 WO의 기초 자료로 참조만 한다.
- branch `codex/bbe-newcust-monday-board-v1` · task_id `PLAN-001/WO-4` · blocked_by WO-3 + 아래 전제조건
- **전제조건(모두 충족 전 merge 금지)**: ⓐ hosted 백업/복구 경로 승인 ⓑ migration ledger(017~025) 적용상태
  확인 — ROUND-34 기준 `NOT_RUN/미검증` ⓒ 026 번호가 여전히 최신+1인지 재확정 ⓓ cutover 대상(001 CRM) 스냅샷.
- acceptance: 신규고객 탭 Monday식 보드 렌더 + cutover 게이트 UI 정상. **cutover 실행 자체는 이 PLAN 밖** —
  cutover 실행만 belie 승인(화이트리스트). 나머지는 자율 완주.

## 6. QA 계획

- 각 WO: check.sh + CI + MWC 독립검수(작성자 Codex와 분리, exact SHA 기준).
- 비주얼: 검수자·총괄 판정(README 자율 완주 정책). 스크린샷은 사후 증거물.
- 각 머지 후: MWC production QA — 사용자모드 실진입, 해당 탭 실데이터 렌더, 390×844 무가로오버플로, console 0
  (BBE-32 QA 패턴). PASS 시에만 다음 WO 머지.
- NOT_RUN 경계: 모바일 실기기, hosted cutover 실행, 실고객 데이터 시나리오. `NOT_RUN`은 PASS로 승격하지 않는다.

## 7. 디스패치 지시 (꼬리표)

1. `docs/plans/` 규약 신설(README·TEMPLATE·본 문서)을 다음 ROUND에 채택 박제 후 문서 커밋.
2. `base_sha` 확정 기입 → Linear 카드 1장 + WO 하위이슈 5장 발행(BBE-5 기존 카드는 WO-1에 연결, 새 카드 금지) → status `DISPATCHED`.
2-1. **WO-0 진단**: authorized DB read로 ⓐ hosted migration ledger — 017~025 적용 여부 ⓑ `workspace_entry_requests`의
   pending·`review_expires_at IS NULL` 건수(관리자 큐에서 숨은 신청) 실측 보고. 고객 데이터 내용은 출력 금지, 건수·상태만.
3. WO-1부터 순서대로 전달. `blocked_by` 미해소 WO만 보류(선행 END 확인). cutover는 화이트리스트 승인 대상.
3-1. 비주얼 확인은 검수자·총괄이 판정한다. belie receipt를 기다리지 않는다(2026-08-09 자율 완주 정책).
4. 각 END 보고를 worklog에 박제, 전체 완료 시 status `DONE`.

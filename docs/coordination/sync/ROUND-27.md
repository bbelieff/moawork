# SYNC Round 27 — actual Codex T-session routing fail-closed

> 작성: T06 appointed foreman · 2026-07-25 KST
> WORK-ID: `ROUTING-ANTI-CONFUSION-01`
> 기준: GitHub `main@b79e63a5a22c636538fe99b13e56c4b16295d58d` + 직전 로컬 SSOT `ROUND-26.md@53A5A6625D197357943891C307C75C33EEFE6F6FB8065CF0042D3BDEFE3B5473`
> 최종 판정: `COMPLETE_TO_DESIGNER / INDEPENDENT_ACTUAL_T_REVIEW_PASS`

## 1. 결과

MoaWork/CFC/Claude의 로컬 운영 지침에서 작업반장·작업원을 내부 subagent로 오인하게 하던 활성 경로를 제거하거나 교체했다. 공식 운영 체인은 다음 하나다.

`DESIGNER → 실제 영속 T APPOINTED_FOREMAN → 실제 영속 T WORKER → (선택) INTERNAL_SUBAGENT_ONLY → WORKER 회수 → FOREMAN_REVIEW → 동적 실제 T 독립 검수 → DESIGNER`

- `FOREMAN_ASSIGNED`, `WORKER_ASSIGNED`, `DISPATCHED`는 실제 `threadId/title/host/status`, 성공한 `send_message_to_thread` receipt, ACK/RESULT가 모두 있을 때만 성립한다.
- 증거가 없으면 `NOT_DISPATCHED`다. `spawn_agent`, `subagent`, agent tree는 공식 작업반장·작업원·검수자 배치 증거가 될 수 없다.
- T01~T10은 고정 직책이 아니라 세션 주소·작업 이력 식별자다. T10 검수 게이트 명칭은 호환 식별자로만 유지하고 실제 독립 reviewer는 충돌 없는 T 세션을 동적으로 배정한다.
- 실제 T 작업원의 읽기 전용 조사는 의미 있는 artifact, 검증, 소비자와 다음 write/decision이 연결돼야 유효하다.

## 2. 상태 전이와 실제 T receipt

| 단계 | 실제 T / threadId | receipt·artifact | 판정 |
|---|---|---|---|
| `FOREMAN_ASSIGNED` | T06 / `019f8053-5d2e-7910-b2e8-dcf0117a4ff9` | controller가 이번 BLUEPRINT의 appointed foreman으로 직접 배정 | PASS |
| `T_WORKERS_ASSIGNED` | T07 / `019f8055-3d2a-7f11-a5a9-5bfa7b36da1c` | 실제 thread dispatch와 동일 T recovery receipt; `T07-instruction-inventory.md` | PASS / RELEASE |
| `T_WORKERS_ASSIGNED` | T03 / `019f7fe5-9278-7f61-9d4a-698fcd476303` | 실제 thread dispatch와 동일 T recovery receipt; `T03-routing-validator-design.md` | PASS / RELEASE |
| `INDEPENDENT_T_REVIEW` | T08 / `019f8055-62e4-7e63-8767-2da2d66ef3ad` | 초기 FAIL과 3회 rework 결과를 반환; 네 번째 검수 중 두 번째 `systemError` | `RELEASED_DUE_TO_EXECUTION_ERROR` |
| replacement `INDEPENDENT_T_REVIEW` | T01 / `019f7fe4-f9ca-76a2-b6ad-5dca321f546e` | dispatch 반환 `{"threadId":"019f7fe4-f9ca-76a2-b6ad-5dca321f546e"}`; `REVIEW_PASS` 반환 후 RELEASE receipt 동일 threadId | PASS / RELEASE |

상태머신은 `DESIGN_READY → FOREMAN_ASSIGNED → T_WORKERS_ASSIGNED → WORKER_ACTIVE → RESULT_RETURNED → FOREMAN_REVIEW → REWORK → INDEPENDENT_T_REVIEW → COMPLETE_TO_DESIGNER`로 실제 증거와 함께 종결했다. 공식 작업원·reviewer로 내부 subagent를 사용한 항목은 없으며 모든 packet의 `INTERNAL_SUBAGENT_ONLY`는 `NONE`이다.

## 3. systemError 복구 provenance

- T03·T07 첫 `systemError`는 마지막 turn의 `error=null/completed`와 디스크 artifact를 대조해 실행계층 중단으로 분리했다. 새 writer로 바꾸지 않고 같은 T·WORK-ID·lease를 우선 재개했고 두 작업 모두 완성했다.
- T08 첫 `systemError` 뒤 같은 T를 우선 재개했다. 두 번째 중단 때는 partial artifact `T08-independent-review.md`를 `26,101 bytes / 331 Get-Content lines / 332 split lines / SHA-256 32C2C916A48E116465A4CB1AD8753FE36D0BC7C2BF018E995CF7D0B483C5A9C9`, 마지막 checkpoint `RR4-CP-01`, verdict `UNSET`으로 고정했다.
- T06은 T08에 `RELEASED_DUE_TO_EXECUTION_ERROR`를 보냈고 T08이 same-lease 추가 write 중단을 ACK했다. 그 뒤에만 별도 exclusive lease로 T01을 배정했다. 중복 reviewer/writer는 없었다.
- T01도 FOREMAN_REVIEW PASS 뒤 RELEASE를 ACK하고 idle로 전환했으며 승인 SHA `EE954099FC59A3191413D0AF5A8978C6E410628E76196987D57FD4AE9B1AAC8D` 이후 추가 artifact write가 없음을 반환했다.
- canonical 규칙과 validator는 탐색 완료·각 write checkpoint, timeout/systemError 뒤 `read_thread + 파일 존재/bytes/lines/hash` 대조, 동일 T 우선 재개, 두 번째 오류 때 명시 release와 새 actual T handoff, `systemError != 업무 FAIL`을 요구한다.

## 4. 산출물 receipts

| artifact | bytes / lines | SHA-256 | 소비자 |
|---|---:|---|---|
| `tmp/routing-anti-confusion-01/T07-instruction-inventory.md` | 27,036 / 294 | `71461C1DCD4D757C8939A8A3DA53B56F4D304CC5789316CD7A184ED3BEAAAFC4` | T06 canonical patch |
| `tmp/routing-anti-confusion-01/T03-routing-validator-design.md` | 32,024 / 524 | `19E2E032D4270C0A1E754A3A87467E281072613998131809202D1053C89AD879` | T06 validator implementation |
| `tmp/routing-anti-confusion-01/T08-independent-review.md` | 26,101 / 331 | `32C2C916A48E116465A4CB1AD8753FE36D0BC7C2BF018E995CF7D0B483C5A9C9` | replacement reviewer recovery input |
| `tmp/routing-anti-confusion-01/T01-independent-review.md` | 6,466 / 105 | `EE954099FC59A3191413D0AF5A8978C6E410628E76196987D57FD4AE9B1AAC8D` | T06 final review acceptance |
| `클로드/prompts/validate-codex-t-session-routing.ps1` | 31,527 / 443 | `EFDB4D828B1E7CD4CF3027DE944A557865F2861CC1484702982EF78C1D36744E` | 모든 실제 T-session 라우팅 소비자 |

## 5. 실제 변경 경로

### canonical·MWC·Claude

- `C:\Users\belie\Desktop\Belief\클로드\prompts\CODEX-T-SESSION-ROUTING.md` 신규 canonical 경계
- `C:\Users\belie\Desktop\Belief\클로드\prompts\validate-codex-t-session-routing.ps1` 실행 가능한 fail-closed validator
- `C:\Users\belie\Desktop\Belief\클로드\prompts\moawork-collaboration\01-MoaWork-Control-운영프롬프트.txt`
- `C:\Users\belie\Desktop\Belief\클로드\dev-harness\CLAUDE.md`
- `C:\Users\belie\Desktop\Belief\클로드\dev-harness\AGENTS.md`
- repo 실제 소비 경로 `AGENTS.md`, `CLAUDE.md`, `docs/coordination/README.md`, `docs/coordination/T10-gate-checklist.md`

### SUPERSEDED / 역사 보존

- MWC `02-DEV-1-로그인-A안-구현프롬프트.md`, `03-T10-로그인-A안-검수프롬프트.md`, `04-DEV-1-워크스페이스-부트스트랩-프롬프트.md`, `05-DEV-1-첫업체-딜-영속흐름-프롬프트.md`
- SalesPT `02-전체-인수인계-체계-구축-프롬프트.txt`, `06-Codex-세션-만드는법.txt`

위 6개는 line 1에서 `CODEX T-SESSION ROUTING ONLY — SUPERSEDED`로 명시해 새 운영에서 실행하지 않는다. SalesPT `00-사용법.txt`의 활성 `02` 실행 경로는 제거했다.

### CFC·SalesPT 활성 지침

- `salespt-collaboration/00-사용법.txt`
- `01-공통-세션-운영-프롬프트.txt`
- `03-Codex-Failover-Control-시작프롬프트.txt`
- `04-Codex-DEV-범용트랙-시작프롬프트.txt`
- `05-Codex-OPS-CAFE-BOT-시작프롬프트.txt`

모든 관련 활성 entrypoint 상단에는 눈에 띄는 `CODEX T-SESSION ROUTING ONLY` 경계와 동적 actual-T preflight가 있다.

## 6. validator와 독립 검수

- T06 종료 시점 재실행: SelfTest `13/13 PASS`, exit `0`; 정확한 19개 실제 지침 target scan `PASS`, exit `0`.
- T01 독립 실행: SelfTest `13/13 PASS`, 19-target `PASS`, bounded recovery probes `8/8 expected`, 모두 exit `0`.
- 정상 source-bound 두 번째 오류 복구만 PASS한다. `oldReleaseReceipt` source 누락·오류는 `RTE025`, `sameTResumeReceipt` source 누락·오류는 `RTE024`로 FAIL한다.
- wrong worker `returnTo`는 `NOT_DISPATCHED`, RESULT return receipt 누락과 fake recovery는 FAIL한다.
- 19 targets + validator aggregate manifest SHA-256은 `40E6910BEE1A697C72EE1B42DCC8C7E4A47F6D0F4C3862D67CA7B34B353361C1`; T01 lease 뒤 target write는 0이다.
- email literal / secret assignment / private-key marker는 `0 / 0 / 0`이다. T10 checklist의 개인 이메일 literal은 `<redacted-email-fixture>`로 치환했다.
- 한 번의 T01 wrong-target scan과 한 번의 definition-extraction `HARNESS_ERROR`, 한 번의 T06 child-PowerShell array binding error는 제품·validator 판정에서 제외했다. target write는 없었고 올바른 실행에서 모두 PASS했다.

## 7. 삭제·교체와 수정 불가 충돌

- 삭제·교체: 고정 A~H/DEV/T10 역할 라우팅, DESIGNER가 worker를 직접 배정·회수하는 경로, subagent를 공식 T 작업원처럼 집계하는 활성 문구를 canonical actual-T 체계로 교체했다.
- 역사 보존이 필요한 6개 문서는 `SUPERSEDED` 처리했다.
- `IMMUTABLE_CONFLICT`: Codex 실행계층의 `/root`, `spawn_agent`, subagent/agent tree 및 앱의 task/thread 동의어 같은 시스템·developer 문구는 사용자 로컬 파일이 아니어서 삭제했다고 주장하지 않는다. 로컬 canonical과 validator가 이를 공식 배치 증거로 사용하면 fail-closed 처리한다.

## 8. 보존 경계와 잔여 위험

- 기존 shared/dirty/untracked 변경을 보존했다. reset/clean/stage/commit/push를 하지 않았다.
- 제품 코드·HTML·DB·migration·PR·merge·deploy·Production write는 수행하지 않았다.
- 외부 로컬 prompt 파일은 Git 버전 관리 밖이므로 이후 수동 변경에 따른 drift 가능성이 있다. 19-target validator를 entrypoint/운영 시작 때 재실행해야 한다.
- validator는 내부적으로 `PASS=0`, `NOT_DISPATCHED=20`, `FAIL=30`을 구분한다. 일부 Windows 상위 runner는 nonzero를 일괄 1로 보일 수 있으므로 소비자는 JSON status와 zero/nonzero를 함께 읽는다.
- 폐기 YAML registry를 만들거나 복구하지 않았다. 최신 GitHub main과 최신 숫자 ROUND를 SSOT로 유지한다.

## 9. 종료

`ROUTING-ANTI-CONFUSION-01 = COMPLETE_TO_DESIGNER`. 다음 운영 BLUEPRINT부터 actual T-session 증거가 없는 라우팅은 기계적으로 `NOT_DISPATCHED` 또는 `FAIL`이며, 작업반장은 RESULT PASS 즉시 실제 T 작업원에게 `NEXT_WORK`를 주거나 명시 `RELEASE`해야 한다.

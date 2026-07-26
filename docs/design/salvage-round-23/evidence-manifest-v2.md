# Evidence Manifest v2 — REVIEW SPEC

> WORK-ID: `T10-EVIDENCE-MANIFEST-V2-01`  
> Artifact type: `REVIEW SPEC`  
> 상태: `DRAFT_COMPLETE / EXECUTION_NOT_RUN / T10_REVIEW_REQUIRED`  
> 입력: salvage INDEX Top 10 #2, `T08.md`, `round-21/08-test-matrix.md`  
> 범위: 증거 schema·완전성·유효기간·판정 규칙  
> 비범위: 제품 코드·DB·HTML·coordination·배포 변경

## 1. 목적과 사용자 가치

Evidence Manifest v2는 “파일이 있다”, “테스트가 통과했다”, “화면이 보인다”를 검수 증거로 오인하지 않게 한다. 하나의 결과가 어느 계약, 어느 후보 SHA, 어느 환경과 fixture, 어느 명령, 어느 artifact에서 나왔는지 재현 가능하게 묶고 다음을 보장한다.

- 낡은 SHA·변경된 계약·다른 fixture의 증거를 현재 후보 PASS로 재사용하지 않는다.
- skip, 부분 실행, mock-only, 빈 공격 fixture를 non-skip 성공처럼 집계하지 않는다.
- 명령 결과와 side effect를 UI·API·DB·worker·audit 계층별로 확인한다.
- 삭제·rename·unmerged file·충돌표식을 숨긴 채 “추가 파일 존재”만으로 승인하지 않는다.
- contract PASS, implementation PASS, live PASS를 별도 verdict로 유지한다.
- 전후 화면, 숨은 상태 시퀀스, 사용자 퀴즈와 명시 승인을 해시 가능한 bundle로 묶는다.
- 실제 개인정보, 고객 데이터, raw token, cookie, 인증 비밀값을 manifest와 artifact에 남기지 않는다.

## 2. 권위와 판정 경계

이 문서는 upstream 제품 계약을 바꾸지 않는다. 시나리오의 의미와 P0 우선순위는 다음 입력이 권위다.

| 입력 | v2에서 소비하는 계약 |
|---|---|
| `docs/design/salvage-round-23/INDEX.md` Top 10 #2 | source SHA/path, 명령·결과, 삭제·충돌표식, pass 층위 분리 |
| `docs/design/salvage-round-23/T08.md` T08-SV-01 | contract/fixture version, base/head SHA, environment, 실행시각, block reason, invalidation |
| 같은 파일 T08-SV-02 | 실제 반복·동시 실행과 `side_effect_count` |
| `docs/design/round-21/08-test-matrix.md` §§6, 9~13 | scenario trace, 실DB non-skip, 시각·퀴즈, P0 반려, T10 독립 판정 |

역할은 분리한다.

| 역할 | 책임 | 할 수 없는 것 |
|---|---|---|
| Contract owner | requirement·scenario revision과 적용 범위 고정 | 구현·live PASS 선언 |
| DEV evidence producer | 고정 후보에서 명령 실행·artifact 수집·manifest 작성 | 자기 실행 결과를 T10 최종 verdict로 승격 |
| Visual producer | 동일 조건의 전후·상태·접근성 bundle 수집 | 스크린샷으로 API/DB·RLS PASS 대체 |
| 사용자 reviewer | 실제 화면 퀴즈 응답과 명시 승인·거절 | 보안 P0를 승인으로 면제 |
| T10 independent reviewer | manifest 무결성·재현성·P0·층위별 verdict 판정 | 누락 증거 추정, 타 writer lease 침범, 제품 계약 재정의 |
| Next controller | 실행 owner·lease·후보·환경을 고정하고 T10에 package 전달 | evidence 없이 PASS 표시 |

## 3. 결과와 유효성 어휘

### 3.1 실행 결과

모든 gate와 scenario는 다음 네 값만 사용한다.

| 값 | 의미 |
|---|---|
| `PASS` | 적용 범위의 필수 assertion과 증거가 모두 유효하며 T10이 판정 |
| `FAIL` | 기대 결과 위반, 공격 성공, 무결성 불일치 또는 P0 반려 발생 |
| `BLOCKED` | 필요한 결정·권한·환경·fixture·upstream이 없어 실행 불가 |
| `NOT_RUN` | 적용 가능하지만 실행하지 않았거나 skip됨 |

`SKIPPED`, `EXPECTED_FAIL`, `CONDITIONAL_PASS`, `PARTIAL_PASS`는 최종 verdict 값으로 사용하지 않는다. skip은 수치로 기록하고 해당 gate는 `NOT_RUN` 또는 P0라면 전체 `FAIL`로 판정한다.

### 3.2 증거 유효성

| 값 | 의미 |
|---|---|
| `VALID` | 현재 contract/candidate/environment/fixture와 hash가 일치 |
| `STALE` | source 또는 후보가 바뀌어 재실행 필요 |
| `EXPIRED` | trigger 또는 명시된 `valid_until`을 지남 |
| `INVALID` | hash·size·scope·redaction·판정 규칙 위반 |
| `MISSING` | artifact 또는 필수 field를 찾을 수 없음 |

실행 결과가 과거 `PASS`여도 evidence validity가 `VALID`가 아니면 현재 verdict는 `PASS`가 아니다.

## 4. Manifest package 구조

권장 package는 한 manifest와 변경 불가능한 artifact 파일들로 구성한다. 저장 위치는 controller가 별도 lease로 정하며 이 SPEC은 디렉터리를 생성하지 않는다.

```text
evidence-package/
  manifest-v2.yaml
  command/
  test/
  db/
  visual/
  quiz/
  review/
```

경로는 package root 기준 상대경로로 기록한다. `..`, 사용자 홈 절대경로, raw secret가 포함된 URL, 외부 공개 링크를 artifact path로 쓰지 않는다.

## 5. Root schema

| 필드 | 형식 | 필수 | 규칙 |
|---|---|---:|---|
| `schema_version` | string | Y | 정확히 `2.0` |
| `manifest_id` | string | Y | package 내 unique; 변경 시 새 ID |
| `work_id` | string | Y | controller가 승인한 실행 WORK-ID |
| `manifest_status` | enum | Y | `DRAFT/COLLECTING/READY_FOR_REVIEW/REVIEWED/INVALIDATED` |
| `created_at` | RFC3339 | Y | timezone 포함 |
| `updated_at` | RFC3339 | Y | manifest 마지막 변경시각 |
| `producer_alias` | string | Y | 개인 식별정보가 아닌 역할 별칭 |
| `controller_ref` | object | Y | controller role, decision/lease reference |
| `t10_reviewer_alias` | string/null | Y | review 전 null 허용 |
| `scope` | object | Y | 포함 requirement/scenario와 명시적 제외 범위 |
| `contract_sources` | array | Y | 1개 이상; §6 |
| `candidate` | object | Y | §7 |
| `environment` | object | Y | §8 |
| `fixtures` | array | Y | §9; 실행이 없으면 block reason 필요 |
| `commands` | array | Y | §10; 실행하지 않았으면 빈 배열+NOT_RUN |
| `test_sets` | array | Y | §11 |
| `side_effects` | array | Y | 중복·변경 시나리오에 필수 |
| `change_integrity` | object | Y | 삭제·rename·conflict marker; §12 |
| `artifacts` | array | Y | §13 |
| `visual_pairs` | array | 조건부 | UI/visual scope이면 필수 |
| `quiz_evidence` | array | 조건부 | merge 전 사용자 화면 승인 scope이면 필수 |
| `gate_verdicts` | object | Y | contract/implementation/live 분리; §16 |
| `validity` | object | Y | 생성시점·만료·무효화 trigger; §17 |
| `redaction_review` | object | Y | 민감정보 검수 결과 |
| `t10_review` | object | Y | review 전 `NOT_RUN` |

### 5.1 최소 형태

아래 값은 schema 예시이며 실제 실행 증거가 아니다.

```yaml
schema_version: "2.0"
manifest_id: "<work-id>-<revision>"
work_id: "<approved-work-id>"
manifest_status: "DRAFT"
created_at: "<rfc3339>"
updated_at: "<rfc3339>"
producer_alias: "DEV-EVIDENCE-PRODUCER"
controller_ref:
  role: "NEXT-CONTROLLER"
  authorization_ref: "<non-secret-reference>"
t10_reviewer_alias: null
scope:
  requirement_ids: []
  scenario_ids: []
  excluded: []
contract_sources: []
candidate: {}
environment: {}
fixtures: []
commands: []
test_sets: []
side_effects: []
change_integrity: {}
artifacts: []
visual_pairs: []
quiz_evidence: []
gate_verdicts:
  contract: {status: "NOT_RUN"}
  implementation: {status: "NOT_RUN"}
  live: {applicable: false, status: "NOT_RUN"}
validity: {}
redaction_review: {status: "NOT_RUN"}
t10_review: {status: "NOT_RUN"}
```

## 6. Contract source schema

각 requirement는 path와 content identity를 함께 가져야 한다.

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `source_id` | Y | manifest 내 unique |
| `kind` | Y | `CONTRACT/REVIEW_SPEC/MIGRATION/IMPLEMENTATION/FIXTURE/DECISION` |
| `repo_relative_path` | Y | 검수 repository 안의 실제 경로; path 존재 확인 |
| `requirement_ids` | Y | 이 source가 공급하는 ID 목록 |
| `repository_commit_sha` | Y | 읽은 시점의 repository commit; full SHA |
| `git_blob_sha` | 조건부 | Git 추적 파일이면 필수 |
| `sha256` | Y | 파일 bytes의 SHA-256 64 hex |
| `size_bytes` | Y | 실제 byte 수; 0 불가 |
| `line_count` | Y | text artifact의 실제 line 수 |
| `dirty_at_capture` | Y | true이면 dirty diff artifact 필수 |
| `captured_at` | Y | RFC3339 |

수용 규칙:

1. path 존재만으로 통과하지 않는다. path·repository SHA·blob/file hash·size가 모두 일치해야 한다.
2. dirty source를 사용했다면 base content와 diff를 각각 artifact로 남기고 controller가 범위를 승인해야 한다.
3. requirement에 여러 source가 있으면 우선순위와 충돌 여부를 `scope.contract_resolution`에 기록한다.
4. contract source가 바뀌면 연결된 implementation/live/visual verdict는 `STALE`이다.

## 7. Candidate source schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `repository_alias` | Y | 공개 가능한 project 별칭 |
| `base_sha` | Y | 비교 기준 full commit SHA |
| `head_sha` | Y | 검수 후보 full commit SHA |
| `merge_candidate_sha` | 조건부 | merge gate면 필수; head와 다르면 재수집 |
| `tree_sha` | Y | 후보 tree identity |
| `dirty` | Y | `true/false` |
| `dirty_paths_artifact_id` | 조건부 | dirty=true이면 필수 |
| `untracked_count` | Y | 숫자; 0이 아니면 목록 artifact 필요 |
| `submodule_refs` | 조건부 | 사용한 경우 경로와 SHA |
| `build_id` | 조건부 | build/배포 artifact identity |
| `migration_revision` | 조건부 | DB scope이면 필수 |
| `captured_at` | Y | 명령 실행 직전 시각 |

merge/rebase/cherry-pick으로 `head_sha`, `tree_sha`, migration revision 중 하나가 바뀌면 이전 implementation evidence는 `STALE`이다. 단순히 diff가 비슷하다는 이유로 승계하지 않는다.

## 8. Environment schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `environment_id` | Y | manifest 내 stable alias |
| `class` | Y | `LOCAL/CI/TEST/STAGING/LIVE` |
| `os_runtime` | Y | OS·architecture·필요 runtime version |
| `app_build_id` | 조건부 | app 실행 scope이면 필수 |
| `deployed_sha` | LIVE 필수 | live 대상이 실제 어떤 후보인지 증명 |
| `database_alias` | DB scope | 비밀 host가 아닌 별칭 |
| `migration_revision` | DB scope | 실제 적용 revision |
| `service_versions` | 조건부 | worker/browser/database 등 판정에 필요한 버전 |
| `timezone` | Y | 시간 경계 테스트 재현용 |
| `network_profile` | 조건부 | offline/failed/limited 재시도 검사 시 필수 |
| `secret_presence` | Y | 필요한 변수 이름과 `present/absent`만; 값 금지 |
| `authorization_ref` | LIVE 필수 | 운영 실행 승인 reference; 비밀값 금지 |
| `captured_at` | Y | 환경 상태 채집시각 |

환경이 다르면 evidence를 자동 승계하지 않는다. local PASS는 CI, staging, live PASS가 아니며 live 실행은 별도 승인과 `deployed_sha` 일치가 필요하다.

## 9. Fixture schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `fixture_id` | Y | 예: ORG-1/3/10, TENANT-B의 합성 alias |
| `fixture_version` | Y | 데이터 구성이 바뀌면 증가 |
| `definition_path` | Y | source path 또는 생성 recipe artifact |
| `definition_sha256` | Y | fixture 정의 hash |
| `synthetic_only` | Y | 반드시 true |
| `workspace_aliases` | Y | 실제 tenant 이름이 아닌 별칭 |
| `role_aliases` | Y | Owner/team-lead/employee 등 |
| `precondition_assertions` | Y | 공격 대상과 허용 대상이 실제 존재함을 수치로 증명 |
| `row_count_summary` | 조건부 | table/domain별 합계만; 원문 행 금지 |
| `setup_command_id` | 조건부 | fixture 생성 명령 연결 |
| `cleanup_command_id` | 조건부 | 정리 명령 연결 |
| `cleanup_status` | Y | `PASS/FAIL/BLOCKED/NOT_RUN` |

cross-tenant “0건”은 TENANT-B 대상 행의 positive precondition이 없으면 무효다. fixture version 또는 definition hash가 달라지면 연결 evidence는 `STALE`이다.

## 10. Command/result schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `command_id` | Y | unique |
| `purpose` | Y | 어떤 assertion을 증명하는지 |
| `working_directory` | Y | repo/package 상대경로 |
| `shell_runtime` | Y | shell·tool version |
| `command_redacted` | Y | 재현 가능한 명령; secret 값은 placeholder |
| `secret_inputs` | Y | 변수 이름과 source type만; 값 금지 |
| `started_at` / `finished_at` | Y | RFC3339 |
| `duration_ms` | Y | 0 이상 |
| `exit_code` | Y | 실행된 경우 integer |
| `expected_exit_code` | Y | 성공·공격 차단의 기대값 |
| `stdout_artifact_id` | 조건부 | 출력이 있으면 필수 |
| `stderr_artifact_id` | 조건부 | 출력이 있으면 필수 |
| `result_summary` | Y | 실제 결과의 비민감 요약 |
| `result` | Y | PASS/FAIL/BLOCKED/NOT_RUN |
| `block_reason` | 조건부 | BLOCKED/NOT_RUN이면 필수 |
| `retry_of` | 조건부 | 재시도면 원 command ID |
| `concurrency_group` | 조건부 | 동시 실행이면 동일 group ID |

명령 문자열에 credential을 직접 넣지 않는다. stdout/stderr를 manifest 본문에 길게 붙이지 않고 redaction을 거친 artifact로 보존한다. exit code 0만으로 scenario PASS를 주지 않는다.

## 11. Test set와 non-skip count

각 suite·scenario group은 다음 수치를 가진다.

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `test_set_id` | Y | unique; upstream scenario group 연결 |
| `requirement_ids` | Y | 1개 이상 |
| `scenario_ids` | Y | unique list |
| `expected_total` | Y | 계약상 전체 개수 |
| `discovered_total` | Y | runner가 발견한 개수 |
| `selected_total` | Y | 실제 선택된 개수 |
| `executed_total` | Y | runner가 실행한 개수 |
| `passed_total` | Y | assertion 충족 |
| `failed_total` | Y | assertion 위반 |
| `skipped_total` | Y | framework skip 포함 |
| `blocked_total` | Y | 환경·결정으로 실행 불가 |
| `not_run_total` | Y | 선택·실행되지 않음 |
| `non_skip_passed_total` | Y | skip 없이 실제 실행돼 PASS한 수 |
| `command_ids` | Y | 실행 로그 연결 |
| `result_artifact_id` | Y | case-level 결과 artifact |
| `result` | Y | PASS/FAIL/BLOCKED/NOT_RUN |

산술 불변식:

```text
expected_total = unique(scenario_ids)
selected_total <= discovered_total
executed_total = passed_total + failed_total
expected_total = executed_total + skipped_total + blocked_total + not_run_total
non_skip_passed_total <= passed_total
```

수용 규칙:

- P0 set은 `expected=discovered=selected=executed=non_skip_passed`이고 failed/skipped/blocked/not-run이 모두 0일 때만 PASS 후보가 된다.
- T03 authz set은 계약의 1~55 unique manifest와 result total이 일치해야 한다.
- suite 이름만 있고 case-level ID·count가 없으면 `INVALID`다.
- credential/실DB 부재로 skip한 P0 set은 `PASS`가 아니라 `NOT_RUN`; 이를 PASS로 집계하면 manifest 전체 `FAIL`이다.
- flaky 재실행은 최초 실패를 삭제하지 않고 attempt들을 모두 연결한다.

## 12. Side effect·삭제·conflict marker schema

### 12.1 Side effect

중복제출·retry·import·invite·Owner transfer·session cutoff 같은 변경 scenario는 계층별 전후 수치를 가져야 한다.

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `effect_id` | Y | unique |
| `scenario_id` | Y | upstream scenario |
| `request_or_batch_alias` | Y | secret가 아닌 합성 alias |
| `attempt_count` | Y | 실제 반복·동시 요청 수 |
| `concurrency_mode` | Y | `SEQUENTIAL/CONCURRENT/RETRY_AFTER_FAILURE` |
| `layer` | Y | UI/API/DB/WORKER/AUDIT/STORAGE/SESSION |
| `before_count` | Y | 합계 |
| `after_count` | Y | 합계 |
| `expected_delta` | Y | 계약상 변화량 |
| `actual_delta` | Y | 실제 변화량 |
| `evidence_artifact_ids` | Y | DB diff/job/audit 등 |
| `result` | Y | PASS/FAIL/BLOCKED/NOT_RUN |

UI에서 한 건만 보였다는 사실은 DB/job/event 한 건의 증거가 아니다. 관련 계층마다 effect row를 분리한다.

### 12.2 Candidate change integrity

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `name_status_artifact_id` | Y | base..head의 A/M/D/R/C/U 목록 |
| `added_count` | Y | 숫자 |
| `modified_count` | Y | 숫자 |
| `deleted_count` | Y | 숫자 |
| `renamed_count` | Y | 숫자 |
| `unmerged_count` | Y | PASS 후보는 0 |
| `deletions` | Y | 삭제가 0이어도 빈 배열 필수 |
| `conflict_scan` | Y | marker 검사 결과 |

각 deletion:

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `path` | Y | repo-relative |
| `source_blob_sha` | Y | 삭제 전 identity |
| `intent` | Y | 삭제 이유와 requirement |
| `approved_by_ref` | Y | controller/contract 승인 reference |
| `consumer_impact_artifact_id` | Y | 참조·consumer 검색 결과 |
| `result` | Y | PASS/FAIL/BLOCKED/NOT_RUN |

conflict scan:

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `command_id` | Y | 검사 명령 연결 |
| `scoped_paths` | Y | 후보가 바꾼 text 경로 |
| `unmerged_index_count` | Y | 0 필수 |
| `marker_patterns` | Y | line-start 기준 `<<<<<<<`, `=======`, `>>>>>>>` |
| `marker_hit_count` | Y | 0 필수; fixture의 의도된 표본은 별도 제외 승인 |
| `excluded_hits` | Y | path·line·이유·reviewer; 미검토 제외 금지 |
| `result_artifact_id` | Y | 전체 결과 hash 보존 |

삭제를 누락하거나 conflict marker/unmerged index가 1개라도 남으면 implementation PASS는 불가하다. 의도된 삭제도 consumer 영향과 명시 승인이 없으면 `BLOCKED`다.

## 13. Artifact integrity schema

모든 command output, test report, screenshot, DB diff, audit 요약, visual·quiz 증거는 artifact index에 등록한다.

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `artifact_id` | Y | manifest 내 unique |
| `kind` | Y | `STDOUT/STDERR/TEST_REPORT/DB_DIFF/AUDIT/SCREENSHOT/VIDEO/QUIZ/APPROVAL/DIFF/INVENTORY/OTHER` |
| `relative_path` | Y | package root 상대경로 |
| `sha256` | Y | 실제 bytes SHA-256 64 hex |
| `size_bytes` | Y | 실제 byte 수; 0이면 INVALID |
| `mime_type` | Y | 예상 형식과 일치 |
| `created_at` | Y | RFC3339 |
| `producer_command_id` | 조건부 | 명령 산출물이면 필수 |
| `source_scenario_ids` | Y | 어떤 검사를 증명하는지 |
| `redaction_status` | Y | `PASS/FAIL/NOT_RUN` |
| `redaction_method` | 조건부 | 제거·마스킹한 field 종류; 원문 값 금지 |
| `pair_id` | 조건부 | 전후 visual이면 필수 |
| `validity` | Y | VALID/STALE/EXPIRED/INVALID/MISSING |

검증자는 artifact를 다시 읽어 size와 SHA-256을 계산한다. manifest 값과 다르거나 파일이 없으면 해당 artifact는 `INVALID/MISSING`, 연결 verdict는 PASS가 아니다.

`bundle_digest`는 `artifact_id|sha256|size_bytes`를 artifact ID 오름차순으로 연결한 UTF-8 bytes의 SHA-256이다. manifest 변경 후 다시 계산하며, package 수신 시 T10이 독립 재계산한다.

## 14. Before/after visual evidence

### 14.1 Visual pair schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `pair_id` | Y | unique |
| `scenario_id` | Y | S/H/T/I/AUTHZ 등 |
| `baseline_sha` | Y | before source identity |
| `candidate_sha` | Y | after source identity |
| `fixture_id/version` | Y | before/after 동일 |
| `role_alias` | Y | 동일 |
| `workspace_alias` | Y | 동일 |
| `viewport` | Y | width×height와 scale; 동일 |
| `theme` | Y | light/dark; 동일 |
| `locale/timezone` | Y | 동일 |
| `before_artifact_id` | Y | screenshot/video hash·size 등록 |
| `after_artifact_id` | Y | screenshot/video hash·size 등록 |
| `state_sequence_artifact_ids` | Y | hidden state 증거 |
| `console_result_artifact_id` | Y | 오류 유무와 실제 목록 |
| `network_failure_artifact_id` | 조건부 | retry/error scope이면 필수 |
| `overflow_result` | Y | PASS/FAIL |
| `keyboard_focus_result` | Y | PASS/FAIL/NOT_RUN |
| `screen_reader_result` | 조건부 | 위험행동/A11y scope이면 필수 |
| `visual_reviewer_alias` | Y | producer와 분리 가능 |
| `result` | Y | PASS/FAIL/BLOCKED/NOT_RUN |

필수 hidden sequences:

```text
entry -> loading -> action -> success -> refresh
empty -> denied -> error -> retry -> cancel/undo
```

관련 없는 상태는 `not_applicable_reason`을 명시하고 T10이 승인해야 한다. 하나의 screenshot을 여러 role·viewport·state 증거로 재사용하지 않는다. before/after의 fixture·role·workspace·viewport·theme·locale이 다르면 비교는 `INVALID`다.

### 14.2 접근성 artifact

위험행동은 screenshot 외에 다음을 기록한다.

- keyboard-only 진입→확인→취소/완료 순서
- accessible name과 dialog title
- focus trap과 닫은 뒤 focus 복귀 대상
- status/alert announcement 순서
- screen-reader tool/version과 비민감 실행 요약
- 색상 외 오류·위험·disabled 단서

실제 screen-reader 실행이 필요한 scope에서 정적 DOM 검사만 있으면 `NOT_RUN`이다.

## 15. Quiz와 사용자 승인 evidence

### 15.1 Quiz schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `quiz_id` | Y | unique |
| `visual_bundle_digest` | Y | 사용자가 본 visual artifact 묶음 |
| `candidate_sha` | Y | 화면 후보와 일치 |
| `question_count` | Y | 2~4 |
| `questions` | Y | question ID·문구·관련 requirement |
| `response_summary_redacted` | Y | PII 없는 응답 요약 |
| `response_artifact_id` | Y | 원문을 보존해야 하면 접근 제한·redaction·hash 적용 |
| `misunderstandings` | Y | 없으면 빈 배열 |
| `followup_changes` | Y | 오해로 발생한 재설계·재검수 연결 |
| `user_decision` | Y | `APPROVE/REJECT/CHANGES_REQUESTED` |
| `decided_at` | Y | RFC3339 |
| `approval_artifact_id` | 조건부 | APPROVE이면 필수 |
| `result` | Y | PASS/FAIL/BLOCKED/NOT_RUN |

기본 질문은 `08-test-matrix.md`의 다음 네 축을 사용한다.

1. 3분 시작의 완료 화면·상태
2. Owner/팀장/사원의 오늘 화면 범위
3. 유일 Owner 제거·강등 전 필요한 보호 절차
4. import cancel/retry/rollback이 보호하는 데이터

사용자 승인만 있고 quiz response가 없거나, quiz가 다른 `visual_bundle_digest`에 대한 것이면 visual acceptance는 PASS가 아니다. candidate 또는 화면 bundle이 바뀌면 quiz·승인은 `STALE`이다.

## 16. Contract / implementation / live PASS 분리

### 16.1 Verdict schema

각 gate는 동일 구조를 쓴다.

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `applicable` | Y | false이면 status는 NOT_RUN, 이유 필수 |
| `status` | Y | PASS/FAIL/BLOCKED/NOT_RUN |
| `criteria_ids` | Y | 적용 수용조건 |
| `evidence_artifact_ids` | Y | PASS이면 1개 이상 |
| `reviewer_alias` | PASS/FAIL | 독립 판정자 |
| `reviewed_at` | PASS/FAIL | RFC3339 |
| `block_reason` | BLOCKED/NOT_RUN | 구체 선행조건 |
| `validity` | Y | VALID/STALE/EXPIRED/INVALID/MISSING |

### 16.2 층위별 수용조건

| Gate | PASS가 의미하는 것 | 필수 조건 | 의미하지 않는 것 |
|---|---|---|---|
| Contract | 적용 계약·scenario·decision·schema가 충돌 없이 고정됨 | source path/hash/size, requirement mapping, 미결정 분리, conflict 0 | 코드 구현, DB 적용, 화면 또는 live 정상 |
| Implementation | 고정 후보가 합성 fixture와 요구 계층에서 계약을 충족 | candidate SHA 일치, commands·results, non-skip, side effects, deletion/conflict 검사, artifacts VALID | 배포·운영 상태 또는 장기 안정성 |
| Live | 승인된 실제 환경에서 배포 후보와 필요한 통합이 현재 충족 | `deployed_sha=candidate`, authorization, 비밀값 없는 live probe, non-expired artifact, rollback/health 범위 | 다른 환경·미실행 기능의 PASS |
| Visual/User | 실제 후보 화면을 같은 조건으로 비교하고 사용자가 이해·승인 | before/after, hidden states, A11y, quiz 2~4, explicit decision | API/DB/RLS·live PASS |

승계 금지 규칙:

- Contract PASS는 implementation을 자동 PASS시키지 않는다.
- Implementation PASS는 live gate를 자동 PASS시키지 않는다.
- local/CI PASS는 staging/live PASS가 아니다.
- Visual/User PASS는 권한·tenant·DB 무결성을 대체하지 않는다.
- Live API 성공은 UI hidden state·quiz 또는 direct DB/RLS 검사를 대체하지 않는다.
- 각 gate가 PASS여도 evidence validity가 바뀌면 해당 gate는 즉시 PASS 후보에서 제외된다.

## 17. Expiry와 invalidation

숫자 TTL은 기능·환경 owner가 정하고 T10이 승인한다. 이 SPEC은 임의 기간을 확정하지 않고 `valid_until` 또는 event trigger를 필수로 한다.

### 17.1 Validity schema

| 필드 | 필수 | 규칙 |
|---|---:|---|
| `valid_from` | Y | 실행·수집 완료시각 |
| `valid_until` | 조건부 | 시간 기반 evidence면 필수 |
| `ttl_policy_ref` | 조건부 | TTL 결정 근거 |
| `invalidation_triggers` | Y | 1개 이상 |
| `last_verified_at` | Y | T10 또는 verifier 재검증 시각 |
| `current_validity` | Y | VALID/STALE/EXPIRED/INVALID/MISSING |
| `invalidated_at` | 조건부 | VALID가 아니면 시각 |
| `invalidation_reason` | 조건부 | 원인과 영향을 받는 gate |
| `replacement_manifest_id` | 조건부 | 재수집본이 있으면 연결 |

### 17.2 필수 invalidation trigger

다음 중 하나라도 발생하면 연결 evidence를 재판정한다.

- contract source path/hash/revision 또는 decision 변경
- base/head/merge candidate/tree/deployed SHA 변경
- migration revision, build ID, dependency lock, relevant runtime 변경
- fixture version/hash/precondition 또는 role/tenant scope 변경
- command·runner 설정·selected scenario set 변경
- artifact missing, size/hash mismatch, redaction FAIL
- deletion 목록 변경, unmerged file 또는 conflict marker 발견
- live environment authorization 종료, grant/session 만료, health 상태 변경
- before/after visual bundle, viewport, theme, locale 또는 candidate 변경
- quiz 대상 bundle 변경, 사용자 승인 철회 또는 changes requested
- 명시한 `valid_until` 경과

`STALE/EXPIRED` evidence는 삭제하지 않는다. 과거 결과로 보존하되 현재 verdict에서 제외하고 replacement manifest를 연결한다.

## 18. Redaction과 개인정보 안전

manifest와 artifact에는 다음 원문을 넣지 않는다.

- 실제 사용자·동료·고객 식별정보와 업무 원문
- raw access/refresh/invite/session token, cookie, 인증서, API key, password
- 실제 이메일·전화번호·주소·계정번호
- secret가 포함된 command, URL query, stdout/stderr
- DB 접속 host·credential·service key

허용되는 것은 합성 alias, 집계 수치, secret 변수 이름과 `present/absent`, 비밀값을 제거한 오류 분류, hash·size다. redaction 전 원본이 생성됐다면 evidence package에 넣지 않고 승인된 보안 절차로 폐기한 뒤 다시 수집한다.

redaction FAIL은 연결 artifact를 `INVALID`로 만들며 재수집 전 PASS할 수 없다.

## 19. Acceptance rules

### 19.1 Manifest 자체 PASS 후보

다음을 모두 만족해야 `READY_FOR_REVIEW`가 된다.

1. schema v2 필수 field와 unique ID가 모두 존재한다.
2. 모든 source/artifact path가 존재하고 size·SHA-256 재계산이 일치한다.
3. source contract와 candidate의 full SHA·revision이 실행시점과 일치한다.
4. command마다 실제 result·exit code·output artifact 또는 block reason이 있다.
5. test count 산술이 맞고 P0 skipped/blocked/not-run이 0이다.
6. 중복·retry scenario의 계층별 side effect count가 있다.
7. deletion마다 승인·consumer impact가 있고 unmerged/conflict marker가 0이다.
8. visual scope이면 before/after·hidden states·A11y evidence가 완전하다.
9. 사용자 화면 승인 scope이면 동일 bundle의 2~4개 quiz와 명시 decision이 있다.
10. redaction 검수가 PASS이고 실제 비밀값·PII가 없다.
11. contract/implementation/live/visual verdict가 분리돼 있고 승계 표현이 없다.
12. validity trigger와 현재 validity가 채워져 있다.

### 19.2 즉시 반려

- 파일 존재나 테스트 이름만 있고 실행 결과·hash·size가 없음
- source SHA/path가 후보와 다르거나 과거 PR/SHA를 현재 증거로 사용
- head 변경 후 이전 artifact를 재검증 없이 재사용
- artifact hash/size 불일치 또는 삭제됨
- conflict marker, unmerged index, 승인 없는 deletion 존재
- P0 test skip·부분 선택·mock-only를 PASS로 집계
- `expected_total`과 case ID 또는 결과 합계 불일치
- UI 1건만 보고 DB/job/event 멱등성을 주장
- 빈 TENANT-B fixture로 cross-tenant 0건 주장
- API 403만으로 direct DB/RLS·상태 불변을 대체
- screenshot만으로 권한·A11y·screen-reader PASS 주장
- 서로 다른 fixture·role·viewport·theme의 전후 화면 비교
- 다른 visual bundle에 대한 quiz·사용자 승인을 재사용
- contract PASS를 implementation/live PASS로 합성
- local 결과를 live PASS로 표시
- BLOCKED/NOT_RUN/skip을 PASS denominator에서 제외해 통과율을 부풀림
- artifact에 실제 개인정보나 비밀값 포함

## 20. T10 review procedure

T10은 다음 순서로 독립 판정한다.

1. `schema_version`, package inventory, bundle digest를 재계산한다.
2. source path·commit/blob/file hash·size와 contract revision을 확인한다.
3. candidate base/head/tree/merge/deployed SHA와 dirty·deletion·conflict 상태를 확인한다.
4. environment·fixture version·positive precondition을 확인한다.
5. command ID와 output artifact를 표본이 아니라 필수 P0 전체에서 연결한다.
6. test count 산술·non-skip·side effect count를 재계산한다.
7. artifact redaction·hash·size·경로를 확인한다.
8. contract/implementation/live/visual gate를 각각 판정한다.
9. before/after 조건, hidden sequence, A11y, quiz·명시 승인을 확인한다.
10. expiry/invalidation trigger를 적용해 `VALID`인 evidence만 verdict에 포함한다.
11. 결과를 PASS/FAIL/BLOCKED/NOT_RUN과 구체 이유로 기록한다.

T10은 누락값을 추정하거나 producer의 PASS를 그대로 승계하지 않는다. 재현에 필요한 command·fixture·artifact가 없으면 `BLOCKED/NOT_RUN`, hash 또는 주장과 실제가 다르면 `FAIL`이다.

## 21. Downstream packet

| 주체 | 현재 상태 | 다음 행동 |
|---|---|---|
| 사용자 | `NO_NEW_DECISION_REQUIRED` | 실제 화면이 포함될 때 quiz·명시 승인 수행 |
| Next controller | `ACTION_REQUIRED` | 실행 scope·contract revision·candidate SHA·environment·fixture·producer lease를 고정 |
| DEV evidence producer | `NOT_ASSIGNED / NOT_RUN` | 승인 후 v2 manifest와 artifact package 생성; 제품 변경 권한은 별도 |
| Visual producer/T04 | `LEASE_REQUIRED` | 실제 후보가 있을 때 동일 조건 전후·hidden state·A11y bundle 제공 |
| T10 | `SPEC_REVIEW_REQUIRED / EXECUTION_NOT_RUN` | schema 승인 후 채워진 package를 독립 검수 |

### 다음 controller

MWC/HUB controller는 `T10-EVIDENCE-MANIFEST-V2-01`의 다음 실행 wave에서 producer·후보·환경·artifact 저장 lease를 지정한다. 이 문서는 coordination 상태를 직접 바꾸지 않는다.

### T10 consumer

T10은 이 REVIEW SPEC을 다음 세 작업의 공통 입력으로 소비한다.

1. `T10-EVIDENCE-EXECUTION-01` — Round-21 scenario 실제 실행·판정
2. `SALVAGE-INTEGRITY-VERIFY-01` — 폐기 정본·낡은 현재성·artifact 누락 재검사
3. Top 10 #3/#5/#8/#9/#10 후속 package — 특권 접근, session, import, consumer 회귀, live 통합 증거

## 22. 현재 판정

- Contract schema 작성: `COMPLETE_DRAFT`
- Implementation evidence: `NOT_RUN`
- Live evidence: `NOT_RUN`
- Visual/quiz evidence: `NOT_RUN`
- T10 verdict: `NOT_RUN`
- 제품·coordination·코드·DB·HTML 변경: `0`

이 파일의 존재는 contract/implementation/live PASS가 아니다. 채워진 v2 package와 T10 독립 verdict가 생기기 전에는 모든 실행 층위를 `NOT_RUN`으로 유지한다.

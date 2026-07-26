# T10 Gate SSOT 교체·이관 명세

> WORK-ID: `T10-GATE-SSOT-REFRESH-01`  
> 상태: `SPEC READY / CONTROLLER APPLY NOT RUN`  
> 작성 범위: 교체·이관 계약만 작성. coordination·제품 코드·DB·Git·배포 변경 없음.  
> 입력 정본: `docs/coordination/sync/ROUND-23.md`, `docs/design/salvage-round-23/INDEX.md`, `docs/coordination/T10-gate-checklist.md`  
> 현재 제품 계약 근거: `docs/design/round-21/02-implementation-dag.md`, `03-p0-authz-contract.md`, `08-test-matrix.md`  
> 다음 소비자: MWC/HUB writer, T10 독립 검수  
> 다음 WORK-ID: `T10-GATE-SSOT-APPLY-01`

## 1. 목적과 판정

기존 `docs/coordination/T10-gate-checklist.md`는 과거의 유효한 검수 경험과 시점 종속 PR·SHA·배포 기록, 폐기 coordination 경로, 현재 보안 계약과 충돌하는 권한 가정을 한 파일에 함께 담고 있다. 제목도 여전히 SSOT라고 표시돼 있어 현재 제품 허브의 REVIEW 경로에서 권위 문서처럼 보인다.

따라서 구문서를 계속 증분 수정하지 않는다. 현재 제품 계약을 참조하는 새 T10 게이트와 별도 append-only 판정 이력을 제품 허브에 만들고, MWC가 독립 검수 뒤 링크를 전환한다. 구문서는 삭제하지 않고 `SUPERSEDED / HISTORY ONLY`로 보존한다.

이 명세 자체는 새 검수 SSOT가 아니며, 코드·DB·운영 write·merge·deploy 승인도 아니다. MWC의 적용과 T10 재검수가 끝나기 전 상태는 `CONTROLLER APPLY NOT RUN`이다.

## 2. 현재 권위와 적용 후 권위

### 2.1 현재 적용되는 권위

적용 전에는 다음 우선순위로 판정한다.

1. 사용자의 최신 명시 결정과 MWC가 관리하는 최신 `docs/coordination/sync/ROUND-N.md`
2. 제품 허브 `docs/design/round-21/INDEX.md`
3. 구현·release 순서는 `02-implementation-dag.md`
4. Owner·tenant·membership·profile·session·RLS·audit 계약은 `03-p0-authz-contract.md`
5. 기능·실DB·시각·증거·T10 판정 실행 규칙은 `08-test-matrix.md`
6. Round 23 회수 우선순위와 기각선은 `docs/design/salvage-round-23/INDEX.md`

기존 `docs/coordination/T10-gate-checklist.md`는 현재 권위가 아니다. 과거 결함과 판정의 출처로만 읽는다.

### 2.2 적용 후 목표 권위

MWC는 다음 두 파일을 새 제품 허브의 T10 게이트로 만든다.

- 규칙 SSOT: `docs/design/round-21/10-t10-gate.md`
- 판정 이력: `docs/design/round-21/10-t10-verdict-history.md`

적용 뒤 역할은 다음과 같다.

| 문서 | 권위 범위 | 하지 않는 일 |
|---|---|---|
| `10-t10-gate.md` | 판정 어휘, 공통 gate, 증거 형식, visual·DB·artifact·merge/release 승격 규칙 | 도메인 보안 계약이나 구현 순서를 재정의하지 않음 |
| `10-t10-verdict-history.md` | 활성화 이후 T10 판정을 append-only로 기록 | 규칙을 정의하거나 과거 판정을 현재 PASS로 승격하지 않음 |
| `02-implementation-dag.md` | writer gate, 순차 적용, STOP, candidate/release 증거 | T10 최종 판정을 대신하지 않음 |
| `03-p0-authz-contract.md` | P0 보안 불변식과 공격검사 1~55 | 구현·실DB PASS를 선언하지 않음 |
| `08-test-matrix.md` | 실행 scenario와 non-skip·visual·증거 수용조건 | 사용자 승인, merge, deploy를 실행하지 않음 |
| 구 `T10-gate-checklist.md` | legacy evidence/history | 새 판정·현재성·SSOT 역할 금지 |

새 게이트가 하위 계약과 충돌하면 최신 사용자 결정과 도메인 계약이 우선한다. T10은 충돌을 임의로 해결하지 않고 `BLOCKED`로 기록해 MWC에 반환한다.

## 3. 구문서 섹션 이관표

### 3.1 보존하되 현재 계약으로 다시 쓰는 내용

| 구문서 영역 | 회수할 가치 | 새 위치·교체 방식 |
|---|---|---|
| §0 공통 게이트 | lint·typecheck·test·build, 비밀값 부재, migration 순서, RLS, gate 우회 금지 | 새 게이트의 공통 candidate 검수. 명령명·migration 자릿수·정책 개수는 현재 저장소에서 측정하며 고정하지 않음 |
| §4 런타임 스모크 | CI 초록이 실제 화면·라우트·서버 오류 부재를 대체하지 못함 | candidate SHA·전용 환경·실제 서버가 일치하는 smoke evidence로 일반화 |
| §5 판정 기록의 방법론 | branch 통과는 후보일 뿐이고 누적 후보·main에서 다시 봐야 함 | verdict 승격 규칙과 append-only ledger로 이동 |
| §6 build 결함 경험 | server-only 모듈의 client graph 유입은 unit/CI만으로 놓칠 수 있음 | production build·import graph·client/server boundary 필수 검사 |
| §8-B 부분 patch 결함 경험 | 변경하지 않은 필드의 positive preservation proof 필요 | artifact/data integrity와 consumer 회귀 검사의 일반 규칙으로 보존 |
| §8-C 병렬 merge 위험 | 최신 base, 누적 consumer, 전용 포트, cache 격리 | candidate provenance와 재현 환경 계약으로 교체 |
| §9~§10에서 발견한 결함 | build 파손, 공용 반환형 consumer 파손, 문서 삭제가 정적 gate를 통과할 수 있음 | `CROSS-BOUNDARY-CONSUMER-REGRESSION-01`, artifact integrity gate로 번역 |
| §10 남은 미검증 | RLS skip, OAuth·정산·Storage 실환경 공백을 PASS로 볼 수 없음 | `LIVE-INTEGRATION-EVIDENCE-PACK-01`과 non-skip gate에 연결 |

### 3.2 완전히 제거할 규범

다음은 새 게이트에 실행 규칙으로 복사하지 않는다.

- retired `session-registry`, `dispatch-queue`, 구조적 YAML 또는 과거 WORKLOG 갱신을 완료 조건으로 삼는 규칙
- 과거 PR 번호·branch·SHA·main·provider·Vercel 상태·테스트 개수·route 개수를 현재 사실로 쓰는 문장
- 과거 고정 merge 순서와 특정 트랙 산출물 예상 목록
- dev-session cookie, demo 계정, seed UID·org ID, 숨은 action ID를 이용한 실행 절차
- `orgs` direct insert 뒤 trigger로 Owner를 자동 부여하는 온보딩 계약
- `members_manage` 또는 broad membership DML로 Owner/Admin을 관리하는 계약
- 이메일 allowlist나 `app_admin_role(email)`을 Workspace membership·Owner 근거로 사용하는 계약
- Platform Admin을 Workspace role·scope와 합성하는 계약
- broad `users_select`, 전역 사용자 directory, impersonation, 영구 support membership, editable audit
- 일반 membership RPC를 통한 Owner 변경·강등·삭제·scope 변경
- `001` 당시의 RLS 정책 수, 테이블 수, migration 자릿수 같은 시점 종속 상수
- “브랜치 후보 PASS”, “preview ready”, “route 존재”를 구현·실DB·live 완료로 승격하는 규칙
- 구문서의 과거 최종 판정과 OAuth 후보 판정을 현재 release 근거로 재사용하는 규칙

### 3.3 현재 계약으로 대체할 영역

| 구문서 영역 | 대체 정본 |
|---|---|
| §1 T03 foundation·온보딩·membership | `03-p0-authz-contract.md` O1~O13, migration/RPC/RLS/App/Release, 공격검사 1~55 |
| §2 CRM 고정 parity 체크 | 해당 최신 CRM SPEC과 `CRM-OPERATIONAL-LOOP-DECISION-01`; 없으면 `BLOCKED/NOT_RUN` |
| §3 dashboard/files 고정 체크 | 해당 최신 기능 SPEC과 `08-test-matrix.md` traceability |
| §4 고정 curl/cookie smoke | candidate별 비밀값 없는 smoke manifest |
| §5·§9·§10·§11 과거 판정 | legacy history로 동결하고 새 append-only ledger 사용 |
| §6·§8 교차 위험 | `02-implementation-dag.md`, `08-test-matrix.md`, 새 gate의 consumer/artifact 규칙 |
| 부록의 현재 상태 | 적용 시점 read-back으로 매번 재측정; 문서에 현재 사실로 복사 금지 |

## 4. 새 판정 모델

### 4.1 허용 결과 어휘

모든 행은 `PASS | FAIL | BLOCKED | NOT_RUN | N/A` 중 하나만 사용한다.

- `PASS`: 기대 결과와 실제 결과, 증거가 모두 존재하고 T10이 독립 확인함
- `FAIL`: 기대와 다른 동작, 보안 불변식 위반, 증거 불일치 또는 허위 통과 조건이 발견됨
- `BLOCKED`: 필요한 결정·환경·권한·fixture·writer 단계가 없어 실행할 수 없음
- `NOT_RUN`: 실행 가능한지와 무관하게 아직 실행하지 않음
- `N/A`: 이번 변경 범위에 해당하지 않음을 영향 분석으로 증명함. 편의상 생략하는 값이 아님

`SKIP`, 빈 셀, “부분 PASS”, “대체로 정상”, 체크박스 존재는 PASS가 아니다. 필수 행의 `BLOCKED`, `NOT_RUN`, `N/A` 오분류가 하나라도 있으면 상위 승격을 금지한다.

### 4.2 PASS 층 분리

| 층 | 공식 표기 | 최소 근거 | 승격하지 않는 범위 |
|---|---|---|---|
| 계약 | `PASS — CONTRACT ONLY` | 최신 사용자 결정, 문제·불변식·실패·수용조건·다음 소비자 연결 | 코드·DB·시각·실환경·merge·release |
| 구현 후보 | `PASS — IMPLEMENTATION CANDIDATE ONLY` | exact candidate, diff, check, production build, 관련 통합검사, artifact integrity | merge 뒤 main, 실DB가 필요한 보안, 배포·운영 |
| 시각 | `PASS — VISUAL ONLY` | 실제 후보 화면, 동일 조건 전후, viewport/theme/state, 접근성, 사용자 명시 승인 | 서버 권한·DB·세션 폐기·merge·release |
| 실DB | `PASS — LIVE DB ONLY` | 실제 DB migration catalog, 두 tenant fixture, 관련 공격검사 non-skip, 전후 DB 상태 | 앱 배포와 운영 사용자 여정 |
| 실환경 | `PASS — LIVE <ENV> ONLY` | 정확한 배포 ref, 실제 URL/health, 필요한 OAuth·Storage·worker·integration 증거 | 다른 환경과 제품 전체 완료 |
| merge 후보 | `MERGE_READY` | 범위 내 계약·구현·visual·DB·artifact 필수행 전부 PASS, cumulative candidate 일치 | 실제 merge 수행 |
| release 후보 | `RELEASE_READY` | merge 결과와 deploy ref 일치, live 필수행 PASS, rollback/monitor 준비 | 실제 deploy 수행·제품 전체 DONE |

T10의 판정은 merge·deploy를 실행하지 않는다. MWC와 승인된 writer가 별도 권한으로 실행한다. `PRODUCT DONE`은 사용자/MWC가 정의한 전체 범위가 모두 닫히기 전 사용하지 않는다.

### 4.3 승격 불변식

1. 하위 PASS는 상위 PASS로 자동 전파되지 않는다.
2. candidate ref가 바뀌면 구현·visual·DB·live 증거의 재사용 가능성을 각각 재판정한다.
3. merge/rebase 뒤 evidence ref와 후보 ref가 다르면 기존 PASS는 `STALE EVIDENCE`이며 현재 결과는 `NOT_RUN`이다.
4. 보안 P0에서 공격이 하나라도 성공하거나 필수 실DB 행이 미실행이면 전체 P0는 FAIL 또는 BLOCKED다.
5. UI에서 버튼을 숨긴 사실은 API·RPC·RLS 거부 증거가 아니다.
6. API 403은 DB 상태 불변과 direct PostgREST/RLS 차단을 대신하지 못한다.
7. 로컬 화면은 preview/production live 판정을 대신하지 못한다.
8. 과거 PASS는 새 candidate의 출처가 될 수 있지만 결과로 승계되지 않는다.

## 5. 공통 검수 게이트

새 `10-t10-gate.md`는 모든 후보에 다음 순서를 요구한다.

1. **범위·권위 확인**: WORK-ID, 최신 ROUND, 제품 SPEC, writer/file lease, candidate ref를 확인한다.
2. **변경 무결성**: 변경·삭제 파일, migration catalog, 보호 artifact, 충돌 마커, 비밀값·PII를 검사한다.
3. **정적·빌드**: 저장소가 정의한 lint/typecheck/test/check와 production build를 실행한다.
4. **consumer 회귀**: 변경 producer의 기존 consumer 목록과 client/server import graph를 누적 후보에서 검사한다.
5. **기능·실패·복구**: happy path만이 아니라 권한 없음, 빈 상태, 오류, 취소, retry, refresh, 중복 제출을 검사한다.
6. **시각 게이트**: UI 변경이면 §6을 실행한다. UI 비영향이면 근거를 남기고 `N/A`로 판정한다.
7. **DB·보안 게이트**: DB/RLS/Authz 변경이면 §8을 실제 환경에서 non-skip 실행한다.
8. **live gate**: 외부 provider·배포·Storage·OAuth·worker가 수용조건이면 exact environment에서 실행한다.
9. **증거 완전성**: §7 manifest와 artifact hash/path가 candidate와 일치하는지 T10이 독립 확인한다.
10. **판정 기록**: 결과를 §9 ledger 형식으로 append하고 다음 controller action을 명시한다.

`--no-verify`, 실패 무시, 필수 테스트 제외, 다른 브랜치 서버·오래된 build cache 검사, credential 미주입 skip을 이용한 통과는 즉시 FAIL이다.

## 6. Visual Gate

UI 변경 또는 사용자 경험 판정이 수용조건인 후보는 다음을 모두 충족한다.

### 6.1 실제 화면 증거

- exact candidate에서 렌더한 실제 화면을 사용한다.
- 동일 fixture·권한·상태·viewport·theme의 변경 전후를 비교한다.
- 기본 조합은 데스크톱 라이트/다크, 모바일 라이트/다크이며 제외 시 근거가 필요하다.
- 작은 viewport, 가로 overflow, 키보드 순회, focus-visible, label/name, 상태 알림, 대비, 색상 외 전달을 확인한다.
- reduced-motion 환경에서 필수 정보나 조작이 사라지지 않는지 확인한다.
- 로딩·빈 상태·권한 없음·승인 대기·만료·오류·취소·성공 후 다음 행동 중 관련 상태를 실제로 연다.
- 위험 행동은 영향 → 가역성 → 확인 → 결과와 복구/재로그인 안내를 확인한다.

### 6.2 숨은 다음 시퀀스와 사용자 승인

- 첫 화면만 보지 않고 클릭 뒤 modal/drawer/redirect/retry/refresh/back/다른 Workspace 전환을 끝까지 따라간다.
- 변경 전후와 숨은 다음 시퀀스를 사용자에게 공개한다.
- 결과를 바꿀 수 있는 이해 확인 질문 2~4개를 제시한다.
- 사용자의 명시 승인 전 `MERGE_READY`를 선언하지 않는다.

### 6.3 시각 판정 경계

시각 PASS는 제품 코드, API 권한, DB 보안, 세션 revoke, live OAuth의 PASS가 아니다. 합성 persona·role lens는 검수 fixture일 뿐 실제 권한 전환 UI가 아니다. 작은 조직 기본 UX에서 Platform 1~4급, support mode, permission formula를 숨겨도 내부 P0 계약은 반드시 DB/API에서 검증한다.

## 7. Evidence Manifest와 Artifact Integrity

### 7.1 필수 manifest 필드

각 검사항목은 최소 다음을 기록한다.

```text
verdict_id
work_id
requirement_id / scenario_id
candidate_ref / source_path
base_ref
environment_kind
timestamp_kst
layer: CONTRACT | STATIC | BUILD | UI | API | DB | RLS | LIVE
fixture_id (합성·비식별)
precondition
command_or_action
expected
actual
result: PASS | FAIL | BLOCKED | NOT_RUN | N/A
exit_code_or_state_delta
evidence_path / artifact_hash
skip_count
unresolved
reviewer
```

명령 출력과 화면에는 실제 이메일, 고객명, 원문 업무데이터, token, cookie, OAuth code, service key, 연결문자열을 남기지 않는다. 존재 여부와 redacted 상태만 기록한다.

### 7.2 artifact integrity 필수행

- exact candidate와 증거 candidate가 동일하다.
- changed files와 삭제량을 기록하고 예상 밖 대량 삭제가 없다.
- 현재 보호 문서·SPEC·migration이 존재하고 비어 있지 않다.
- conflict marker가 0이다.
- retired YAML coordination이 되살아나지 않았다.
- 과거 PR/SHA/provider/deploy가 현재 사실로 승격되지 않았다.
- server-only 모듈이 client graph에 들어가지 않았다.
- 공용 반환형·schema 변경이 기존 consumer를 깨지 않는다.
- 부분 patch 뒤 변경하지 않은 field/namespace가 실제 값으로 보존된다.
- 비밀값·PII·실제 고객 데이터가 diff와 evidence에 없다.
- 문서 링크가 현재 권위 경로를 가리키고 superseded 문서를 SSOT로 참조하지 않는다.

파일 존재만으로 무결성을 PASS하지 않는다. source path/ref, non-empty, hash 또는 내용 단언, 삭제·충돌·민감정보 검사가 함께 있어야 한다.

## 8. 실제 DB·RLS Non-skip Gate

P0 Authz와 DB/RLS 후보는 `03-p0-authz-contract.md`와 `08-test-matrix.md`의 전체 관련 manifest를 실제 Supabase/Postgres에서 실행한다.

필수 조건은 다음과 같다.

1. 적용된 migration catalog와 exact candidate를 비밀값 없이 증명한다.
2. 조직 A와 조직 B에 실제 존재하는 합성 fixture를 먼저 증명한다.
3. 허용 동작의 positive proof와 차단 동작의 negative proof를 모두 남긴다.
4. direct PostgREST, RPC, RLS, constraint/trigger, app/service 계층을 관련 범위에서 각각 검사한다.
5. Owner exact-one, direct org/membership DML 차단, Platform/Workspace 분리, invite 원자성, profile 격리, session cutoff, audit fail-closed를 검증한다.
6. 동시 Owner transfer, invite replay, rollback failure injection 등 동시성·원자성 검사를 포함한다.
7. role/scope 변경·membership 제거·Owner 이전 직후의 기존 JWT와 refresh를 검사한다.
8. account-wide all-device logout과 Workspace cutoff를 구분해 검사한다.
9. 공격검사 1~55 또는 최신 계약이 요구하는 전체 행의 `skip_count=0`을 확인한다.
10. DB 전후 row count·상태 불변을 기록하되 PII와 secret을 출력하지 않는다.

환경이나 credential이 없으면 `BLOCKED`, 실행하지 않았으면 `NOT_RUN`이다. mock, UI hide, 정적 SQL 검색, 테스트 파일 존재, API 403, 항상 참인 단언은 실DB PASS가 아니다.

## 9. Append-only Verdict History

### 9.1 기록 원칙

- 활성화 이후 새 판정은 `10-t10-verdict-history.md` 끝에만 추가한다.
- 과거 record를 수정·삭제·재정렬하지 않는다.
- 오판 정정은 새 record를 추가하고 `supersedes_verdict_id`로 연결한다.
- 동일 candidate 재실행도 새 verdict ID를 사용한다.
- FAIL/BLOCKED/NOT_RUN을 PASS로 덮어쓰지 않는다. 후속 PASS가 앞선 실패를 해소한 근거를 연결한다.
- 구 체크리스트의 과거 기록은 `LEGACY-NONAUTHORITATIVE`로 한 번만 참조하고 새 ledger로 복사하지 않는다.
- 실제 계정·고객 데이터·비밀값·원문 로그를 기록하지 않는다.

### 9.2 record 형식

```markdown
## VERDICT-YYYYMMDD-NNN

- WORK-ID:
- scope:
- candidate_ref:
- base_ref:
- environment:
- verdict: PASS — CONTRACT ONLY | PASS — IMPLEMENTATION CANDIDATE ONLY |
  PASS — VISUAL ONLY | PASS — LIVE <ENV> ONLY | MERGE_READY |
  RELEASE_READY | FAIL | BLOCKED | NOT_RUN
- required_rows / pass / fail / blocked / not_run / n_a:
- evidence_manifest:
- artifact_integrity:
- unresolved:
- controller_action:
- supersedes_verdict_id: none
- reviewer: T10
- timestamp_kst:
```

### 9.3 이관 시작 record

새 ledger의 첫 record는 `T10-GATE-SSOT-APPLY-01` 자체를 기록한다. verdict는 새 파일·링크·superseded 표식·정적 검사가 모두 확인되기 전 `NOT_RUN`이며, T10 독립 PASS 뒤에만 `PASS — CONTRACT ONLY`를 append한다.

## 10. 구문서 처리 계약

`docs/coordination/T10-gate-checklist.md`는 삭제·이동·내용 재작성하지 않는다. MWC만 파일 맨 위에 다음 의미의 짧은 배너를 추가한다.

```text
SUPERSEDED / HISTORY ONLY
현재 검수 SSOT가 아니다. 현재 규칙은 docs/design/round-21/10-t10-gate.md,
실행 행렬은 docs/design/round-21/08-test-matrix.md를 사용한다.
아래 PR/SHA/배포/정책 수/명령은 당시 기록이며 현재 사실이나 승인 근거가 아니다.
새 verdict를 이 파일에 추가하지 않는다.
```

배너는 현재 경로와 활성화 record를 함께 가리켜야 한다. 과거 본문을 지우거나 그 안의 취약 권한 문구를 현재 계약에 맞게 고쳐 역사적 증거를 변조하지 않는다.

## 11. MWC Controller-only 적용 절차

아래 절차는 MWC/HUB controller만 실행한다. T10·DEV·T04·다른 트랙은 적용 파일을 수정하지 않는다.

### Phase A — 후보 생성

1. 최신 `ROUND-N.md`, `round-21/INDEX.md`, 02·03·08, Round 23 INDEX를 다시 읽는다.
2. 실제 worktree, writer/file lease, dirty overlap을 확인한다. 다른 writer가 대상 파일을 수정 중이면 중단한다.
3. 번호를 선점하지 말고 다음 coordination ROUND 번호는 실제 적용 시점에 재확인한다.
4. 다음 두 신규 파일의 단독 HUB_WRITE lease를 연다.
   - `docs/design/round-21/10-t10-gate.md`
   - `docs/design/round-21/10-t10-verdict-history.md`
5. 이 명세의 규칙만 현재 계약 문구로 옮긴다. 구 체크리스트 본문을 복사하지 않는다.
6. 새 gate 상태를 `CANDIDATE / NOT ACTIVE`로, ledger 첫 행을 `NOT_RUN`으로 둔다.
7. 새 파일의 존재·비공백, 링크, 금지 문구, secret/PII 부재, conflict marker 0을 정적으로 검사한다.
8. T10에 `T10-GATE-SSOT-APPLY-01 / CANDIDATE REVIEW`를 보내 독립 판정을 받는다.

### Phase B — 권위 전환

T10 후보 검수가 PASS일 때만 MWC가 하나의 controller-owned 문서 변경 묶음으로 다음을 실행한다.

1. `docs/design/round-21/INDEX.md`와 `docs/coordination/T10-gate-checklist.md`의 독점 lease를 추가로 확보한다.
2. 새 gate의 상태를 `ACTIVE`로 바꾸고 authority priority, 활성화 시각, source ROUND를 기록한다.
3. 새 ledger 끝에 `T10-GATE-SSOT-APPLY-01`의 `PASS — CONTRACT ONLY` record를 append한다.
4. 구 체크리스트 최상단에 §10의 `SUPERSEDED / HISTORY ONLY` 배너만 추가한다.
5. Round 21 INDEX의 T10 artifact 링크를 `./10-t10-gate.md`로 교체한다.
6. INDEX의 T10 상태를 다음처럼 분리한다.
   - gate migration: `PASS — CONTRACT ONLY`
   - VISUAL: 기존 범위가 있다면 `PASS — VISUAL ONLY`
   - CODE/DB/LIVE: 실제 상태에 따라 `NOT_RUN/BLOCKED`; 자동 승격 금지
7. 최신 coordination 기록에는 구문서 폐기와 새 권위 활성화만 남긴다. Round 23을 과거 사실과 다르게 고치지 말고, 적용 시점의 다음 순번 ROUND에 기록한다.
8. 아래 activation 검사를 수행한 뒤에만 lease를 닫는다.

### Phase C — activation 검사

- Round 21 INDEX가 구 체크리스트가 아니라 새 gate를 가리킨다.
- 구 체크리스트 첫 화면에 superseded 배너가 보인다.
- 새 gate와 ledger가 존재하고 비어 있지 않다.
- 새 gate가 02·03·08의 상대 경로를 정확히 가리킨다.
- 새 gate에 retired YAML, dev cookie 절차, 이메일 allowlist Owner, broad directory, 일반 RPC Owner 변경이 실행 규칙으로 존재하지 않는다.
- contract/implementation/visual/DB/live/release verdict가 분리돼 있다.
- 실DB 필수행의 skip 허용 문구가 0이다.
- ledger의 기존 record가 수정되지 않았고 새 record만 끝에 추가됐다.
- conflict marker, 예상 밖 삭제, 비밀값·PII가 0이다.
- T10이 최종 candidate를 다시 읽고 `T10-GATE-SSOT-ACTIVATION-VERIFY-01`로 판정한다.

### 중단·복구

- Phase A가 실패하면 새 파일을 `CANDIDATE / BLOCKED`로 유지하고 권위 링크를 바꾸지 않는다.
- Phase B 일부만 적용되면 새 제품 변경과 모든 merge/release 판정을 중단한다. 현재 02·03·08을 임시 권위로 유지하며 구문서를 다시 SSOT로 승격하지 않는다.
- 링크·배너·ACTIVE 상태 중 하나라도 불일치하면 activation은 FAIL이다. controller가 forward-fix한 뒤 T10이 전체 묶음을 재검수한다.
- 복구를 위해 구 체크리스트의 취약 권한 규칙을 다시 활성화하거나 과거 PASS를 재사용하지 않는다.

## 12. 적용 수용조건

`T10-GATE-SSOT-APPLY-01`은 다음이 모두 참일 때만 완료다.

1. 새 gate·ledger가 제품 허브에 존재하고 비어 있지 않다.
2. Round 21 INDEX T10 링크가 새 gate로 바뀌었다.
3. 구 체크리스트는 history-only 배너를 갖고 새 verdict를 받지 않는다.
4. 02·03·08과의 권위·참조 관계가 명확하다.
5. contract·implementation·visual·live DB·live environment·merge·release verdict가 혼합되지 않는다.
6. P0 실DB 공격검사 non-skip과 두 tenant positive/negative 증거가 필수다.
7. 실제 화면·전후 비교·숨은 다음 시퀀스·이해 확인·사용자 승인 gate가 있다.
8. artifact integrity와 cumulative consumer/build gate가 있다.
9. verdict history는 append-only이며 정정은 superseding record로만 한다.
10. 폐기 coordination, 낡은 현재성, 취약 권한 경로가 실행 규칙으로 부활하지 않는다.
11. 활성화 diff와 evidence에 실제 개인정보·token·cookie·비밀값이 없다.
12. T10 activation 재검수 결과가 `PASS — CONTRACT ONLY`다.

이 PASS는 새 검수 체계의 계약 활성화만 뜻한다. 제품 코드·DB·실환경·merge·release 상태는 각각 별도 증거와 verdict가 필요하다.

## 13. Blindspot Pass

### 전체 → 부분 → 전체

- 전체: 사용자는 하나의 명확한 검수 경로를 원하지만, 검수 문서가 제품 계약보다 강해져 보안 결정을 되돌리면 안 된다.
- 부분: 규칙, 도메인 계약, 실행 행렬, 판정 이력을 분리하고 각 PASS 층을 독립시킨다.
- 다시 전체: 구문서를 단순 삭제하면 결함 재발 방지 근거를 잃고, 그대로 유지하면 낡은 권한과 현재성이 부활한다. history-only 보존과 새 SSOT 전환을 함께 해야 한다.

### 확정·미결정·맹점

- 확정: old checklist는 권위가 아니며, Platform/Workspace 분리·Owner 보호·tenant 격리·실DB non-skip·증거 기반 T10 판정을 유지한다.
- 적용 시 확인: 실제 최신 ROUND 번호, controller lease, 새 gate 활성화 시각, 당시 candidate ref.
- 맹점: 직접 경로로 구문서를 여는 사람, 부분 적용 중 링크 단절, append-only ledger의 충돌, 과거 PASS 재인용, 로그·스크린샷에 포함되는 개인정보.

### 지금 / 실험 / 백로그 / 기각

| 구분 | 내용 |
|---|---|
| 지금 | 새 gate 후보·ledger 생성, T10 검수, controller-only 링크 전환과 superseded 배너 |
| 실험 | 없음. 이 작업은 검수 권위 교체이며 UX 실험이 아님 |
| 백로그 | evidence manifest 자동 검증, verdict ledger lint, stale-link 검사 자동화 |
| 기각 | 구 체크리스트 증분 보수, 과거 PR/SHA 현재화, broad 권한 부활, skip PASS, history 덮어쓰기 |

## 14. 상태 영수증

| 주체 | 현재 상태 | 다음 행동 |
|---|---|---|
| 사용자 | 추가 기능 결정 없음 | 실제 merge/release 승인 단계에서 별도 명시 승인 |
| MWC/HUB controller | `APPLY NOT RUN` | `T10-GATE-SSOT-APPLY-01` lease와 후보 생성 |
| DEV/CODE/DB | `HOLD / NOT AUTHORIZED` | 새 gate만으로 구현 착수 금지 |
| T10 | `SPEC AUTHORED / APPLY NOT REVIEWED` | 후보·activation 두 단계 독립 검수 |
| 기존 체크리스트 | `NONAUTHORITATIVE / BANNER NOT APPLIED` | MWC Phase B에서 history-only 표식 |


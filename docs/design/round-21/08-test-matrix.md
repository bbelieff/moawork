# 작은 조직 통합 검수 행렬 — REVIEW SPEC

> WORK-ID: `SMALL-ORG-TEST-MATRIX-01`  
> Artifact type: `REVIEW SPEC`  
> 상태: **Draft / NOT_RUN / PASS 0건**  
> 작성 범위: 3분 시작, 오늘의 MoaWork, 우리 팀 키우기, 데이터 가져오기  
> 즉시 다음 WORK-ID: `T10-EVIDENCE-EXECUTION-01`  
> 다음 소비자: T10 독립 수용·시각 게이트 reviewer

이 문서는 작은 조직 핵심 여정의 제품 허브 검수 정본이다. 설계안, 구현 존재, 테스트 파일 존재만으로 통과를 선언하지 않는다. 합성 fixture로 실제 후보 SHA를 실행하고 UI·API·실DB 증거를 모두 남긴 뒤 T10만 최종 판정한다.

## 1. 해결할 문제와 사용자 가치

1명, 3명, 10명 조직에서 역할과 데이터 양이 달라져도 사용자가 첫 가치를 빠르게 얻고, 매일 할 일을 이해하며, 팀을 안전하게 키우고, 기존 데이터를 중복·유실 없이 가져올 수 있어야 한다. 동시에 다음 실패를 P0에서 차단해야 한다.

- 다른 Workspace의 존재·행·집계·검색·최근 기록이 보이는 tenant 누출
- 유일한 보호 Owner가 사라지거나 우회 변경되는 권한 붕괴
- 중지되거나 권한이 바뀐 사용자의 기존 세션 재사용
- 초대·빠른 추가·가져오기의 중복 제출 또는 새로고침 재실행
- 오류를 성공 또는 정상 빈 상태로 오인시키는 UI
- 모바일·다크 모드에서 핵심 행동, 오류, 취소·복구가 사라지는 시각 결함

사용자 가치는 “기능이 있다”가 아니라 다음 네 결과로 측정한다.

| 여정 | 작은 조직의 완료 가치 |
|---|---|
| 3분 시작 | Owner가 회사→첫 고객→첫 업무→홈을 3분 안에 완료하고, 초대 사용자는 기존 Workspace에 바로 합류한다. |
| 오늘의 MoaWork | 역할에 맞는 오늘 할 일과 다음 행동을 10초 안에 이해한다. |
| 우리 팀 키우기 | 초대·역할·팀·접근 중지를 원자적으로 처리하고 보호 Owner와 업무 기록을 보존한다. |
| 데이터 가져오기 | preview 전에는 쓰지 않고, commit은 멱등이며 오류·취소·rollback이 기존 데이터를 해치지 않는다. |

## 2. 결정 상태

### 2.1 확정 결정

- Workspace가 tenant 경계다. Platform Admin과 Workspace 역할은 별도 control-plane이다.
- 보호 Owner는 정확히 1명이며 successor 없이 제거·강등·탈퇴할 수 없다.
- owner 보호 > tenant 격리 > 최소권한 > 위임 자유도 > 직관적 UX 순으로 충돌을 해결한다.
- identity, 전역 profile, Workspace membership, Workspace profile을 분리한다.
- 초대 생성·수락·membership 생성과 멱등성은 원자적으로 검증한다.
- 접근 중지·역할 변경은 기존 세션·열린 탭·refresh·API 재사용까지 차단한다.
- 실제 Supabase/Postgres DB/RLS 실행이 skip되면 P0 보안 PASS가 아니다.
- 실제 개인정보, 토큰, 쿠키, 인증 비밀은 fixture·로그·스크린샷·문서에 기록하지 않는다.
- 최종 판정자는 T10이다. DEV 자기 판정은 실행 영수증일 뿐 승인으로 간주하지 않는다.

### 2.2 추천 Draft

- `ORG-1`, `ORG-3`, `ORG-10`, `TENANT-B`를 공통 합성 fixture 세트로 사용한다.
- 멱등성 키는 최소 `workspace_id + operation/batch_id`로 구성하며 파일명만 사용하지 않는다.
- 오류·재시도 검수는 네트워크 실패 주입과 DB 전후 행 수를 함께 증명한다.
- 증거 파일명은 `{flow}-{role}-{org_size}-{state}-{viewport}-{theme}` 형식을 사용한다.
- 검수 결과 어휘는 `PASS | FAIL | BLOCKED | NOT_RUN` 네 가지로 제한한다.

### 2.3 미결정 / answer-blocked

| ID | 미결정 | 임시 검수 원칙 | 결정 주체 |
|---|---|---|---|
| D-01 | 팀장의 초대·가져오기 기본 권한과 위임 범위 | 기본 deny, 명시 위임만 허용 | 사용자/제품 |
| D-02 | 3분 시작의 최종 완료 이벤트 | 첫 업무 생성 후 홈에서 다음 행동이 보이는 시점으로 측정 | 사용자/제품 |
| D-03 | 가져오기 부분 성공 허용 여부 | preview에서 전량 오류 공개, commit 정책 선택 전 PASS 보류 | 사용자/제품 |
| D-04 | 중복 판정 키와 충돌 시 overwrite/skip UX | silent overwrite 금지 | 사용자/제품 |
| D-05 | 멤버 제거 시 업무 이전의 필수 범위와 보존 기간 | successor/담당자 지정 전 파괴적 완료 차단 | 사용자/법무 |

T03 원문 `03-p0-authz-contract.md`의 `REQUIRED AMENDMENT A1`과 공격·경계 테스트 41~55는 확인·흡수했다. 이 계약의 존재는 구현 PASS가 아니며, 1~55 전체의 실DB non-skip 실행과 T10 독립 판정이 여전히 필요하다.

## 3. 공통 검수 계약

### 3.1 조직·역할 fixture

| Fixture | 구성 | 필수 데이터 |
|---|---|---|
| `ORG-1` | 보호 Owner 1명 | 빈 상태와 최소 고객/업무 상태, owner count=1 |
| `ORG-3` | Owner 1, 팀장 1, 사원 1 | 각 역할의 본인/팀/조직 범위 데이터 |
| `ORG-10` | Owner 1, 팀장 2, 사원 7 | 두 팀, 충분한 목록 밀도, 권한 경계 밖 데이터 |
| `TENANT-B` | 완전히 분리된 공격 대상 Workspace | 존재하는 사용자·고객·업무·초대·집계 행; A 계정에는 권한 없음 |

모든 식별자는 합성값이어야 한다. 실제 사용자 이메일·전화번호·고객명·토큰·쿠키를 사용하지 않는다.

### 3.2 역할 경계

| 기능 | Owner | 팀장 | 사원 | Platform Admin 단독 |
|---|---|---|---|---|
| Workspace 생성 | 허용 | 금지 | 금지 | Workspace membership 없으면 금지 |
| 고객·업무 | 전사 범위 | 위임된 팀 범위 | 본인/배정 범위 | 금지 |
| 조직 요약 | 전사 범위 | 팀 범위 | 본인 범위 | 금지 |
| 초대 | 허용 | 기본 deny, 위임 시 제한 허용 | 금지 | 금지 |
| 역할·팀 변경 | 허용, 보호 Owner 규칙 적용 | 위임 팀 내 제한 | 금지 | 금지 |
| 데이터 가져오기 | 허용 | 기본 deny, 위임 시 제한 허용 | 금지 | 금지 |
| 접근 중지·업무 이전 | 허용 | 위임 범위만 | 금지 | Workspace 제어 권한 없음 |

### 3.3 화면·viewport·접근성

| ID | 환경 | 필수 검사 |
|---|---|---|
| `D-L` | 1280×720, light | 첫 viewport 핵심 CTA, 대비, overflow |
| `D-D` | 1280×720, dark | 텍스트·오류·disabled·focus 대비 |
| `M-L` | 390×844, light | touch target, CTA·취소·오류 접근 |
| `M-D` | 320×568, dark | 최소 폭 overflow, keyboard/focus, reduced-motion |

모든 핵심 시나리오는 `D-L`, `D-D`, `M-L`, `M-D` 중 지정된 조합에서 검증하고, 모바일은 가로 스크롤 없이 핵심 행동·오류·취소·undo에 도달해야 한다.

### 3.4 공통 상태 계약

`empty → input → loading → success → refresh → error → retry → cancel/undo → permission denied`

| 상태 | 화면 계약 | 데이터 계약 |
|---|---|---|
| Empty | 빈 이유, 현재 범위, 다음 행동을 함께 표시 | 권한 오류·서버 오류를 빈 상태로 바꾸지 않음 |
| Input | 필드 옆 오류, 입력 보존 | 미검증 값은 쓰지 않음 |
| Loading | 중복 클릭 방지, 진행 상태 노출 | 같은 명령의 동시 처리 멱등 |
| Success | 변경된 대상과 다음 행동 표시 | 정확히 한 번 반영 |
| Refresh | 테마·완료 상태 유지 | 명령 replay 없음, 권한 서버 재검사 |
| Error | 성공/빈 상태로 위장하지 않고 retry 제공 | 부분 쓰기 여부와 복구 범위 식별 |
| Retry | 이전 입력·batch를 재사용 | 성공 행 중복 없음 |
| Cancel/Undo | 대상·영향·되돌림 범위 명시 | preview cancel은 0 write, rollback은 batch 범위만 |
| Denied | 존재 메타데이터를 노출하지 않음 | UI·API·DB 모두 차단, 상태 불변 |

## 4. 1명/3명/10명 기능 검수 행렬

상태 표기: 이 문서 작성 시 모든 행은 `NOT_RUN` 또는 선행조건이 없는 경우에도 실행 전이므로 `NOT_RUN`이다. `WAIT-P`는 구현/fixture/환경 대기, `WAIT-D`는 사용자 결정 대기다.

### 4.1 3분 시작 — S01~S10

| ID | 규모·역할 | 시나리오와 기대 결과 | 계층 | 상태 |
|---|---|---|---|---|
| S01 | ORG-1 Owner | 회사→첫 고객→첫 업무→홈을 3분 안에 완료하고 홈에 다음 행동 표시 | UI/API/DB | WAIT-P, WAIT-D(D-02) |
| S02 | ORG-3 팀장 | 초대 첫 로그인 시 기존 Workspace로 진입; Workspace 재생성 없음 | UI/API/DB | WAIT-P |
| S03 | ORG-3 사원 | 미배정 첫 로그인에 안전한 빈 상태와 다음 행동; 타인 데이터 없음 | UI/API/DB/RLS | WAIT-P |
| S04 | ORG-10 전 역할 | 기존 멤버에게 onboarding을 반복하지 않고 역할 범위 홈 표시 | UI/API | WAIT-P |
| S05 | ORG-1 Owner | Workspace 생성 오류 후 입력 보존·재시도; 결과 1건 | UI/API/DB | WAIT-P |
| S06 | ORG-1 Owner | 회사·고객·업무 double-submit/refresh에도 각각 1건 | UI/API/DB | WAIT-P |
| S07 | ORG-3 팀장·사원 | Workspace 생성 direct API를 호출해도 denied·0 write | API/DB/RLS | WAIT-P |
| S08 | A→TENANT-B | B slug/id 주입 시 UI·검색·API·DB가 0/404, 존재·집계 비노출 | UI/API/DB/RLS | WAIT-P |
| S09 | ORG-1 Owner | 유일 Owner 제거·강등·탈퇴 차단, successor 경로 제공 | UI/API/DB | WAIT-P |
| S10 | 전 규모·역할 | D-L/D-D/M-L/M-D에서 CTA first viewport, 대비·overflow 정상 | UI/Visual | WAIT-P |

필수 refresh 지점은 회사 생성 직후, 고객 생성 직후, 업무 생성 직후, 홈 진입 직후다. 각 지점에서 완료 상태는 유지되고 명령은 재실행되지 않아야 한다.

### 4.2 오늘의 MoaWork — H01~H12

| ID | 규모·역할 | 시나리오와 기대 결과 | 계층 | 상태 |
|---|---|---|---|---|
| H01 | ORG-1 Owner | 빈 홈에 핵심 CTA 하나와 이유·다음 행동 표시 | UI | WAIT-P |
| H02 | ORG-1 Owner | 데이터가 있으면 업무·최근 항목·검색·요약이 같은 범위로 표시 | UI/API/DB | WAIT-P |
| H03 | ORG-3 Owner | 조직 요약과 본인 행동을 구분, 전사 범위만 표시 | UI/API/DB | WAIT-P |
| H04 | ORG-3 팀장 | 본인+위임 팀만 표시, 다른 팀 직접 URL 차단 | UI/API/DB/RLS | WAIT-P |
| H05 | ORG-3 사원 | 본인/배정 항목만 표시, 동료 항목 직접 URL 차단 | UI/API/DB/RLS | WAIT-P |
| H06 | ORG-10 전 역할 | 고밀도 목록에서도 핵심 행동이 첫 화면과 키보드 순서에서 유지 | UI/Visual | WAIT-P |
| H07 | A→TENANT-B | 검색·자동완성·최근 검색·집계에서 B 데이터와 존재 비노출 | UI/API/DB/RLS | WAIT-P |
| H08 | 접근 중지 사용자 | 최근 항목·back button·열린 탭·refresh에서 즉시 접근 차단 | UI/API/DB/Session | WAIT-P |
| H09 | 전 규모 | widget 부분 실패는 전체 blank/success로 위장하지 않고 범위별 retry | UI/API | WAIT-P |
| H10 | 전 규모 | quick-add double-submit에도 레코드 1건 | UI/API/DB | WAIT-P |
| H11 | 전 규모 | refresh/theme 유지, 서버에서 최신 권한 재검사 | UI/API/Session | WAIT-P |
| H12 | 전 규모 | 빈 값은 `—`, NaN·잘림·색상만으로 상태 전달 없음 | UI/Visual | WAIT-P |

행 수·미처리 건수·요약 수치도 데이터로 취급한다. 허용되지 않은 tenant/팀의 실데이터를 숨기고 집계만 노출하는 것도 P0 누출이다.

### 4.3 우리 팀 키우기 — T01~T13

| ID | 규모·역할 | 시나리오와 기대 결과 | 계층 | 상태 |
|---|---|---|---|---|
| T01 | ORG-1 Owner | 팀장·사원 초대, 역할과 pending 상태 명확 | UI/API/DB | WAIT-P |
| T02 | ORG-3 Owner | 같은 사람 반복 초대 시 active invite 1건, resend는 별도 행위 | UI/API/DB | WAIT-P |
| T03 | 초대 사용자 | accept refresh/retry/concurrency에도 membership 1건 원자 생성 | UI/API/DB | WAIT-P |
| T04 | 공격 사용자 | 탈취·재사용·만료·폐기·다른 identity 토큰 모두 denied | API/DB | WAIT-P |
| T05 | ORG-3 팀장 | 위임 팀 안에서만 첫 업무 배정 | UI/API/DB | WAIT-P, WAIT-D(D-01) |
| T06 | ORG-10 팀장 | Owner·다른 팀 역할/팀 변경을 UI/API/DB 모두 차단 | UI/API/DB/RLS | WAIT-P |
| T07 | ORG-3 사원 | forged invite·등급·팀 변경 차단, 상태 불변 | API/DB/RLS | WAIT-P |
| T08 | ORG-1 Owner | self remove/demote/leave 차단, successor 요구 | UI/API/DB | WAIT-P |
| T09 | ORG-3 Owner→멤버 | 접근 중지 후 기존 세션·탭·refresh·API 즉시 차단 | UI/API/DB/Session | WAIT-P |
| T10 | ORG-10 Owner | 업무 보유 멤버 제거 전 이전 제공, 업무·감사 tombstone 보존 | UI/API/DB/Audit | WAIT-P, WAIT-D(D-05) |
| T11 | ORG-10 Owner | seat 경계에서 초과 초대가 명확히 차단되고 중복 과금/멤버 없음 | UI/API/DB | WAIT-P |
| T12 | A→TENANT-B | B invite/member ID 주입 denied, 존재 비노출·0 write | UI/API/DB/RLS | WAIT-P |
| T13 | 전 규모 | 모바일 destructive/error/retry/undo에서 버튼·문구 잘림 없음 | UI/Visual | WAIT-P |

Owner 공격 최소 세트: self-demotion hidden API, 두 번째 Owner 생성 후 보호 Owner 제거, stale tab replay, 팀장의 Owner 편집, B membership 주입, 접근 중지 뒤 old-session replay. 하나라도 성공하면 전체 후보를 P0 반려한다.

### 4.4 데이터 가져오기 — I01~I16

| ID | 규모·역할 | 시나리오와 기대 결과 | 계층 | 상태 |
|---|---|---|---|---|
| I01 | ORG-1 Owner | 빈 파일/header-only: 0 write, 명확한 안내 | UI/API/DB | WAIT-P |
| I02 | ORG-1 Owner | 정상 CSV preview 0 write, commit 후 정확한 행 수 | UI/API/DB/Worker | WAIT-P |
| I03 | ORG-3 Owner | 정상 monday export 매핑과 결과 확인 | UI/API/DB/Worker | WAIT-P |
| I04 | ORG-3 Owner | valid/error 혼합 파일의 행별 오류·정책 노출 | UI/API/DB | WAIT-P, WAIT-D(D-03) |
| I05 | ORG-3 Owner | 파일 내부 중복을 preview에서 식별, silent duplicate 없음 | UI/API/DB | WAIT-P, WAIT-D(D-04) |
| I06 | ORG-10 Owner | 기존 DB 중복을 식별, silent overwrite 없음 | UI/API/DB | WAIT-P, WAIT-D(D-04) |
| I07 | ORG-10 Owner | double-submit/같은 파일 재전송에도 batch 1개·행 중복 없음 | UI/API/DB/Worker | WAIT-P |
| I08 | ORG-10 Owner | refresh 후 같은 batch 진행/결과를 복구, 새 batch 생성 없음 | UI/API/DB/Worker | WAIT-P |
| I09 | ORG-10 Owner | network/worker 오류 retry에도 성공 행 재삽입 없음 | UI/API/DB/Worker | WAIT-P |
| I10 | 전 규모 Owner | preview cancel 후 DB/file/job 영구 쓰기 0 | UI/API/DB/Storage/Worker | WAIT-P |
| I11 | 전 규모 Owner | rollback은 해당 batch 행만 제거, 기존·이후 수정 행 보호 | UI/API/DB/Audit | WAIT-P |
| I12 | 팀장·사원 | UI 숨김뿐 아니라 direct API도 denied, 파일 metadata 비노출 | UI/API/DB | WAIT-P, WAIT-D(D-01) |
| I13 | A→TENANT-B | B destination 주입 preview/commit/rollback 모두 denied·0 write | API/DB/RLS/Worker | WAIT-P |
| I14 | ORG-3 Owner | formula/script/HTML 셀은 실행되지 않는 inert text | UI/API/DB/Export | WAIT-P |
| I15 | ORG-10 Owner | BOM·한글·따옴표·줄바꿈·큰 파일의 경계 처리 | UI/API/Worker | WAIT-P |
| I16 | 전 규모 | progress/error/retry/cancel을 light/dark/mobile에서 식별·조작 | UI/Visual | WAIT-P |

## 5. T03 P0 authz 공격 테스트 41~55

다음은 T03 원문 `03-p0-authz-contract.md`의 `A1 — Workspace 생성과 Exact-one 우회` 41~55를 실행·증거 형식으로 흡수한 행이다. 원문 계약은 준비됐지만 실제 DB 실행 전이므로 결과는 모두 `NOT_RUN`이다.

| Test ID | 공격·경계 입력 | 불변식/기대 결과 | 관련 시나리오 | 필수 계층·증거 | 현재 |
|---|---|---|---|---|---|
| A1-41 | authenticated 사용자가 PostgREST direct org INSERT | privilege와 policy에서 거부되고 org row 0 | S06,S07 | PostgREST/DB/RLS; 요청·오류 유형·전후 org count | NOT_RUN |
| A1-42 | authenticated direct org UPDATE/DELETE | 두 동작 모두 거부되고 기존 org 상태 불변 | S07,S09 | PostgREST/DB/RLS; UPDATE/DELETE 각각 전후 diff | NOT_RUN |
| A1-43 | SECURITY DEFINER가 아닌 임의 client 경로로 org 생성 | 생성 불가, org/owner/profile/audit 모두 0 | S06,S07 | App/API/DB; 호출 경로와 4개 table count | NOT_RUN |
| A1-44 | `create_workspace_with_owner` 정상 호출 | org 1, Owner 1, `scope=all`, profile 1, audit 1 | S01,S06 | RPC/DB/Audit; request id와 정확한 final counts | NOT_RUN |
| A1-45 | RPC 내부 Owner membership INSERT 실패 주입 | org/profile/audit까지 모두 rollback되어 0 | S05,S06 | RPC/DB transaction; failure injection·전후 counts | NOT_RUN |
| A1-46 | RPC 내부 audit INSERT 실패 주입 | org/Owner/profile까지 모두 rollback되어 0 | S05,S06 | RPC/DB/Audit; failure injection·전후 counts | NOT_RUN |
| A1-47 | test-only privileged transaction에서 org만 INSERT 후 commit | deferred org trigger가 commit을 거부, owner 없는 org 0 | S06,S09 | Direct DB/constraint trigger; commit failure·count | NOT_RUN |
| A1-48 | Owner 없는 org restore/import transaction | commit 거부, 복원된 owner 없는 org 0 | S09,I02,I11 | DB/constraint trigger; lifecycle 전후 상태 | NOT_RUN |
| A1-49 | org와 Owner를 같은 transaction에서 restore | commit 성공, Owner count 정확히 1 | S09,I11 | DB/constraint trigger; transaction log·final count | NOT_RUN |
| A1-50 | 대체 Owner 없이 현재 Owner DELETE | deferred membership trigger가 commit 거부, 기존 Owner 보존 | S09,T08 | DB/constraint trigger; DELETE 시도·rollback diff | NOT_RUN |
| A1-51 | 같은 transfer transaction에서 old Owner 제거 후 new Owner 삽입 | commit 성공, 중간 mutation과 무관하게 최종 Owner count 1 | S09,T08 | RPC/DB/concurrency; old/new role·final count | NOT_RUN |
| A1-52 | Owner membership의 `org_id`를 바꿔 OLD org를 Owner 0으로 만듦 | OLD org 검증으로 commit 거부, 양쪽 org 불변 | S08,S09,T12 | DB/constraint trigger/RLS; OLD·NEW 전후 counts | NOT_RUN |
| A1-53 | 008 적용 뒤 compatibility bridge로 Workspace 생성 | RPC로 성공하고 direct fallback 호출 수 0 | S01,S06 | App/RPC/DB; branch trace·final counts | NOT_RUN |
| A1-54 | 008 미적용 bridge 환경에서 RPC 오류 주입 | 정확한 function-not-found만 fallback; 권한·constraint·audit·network 오류는 fail closed | S05,S06 | App/API; 오류별 branch trace·DB diff | NOT_RUN |
| A1-55 | strict app release 코드·호출·fixture 검사 | legacy direct org INSERT 코드·실행 호출·test fixture 모두 0 | S01,S06,S07 | Static/App/Integration; search manifest+runtime trace | NOT_RUN |

### 5.1 T03 전체 공격군과 중복 제거

T03가 전달한 40개 기존 검사와 41~55를 숫자 합계만으로 통과시키지 않는다. manifest에는 각 `T03_case_id`가 정확히 한 번 나타나고 primary group 하나를 가져야 한다.

| Primary group | 계약 | SMALL-ORG 연결 | 41~55 |
|---|---|---|---|
| G1 Direct org DML 차단 | PostgREST·client·UPDATE·DELETE 우회 0 | S06,S07,S09 | 41,42,43 |
| G2 Atomic create RPC | 정상 결과 exact count와 부분 실패 전량 rollback | S01,S05,S06 | 44,45,46 |
| G3 Deferred exact-one | org/owner/restore/org_id 변경의 commit-time 검증 | S08,S09,T08,T12,I11 | 47,48,49,50,51,52 |
| G4 Compatibility bridge | 008 뒤 RPC-only, 008 전 function-not-found만 제한 fallback | S01,S05,S06 | 53,54 |
| G5 Strict cutover | legacy direct insert 코드·호출·fixture 제거 | S01,S06,S07 | 55 |

manifest 완전성 조건:

- 기존 `T03_case_id` 1~40은 unique count 40이어야 한다.
- 추가 `A1-41`~`A1-55`는 unique count 15이어야 한다.
- 각 케이스는 primary group 정확히 1개, 관련 SMALL-ORG 시나리오 1개 이상을 갖는다.
- 결과 합계는 전체 manifest 행 수와 같아야 하며 skip/미실행은 `PASS`가 아니라 `NOT_RUN` 또는 `BLOCKED`다.
- 41~55는 `03-p0-authz-contract.md` A1 원문과 대조됐지만, 계약 일치는 실행 PASS를 뜻하지 않는다.

## 6. artifact → requirement → test traceability

경로가 없는 upstream 아티팩트는 계약 이름으로만 참조하며 `WAIT-P`다. 아티팩트가 생겼다는 사실만으로 하위 검사가 PASS되지는 않는다.

| Upstream artifact/contract | Requirement | Test scenarios | Fixture | 실행 계층 | 필수 증거 | 판정 책임 |
|---|---|---|---|---|---|---|
| `01-first-value-concepts.md` | FV: 3분 첫 가치·초대 합류 | S01~S10 | ORG-1/3/10, B | UI/API/DB | 시간선, 화면, 전후 행, refresh | DEV 실행 / T10 판정 |
| `05-daily-action-taxonomy.md` | HOME: 역할별 오늘 행동·범위 | H01~H12 | ORG-1/3/10, B | UI/API/DB/RLS | 역할별 화면·expected set·부분 오류 | DEV / T10 |
| `06-small-team-growth.md` | TEAM: 초대·위임·Owner·cutoff | T01~T13 | ORG-1/3/10, B | UI/API/DB/Session | 초대/멤버 count, audit, old-session | DEV / T10 |
| `07-safe-import-contract.md` | IMPORT: preview·멱등·rollback | I01~I16 | ORG-1/3/10, B | UI/API/DB/Worker/Storage | batch 전후, job, retry, rollback | DEV / T10 |
| `03-p0-authz-contract.md` | TENANT/OWNER/SESSION/AUTHZ + A1 exact-one | S07~S09,H03~H08,H11,T02~T12,I06,I12,I13,A1-41~55 | ORG-1/3/10, B | UI/API/RPC/DB/RLS/Session | real-DB 1~55 manifest, 허용+차단, audit | T03 계약 / DEV 실행 / T10 판정 |
| T04 실제 화면·4안 후속 artifact | VISUAL | S10,H06,H12,T13,I16 + 공통 상태 | 전 fixture | Browser/Visual/A11y | 전후·hidden sequence·viewport·quiz | T04 작성 / T10 판정 |
| `02-implementation-dag.md` | DEP: 후보 SHA·실행 순서·환경 | 전체 | 후보 SHA 고정 | Build/Test/DB | 명령·revision·환경 상태 | DEV / T10 |
| 후보 코드·migration·fixture | IMPLEMENTATION | 전체 | 합성 데이터 | 실제 실행 계층 | stdout, screenshots, DB diff | DEV 제공 / T10 판정 |
| `08-test-matrix.md` | GATE: 누락·허위 통과 방지 | 전체 | 전체 | Evidence review | 완전성 checklist·판정표 | **T10 독립 reviewer** |

### 6.1 우선순위

| 구분 | 범위 | merge 조건 |
|---|---|---|
| P0 필수 | cross-tenant, Owner, Platform/Workspace 분리, invite 원자성, session cutoff, `users_select`, 중복제출, import cancel/rollback, 개인정보 비노출 | 하나라도 FAIL/BLOCKED/NOT_RUN이면 반려 |
| 기능별 필수 | S01~S10, H01~H12, T01~T13, I01~I16의 해당 구현 범위 | 기능을 merge 후보에 포함했다면 관련 행 전부 증거 필요 |
| 실험 | 문구 변형, CTA 배치, 팀장 위임 기본값 후보, 부분 성공 UX | P0 완화 불가; 사용자 선택 전 승자 확정 금지 |

## 7. 파일·데이터·상태 계약

### 7.1 입력 파일 계약

- 허용 파일 형식·크기·encoding을 화면과 서버에서 동일하게 검증한다.
- CSV/monday export의 수식, script, HTML은 실행하지 않고 inert text로 취급한다.
- preview는 permanent domain row를 쓰지 않는다. 임시 파일·job이 필요하면 TTL과 cancel 삭제 증거를 남긴다.
- commit은 immutable batch ID와 workspace scope를 사용한다.
- rollback은 그 batch가 만든 행 중 이후 사용자가 수정하지 않은 범위만 대상으로 하고, 기존 행을 삭제하지 않는다.

### 7.2 핵심 데이터 불변식

- 모든 domain row와 job/batch/invite/membership에는 서버가 검증한 `workspace_id` 경계가 있다.
- 보호 Owner count는 committed state에서 항상 정확히 1이다.
- 하나의 active invite, 하나의 accepted membership, 하나의 idempotent operation 결과를 보장한다.
- 전역 identity/profile과 Workspace membership/profile의 쓰기 경로·RLS·감사를 분리한다.
- 접근 중지·역할 변경 시 session cutoff 기준시각 이후의 모든 이전 자격을 거부한다.
- 삭제/이전 뒤에도 업무·결재·감사 기록은 정책에 따른 tombstone/익명화 형태로 참조 무결성을 유지한다.

### 7.3 화면 계약

- 사용자는 10초 안에 현재 회사, 역할, 팀 범위, 다음 행동을 말할 수 있어야 한다.
- 파괴적 행동은 대상·영향·선행 이전·복구 가능성을 확인시킨다.
- 권한 거부는 숨긴 리소스의 이름·소유자·행 수·존재 여부를 노출하지 않는다.
- 실제 오류는 빈 상태나 성공 toast로 대체하지 않는다.
- loading, retry, refresh에서 같은 명령이 여러 번 실행되지 않는다.

## 8. 실패·복구·보안·권한 경계

| 실패 | 필수 복구 | 금지되는 거짓 성공 |
|---|---|---|
| 생성 API timeout | 같은 operation ID로 조회/재시도 | 새 행 재생성 |
| widget 부분 실패 | 실패 widget만 retry, 나머지 범위 유지 | 전체 blank 또는 정상 empty |
| 초대 accept 동시성 | 최종 invite 1회 소비·membership 1건 | 부분 consumed/다중 membership |
| 접근 중지 중 열린 화면 | 다음 API와 refresh 즉시 거부·민감 캐시 제거 | 화면이 보인다는 이유로 계속 허용 |
| import worker 재시작 | 같은 batch checkpoint에서 재개 | 성공 행 재삽입 |
| preview cancel | 임시 file/job 정리, permanent write 0 | UI만 닫고 job 계속 실행 |
| rollback 충돌 | 보호되는 기존/수정 행 표시, 안전 범위만 실행 | 광범위 delete |
| cross-tenant ID 주입 | 0/404 정책, 0 row, 0 write | 403 본문/검색/집계로 존재 노출 |

## 9. 실제 DB non-skip 게이트

P0 authz는 mock, UI hide, 정적 분석, 테스트 파일 존재만으로 통과할 수 없다. 다음 증거가 한 세트로 있어야 한다.

1. candidate commit SHA와 적용 migration revision.
2. 실제 Supabase/Postgres에 migration이 적용됐다는 비밀값 없는 상태 증거.
3. `ORG-1/3/10/TENANT-B` 합성 identity와 membership/profile/domain fixture manifest.
4. 동일 요구사항의 허용 요청과 차단 공격 요청 양쪽.
5. UI, API/RPC, direct DB/RLS 실행 결과와 DB 전후 행 수.
6. Owner count, invite/membership count, import batch/job count, audit 결과.
7. session cutoff 전 성공과 cutoff 후 old-session·refresh·open-tab 실패.
8. `users_select`의 expected allowed set과 actual returned set의 정확한 비교.
9. T03 1~40 및 A1-41~55 케이스 manifest와 result total.
10. 실제 개인정보·토큰·쿠키·접속 비밀값이 제거됐다는 증거 검수.

다음은 즉시 반려한다.

- DB env/fixture 부재로 skip했는데 PASS로 보고
- mock/in-memory/emulator 결과만 제출
- 테스트 파일 또는 SQL이 존재하지만 실행 로그 없음
- UI 버튼 숨김만 확인하고 API/DB를 확인하지 않음
- API 403만 있고 DB 상태 불변 증거가 없음
- 정상 Owner UI만 확인하고 hidden API/concurrent/tenant 공격을 생략
- 브라우저 cookie 삭제만으로 session cutoff를 증명
- 55개 중 일부만 실행하고 전체 PASS 주장
- 증거 SHA와 merge 후보 SHA가 다름

## 10. 시각 게이트

### 10.1 공통 판정

| 상태 | 필수 시각 증거 |
|---|---|
| Default | 현재 회사·역할·팀·다음 행동을 10초 안에 식별 |
| Empty | 이유·현재 범위·다음 행동 |
| Loading | 중복 방지와 진행 상태 |
| Success | 변경 대상과 다음 행동 |
| Input error | 인접 오류와 입력 보존 |
| Server error | retry, 성공/빈 상태와 구별 |
| Denied | 존재 metadata 비노출 |
| Destructive | 대상·영향·이전/undo |
| Refresh | 상태·theme 유지와 최신 권한 |
| Mobile | overflow 없음, CTA·cancel·error 접근 |
| Dark | 본문·오류·disabled·focus 대비 |
| Keyboard/A11y | focus 순서, label, status/alert, 색상 외 단서 |

### 10.2 증거 영수증 형식

```text
VISUAL-GATE
- WORK-ID: T10-EVIDENCE-EXECUTION-01
- baseline SHA / candidate SHA
- local URL + exact command
- fixtures: ORG-1 / ORG-3 / ORG-10 / TENANT-B
- roles: Owner / team-lead / employee / Platform-Admin-without-membership
- viewports: D-L / D-D / M-L / M-D
- before screenshot
- after screenshot
- hidden sequences:
  entry -> loading -> action -> success -> refresh
  empty -> denied -> error -> retry -> cancel/undo
- console errors
- failed network injection and recovery
- horizontal overflow
- keyboard/focus result
- cross-tenant result
- Owner attack result
- duplicate result
- T10 verdict
- user explicit approval text/time
```

전후 화면은 같은 fixture·viewport·theme·권한·후보 SHA를 사용한다. UI와 API/DB 증거를 분리하고, 파일명에 흐름·역할·조직 규모·상태·viewport·theme을 포함한다. 로컬 화면은 배포 검증을 대신하지 않으며, merge 게이트라면 실제 merge 후보 SHA와 일치해야 한다.

### 10.3 이해 확인 퀴즈

사용자에게 2~4문항을 제시하고 답과 명시 승인을 기록한다.

1. 3분 시작은 어느 화면·상태에서 완료됐다고 이해했나요?
2. Owner, 팀장, 사원이 오늘의 MoaWork에서 보는 범위는 어떻게 다른가요?
3. 유일한 Owner가 나가거나 강등하려 하면 무엇이 먼저 일어나야 하나요?
4. 가져오기에서 cancel, retry, rollback은 각각 어떤 데이터를 보호하나요?

## 11. 증거 완전성과 허위 통과 방지

각 시나리오 증거 행은 다음을 모두 가져야 한다.

| 필드 | 조건 |
|---|---|
| Scenario/Test ID | 이 문서의 ID와 정확히 일치 |
| Upstream requirement | artifact 경로 또는 계약 ID 연결 |
| Candidate | commit SHA, migration revision, build 식별자 |
| Fixture | 조직 규모·역할·tenant·합성 데이터 revision |
| Layer | UI/API/DB/RLS/Session/Worker 중 실제 실행한 층 |
| Command/steps | 재현 가능한 명령 또는 클릭 순서 |
| Expected/actual | 양쪽을 분리 기록 |
| Positive proof | 허용 경로가 실제로 성공했음을 증명 |
| Negative proof | 공격 경로 차단과 상태 불변 증명 |
| Artifact | screenshot/log/DB diff/audit manifest 위치 |
| Result | PASS/FAIL/BLOCKED/NOT_RUN |
| Reviewer | 실행자와 T10 판정자를 분리 |

허위 통과 방지 규칙:

- 증거가 없으면 `NOT_RUN`, 선행조건이 없으면 `BLOCKED`; 둘 다 PASS가 아니다.
- “오류가 없었다”는 positive proof가 아니다. 기대 행·화면·상태가 나타나야 한다.
- 차단 응답만으로 충분하지 않다. DB 전후 상태와 숨은 metadata 비노출을 확인한다.
- 하나의 스크린샷을 여러 상태·viewport·role의 증거로 재사용하지 않는다.
- fixture에 차단 대상 행이 실제로 존재하지 않으면 cross-tenant/RLS 검사가 성립하지 않는다.
- 로그 일부, 오래된 SHA, 개발자 구두 확인, skipped test는 PASS 근거가 아니다.
- T10이 원본 증거를 재현하거나 무결성을 확인할 수 없으면 반려한다.

## 12. P0 반려 조건

다음 중 하나라도 관찰되거나 필요한 증거가 빠지면 T10은 후보를 반려한다.

- cross-tenant 행·필드·이름·검색·최근 기록·aggregate count 누출
- 유일 보호 Owner 제거·강등·탈퇴 또는 일시적 owner 0/2 상태
- Platform Admin이 membership/Workspace 역할 없이 tenant 데이터 접근
- invite, membership, workspace, customer, task, import batch/row가 중복 생성
- 접근 중지·role 변경 뒤 old session·refresh·열린 탭·API 접근 성공
- 오류가 성공 또는 정상 empty로 표현됨
- retry/refresh 뒤 입력·완료 상태 유실 또는 명령 중복
- preview cancel 뒤 permanent write/file/job 실행 잔존
- rollback이 기존 또는 이후 수정된 행을 파괴
- 모바일에서 핵심 CTA·오류·cancel·undo에 접근 불가
- 증거에 실제 개인정보·토큰·쿠키·인증 비밀 포함
- 실제 화면, 전후 비교, hidden sequence, 이해 확인 퀴즈, 사용자 명시 승인 중 하나 누락
- 실DB/RLS 검사 skip 또는 T03 manifest 일부 미실행

## 13. 테스트 수용조건과 T10 판정 경계

### 13.1 기능별 수용조건

- S01~S10, H01~H12, T01~T13, I01~I16에서 현재 후보가 제공하는 기능 범위의 필수 행이 모두 실행됐다.
- `ORG-1/3/10`의 Owner/팀장/사원과 `TENANT-B` 공격 fixture가 요구된 계층에서 실행됐다.
- empty/error/retry/refresh/double-submit/permission-denied 상태가 정상 경로와 함께 증명됐다.
- D-L/D-D/M-L/M-D 시각 증거와 접근성 점검이 있다.
- P0 authz 1~40 및 A1-41~55 manifest가 완전하고 실DB skip이 없다.
- 모든 P0 반려 조건이 0건이며 BLOCKED/NOT_RUN P0 행이 0건이다.

### 13.2 T10 독립 수용조건

T10은 다음 순서로만 판정한다.

1. upstream artifact와 후보 SHA·migration revision을 고정한다.
2. fixture가 실제 공격 대상 행과 허용 대상 행을 모두 포함하는지 확인한다.
3. 증거 manifest의 ID unique count, 계층, expected/actual, 전후 상태를 검사한다.
4. P0 보안·권한·중복·복구를 우선 판정한다.
5. 기능별 행과 공통 시각 게이트를 판정한다.
6. 사용자 이해 확인과 명시 승인을 확인한다.
7. 최종 verdict와 미해결 사항을 `PASS | FAIL | BLOCKED | NOT_RUN`으로 기록한다.

T10은 누락 증거를 추정하지 않고, DEV의 PASS 표기를 그대로 승계하지 않으며, T04 writer lease나 다른 트랙 계약을 재정의하지 않는다.

## 14. 상태와 다음 handoff

| 주체 | 현재 상태 | 완료 조건 |
|---|---|---|
| 사용자 검토 | `REVIEW_REQUIRED` | D-01~D-05 답변, 실제 화면 퀴즈 응답, 명시 승인 |
| DEV | `WAIT-P / NOT_RUN` | 구현·fixture·실DB 환경·candidate SHA 준비 후 전체 증거 제출 |
| T03 upstream | `CONTRACT_READY / IMPLEMENTATION_NOT_RUN` | 원문 A1과 1~55 계약 흡수 완료; 실DB 실행 증거 대기 |
| T04 시각 | `WAIT-UPSTREAM-ARTIFACT` | 통합안·역인터뷰 뒤 실제 화면 대안과 상태 화면 제공 |
| T10 | `READY-TO-COLLECT, NOT_READY-TO-PASS` | 독립 실행·증거 완전성 검토·사용자 승인 후 verdict |

즉시 다음 WORK-ID는 **`T10-EVIDENCE-EXECUTION-01`**이다. T10은 이 문서를 입력으로 증거 manifest를 만들고, 선행 구현·fixture·실DB 환경이 없는 행을 정확히 `BLOCKED/NOT_RUN`으로 유지한다.

## 15. Blindspot Pass

### 전체 → 부분

- 전체 여정은 onboarding→daily work→team growth→import로 이어지지만, 실제 위험은 각 화면보다 Workspace 경계·Owner·session·멱등성의 공통 불변식에 집중된다.
- 역할별 UI만 보아서는 RLS, direct API, stale session, concurrent request 결함을 놓친다.
- 정상 데이터만 보아서는 empty·부분 오류·retry·refresh·cancel의 상태 전이를 놓친다.

### 부분 → 전체

- 한 widget의 aggregate 누출도 tenant 격리 실패이므로 전체 P0 반려다.
- 한 번의 Owner 우회 성공이나 old-session 성공도 조직 전체 통제권 실패다.
- import 한 행의 중복·오삭제는 일회성 오류가 아니라 멱등·rollback 계약 실패다.
- 시각 오류로 cancel/denied가 보이지 않으면 보안·복구 기능이 있어도 사용자는 안전하게 실행할 수 없다.

### 사용자 의도 / 확정·미결정 / 놓친 맹점

- 사용자 의도: 작은 조직이 빠르게 시작하되 권한과 데이터 안전을 양보하지 않는 실제 merge 검수 기준을 갖는 것.
- 확정: tenant/Owner/session/실DB non-skip/T10 독립 판정.
- 미결정: 팀장 위임, 첫 가치 완료 이벤트, import 부분 성공·중복·업무 이전 정책.
- 맹점: 집계·최근 기록 누출, stale tab, concurrent 초대/Owner 변경, preview 임시 job, rollback 이후 수정 행, 개인정보가 담긴 테스트 증거.

### 지금 / 실험 / 백로그 / 기각

| 분류 | 항목 |
|---|---|
| 지금 | P0 authz, 기능별 핵심 여정, 오류·retry·refresh, 실DB·시각 증거, T10 판정 |
| 실험 | CTA/문구/레이아웃 대안, 팀장 위임 기본값, import 부분 성공 UX |
| 백로그 | 대규모 조직 성능·고급 위임·장기 감사 보관의 세부 정책 |
| 기각 | 프로필 완성 강제, 실제 개인정보 fixture, UI 숨김만으로 권한 통과, skip을 PASS로 처리 |

---

### 작성 시점 검증 메모

- 이 파일은 실행 결과가 아니라 검수 계약이다.
- 실행 PASS: 0건.
- T03 원문 A1과 공격·경계 테스트 41~55를 직접 대조해 반영했다.
- 실제 증거 없는 행은 모두 `WAIT-P`, `WAIT-D`, `BLOCKED`, `NOT_RUN` 중 하나다.

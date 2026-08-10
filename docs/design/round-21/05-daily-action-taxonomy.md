# 오늘의 MoaWork — 일일 행동 분류·정렬 계약

> WORK-ID: `DAILY-ACTION-TAXONOMY-01` + `DAILY-ACTION-RANKING-CONTRACT-01`  
> 산출물: `SPEC`  
> 소유 트랙: T05  
> 기준 정본: `docs/coordination/sync/ROUND-20.md`, 공통 운영프롬프트 §16  
> 다음 소비자: T09 후보 생성·허브 통합, 오늘 홈 디자인 writer, 홈 read-model 구현 writer, T10 독립 검수  
> 변경 경계: 이 문서는 제품 계약이며 코드·DB·RLS·UI 구현을 포함하지 않는다.

## 1. 해결할 문제

초기 MoaWork 사용자는 대표도 고객 연락과 실무를 직접 수행하는 1~10명 조직이다. 홈이 매출·직원 활동량·지연 건수를 나열하는 경영 대시보드가 되면 다음 문제가 생긴다.

- 사용자가 무엇부터 해야 하는지 알 수 없다.
- 대표의 실무가 팀 관리 카드에 밀린다.
- 직원별 활동량·지연 건수가 감시와 성과 압박으로 해석된다.
- 담당·기한·다음 연락·승인·정산이 각각 별도 카드로 늘어나 화면이 과적재된다.
- 서로 다른 도메인이 자기 기준으로 긴급도를 계산해 결과가 매번 달라진다.
- 권한 밖 데이터가 검색 결과·집계 수·캐시에 섞일 수 있다.
- 오래된 데이터가 계속 빨간 경고로 남아 사용자의 신뢰를 떨어뜨린다.

오늘의 MoaWork는 경영 감시판이 아니라 사용자가 **지금 해야 할 한 가지 행동**을 30초 안에 찾는 업무 시작점이어야 한다.

## 2. 작은 조직 사용자 가치

### 대표

- 자신의 고객 연락과 실무가 첫 번째다.
- 본인이 결정해야 하는 승인·입금 확인만 추가로 본다.
- 팀 전체 통계 대신 담당자가 없는 업무를 통합 1건으로 본다.
- 직원별 활동량·완료 순위·지연 순위를 보지 않는다.

### 팀장

- 자신의 고객·업무가 첫 번째다.
- 권한 범위 안에서 팀의 미배정 업무만 추가로 본다.
- 다른 팀과 전사 정산·플랜·고급 권한 정보는 보지 않는다.

### 사원

- 본인이 담당하는 고객 연락과 기한 업무만 본다.
- 팀원의 업무·매출·활동량과 미배정 전체 건수를 보지 않는다.

## 3. 결정 상태

### 3.1 확정 결정

1. 최소 action type은 `work_due`, `follow_up`, `assign_owner`, `decide`, `reconcile_payment` 다섯 개다.
2. `assigned_to`는 행동이 아니라 수신자를 정하는 routing 정보다.
3. `due_at`은 행동 종류가 아니라 시급성을 정하는 시간 정보다.
4. 담당됐다는 사실만으로 홈 행동을 만들지 않는다.
5. 대표와 팀장도 자신의 실무가 팀 관리 행동보다 먼저다.
6. 후보 자격 → tenant/capability → stale → dedupe → aggregation → 정렬 순서를 고정한다.
7. 한 화면에는 대표행동 1개와 나머지 최대 4개만 표시한다.
8. 금액·직급·직원 활동량·성과는 후보 순위에 사용하지 않는다.
9. 현재 없는 기한·승인요청·입금예정 데이터를 추론하지 않는다.
10. 날짜 계산은 `Asia/Seoul` 기준이며 클라이언트 기기 시각을 사용하지 않는다.

### 3.2 추천 Draft

- 연락·기한 행동은 14일 이상 경과하면 원래 지시 대신 유효성 확인 행동으로 전환한다.
- 승인·입금 확인은 7일 이상 경과하면 stale 확인 행동으로 전환한다.
- 동일 action type은 홈에 최대 3개까지만 보여 주되, 다른 종류가 없으면 원래 정렬 순서로 빈 자리를 채운다.
- 초기 read model은 요청 시 파생하고 짧게 캐시한다. 도메인과 알림이 늘어난 뒤 persistent read model로 전환한다.

### 3.3 DECISION_GATE

다음은 schema owner·authz owner·홈 writer가 결정되기 전 구현을 시작하면 안 된다.

1. 모든 원천의 단조 증가 `source_version` 계약
2. D+180/365 연락의 명시적 완료 reference
3. 일반 업무의 canonical `due_at`
4. 일반 고객의 canonical `next_contact_at`
5. `approval_request`, approver, 결정 상태
6. `expected_payment_at`, 수납 상태, 일정 변경·취소 상태
7. action read model을 파생할지 저장할지의 최종 선택

## 4. 최소 action taxonomy

| action type | 사용자 문구 | 핵심 의미 | 기본 CTA |
|---|---|---|---|
| `work_due` | 이 업무를 처리해 주세요 | 담당 업무의 명시적 기한이 오늘 또는 지남 | 업무 열기 |
| `follow_up` | 고객에게 연락해 주세요 | 약속된 다음 연락일·재접촉일이 오늘 또는 지남 | 고객 업무 열기 |
| `assign_owner` | 담당자를 정해 주세요 | 활성 업무에 담당자가 없음 | 담당자 정하기 |
| `decide` | 요청을 승인하거나 돌려보내 주세요 | 현재 사용자가 명시적 approver인 pending 요청 | 요청 검토하기 |
| `reconcile_payment` | 입금 상태를 확인해 주세요 | 명시적 입금 예정일이 도래했고 수납 확인이 필요 | 정산 열기 |

### 4.1 행동으로 승격하지 않는 정보

- 담당자가 있다는 사실
- 레코드가 오래전에 생성됐다는 사실
- 금액이 크다는 사실
- 진행상태 라벨이 `승인`이라는 사실
- `down_paid_at` 또는 `fee_paid_at`이 비어 있다는 사실
- 직원의 활동량이 적다는 사실
- 내일 이후의 예정 정보

## 5. 역할별 행동 계약

| 역할 | 기본 행동 | 추가 행동 | 숨길 행동 |
|---|---|---|---|
| 대표 | 본인 `follow_up`, `work_due` | 본인 지정 `decide`, `reconcile_payment`; Workspace `assign_owner` 집계 | 직원 순위·활동량·권한 밖 정산 |
| 팀장 | 본인 `follow_up`, `work_due` | 본인 지정 결정; 관리 팀 `assign_owner` 집계 | 다른 팀·전사 정산·고급 설정 |
| 사원 | 본인 `follow_up`, `work_due` | capability가 명시된 본인 지정 결정만 | 팀 집계·동료 업무·조직 매출 |

역할은 후보 자격과 scope에만 영향을 준다. 대표라는 이유로 동일한 개인 행동의 우선순위를 높이지 않는다.

## 6. 데이터 원천 계약

### 6.1 현재 확인된 원천

| 정보 | 현재 원천 | 사용 가능 범위 |
|---|---|---|
| 고객 담당자 | `companies.assigned_to` | routing·미배정 판정 |
| 딜 담당자 | `deals.assigned_to` | routing·미배정 판정 |
| 딜 변경 시각 | `deals.updated_at` | 원천 갱신 감지 보조 |
| 고객 활동 | `activities` | 통화·미팅·메모·상태변경 증거 |
| 계약금 실제 입금일 | `settlements.down_paid_at` | 실제 수납 기록만 의미 |
| 수수료 실제 입금일 | `settlements.fee_paid_at` | 실제 수납 기록·재접촉 계산 기준 |
| 재접촉일 | `settlements.d180`, `settlements.d365` | T09 `follow_up` 후보 |

### 6.2 현재 없는 canonical 원천

| 필요한 정보 | 현재 상태 | 구현 전 처리 |
|---|---|---|
| 일반 업무 기한 | core canonical 필드 없음 | `work_due` 생성 금지 |
| 일반 다음 연락일 | 일부 업종팩 날짜만 존재 | generic `follow_up` 추론 금지 |
| 승인요청·approver | 진행상태의 `승인` 라벨만 존재 | `decide` 생성 금지 |
| 입금 예정일 | 실제 입금일만 존재 | `reconcile_payment` 생성 금지 |
| 행동 완료·나중에 보기 | 공통 계약 없음 | one-click 완료 구현 금지 |
| 배정 확인 이벤트 | 공통 계약 없음 | 담당 사실만으로 행동 생성 금지 |

### 6.3 해석 금지

- `진행상황=승인`은 업무 결과이며 대표의 승인요청이 아니다.
- `down_paid_at=null`, `fee_paid_at=null`은 미입금 증거가 아니다.
- `d180`, `d365`는 입금 예정일이 아니라 수수료 입금 후 재접촉일이다.
- 커스텀필드의 한글 라벨을 홈 로직에 직접 하드코딩하지 않는다.

## 7. 후보 승격과 완료 조건

| 신호 | 승격 조건 | 수신자 | 완료 조건 | 완료가 아닌 것 |
|---|---|---|---|---|
| 담당 | 단독 승격 없음 | 다른 행동의 담당자 | 다른 행동의 완료 규칙 | 새로 배정됨, 화면 열기 |
| 기한 | 미완료이고 `due_date <= kst_date` | 담당자 | 완료·취소 | 기한만 뒤로 이동 |
| 다음 연락 | 열린 고객·딜이고 `next_contact_date <= kst_date` | 담당자 | 연락 활동+다음 일정 갱신 또는 종료 | 일반 메모·화면 열기 |
| 미배정 | 생성·가져오기·자동배정 종료 후에도 `assigned_to=null` | 대표 또는 관리 팀장 | 활성 멤버 배정 또는 업무 종료 | 이름 텍스트 입력 |
| 승인 | 명시적 요청이 pending이고 현재 사용자가 approver | 지정 승인자 | 승인·반려·취소 | 요청 열기 |
| 입금예정 | 명시적 예정일 도래, 수납 미확인 | 권한 있는 담당자 | 수납확인·일정변경·취소 | 정산 화면 열기 |

`나중에`는 완료가 아니다. 허용하려면 새로운 날짜를 필수로 받고 원천 일정도 함께 갱신해야 한다.

## 8. 공통 후보 read model

도메인은 순위를 매기지 않고 다음 공통 후보만 생성한다.

```text
action_type
org_id
recipient_user_id
scope_kind
entity_type
entity_id
subject_key
source_type
source_id
source_version
source_updated_at
effective_date_or_at
title
action_label
reason
destination
required_capability
freshness_at
dedupe_key
completion_source
sensitive_payload_kind
```

필수 필드가 없거나 날짜를 파싱할 수 없으면 사용자 행동을 만들지 않는다. 내부 데이터 품질 신호로 분리한다.

### 8.1 화면·파일·데이터·상태 계약

#### 화면 계약

- 오늘 홈은 이 SPEC이 정한 공통 후보만 소비한다.
- 도메인별 원천 테이블이나 상태 라벨을 화면에서 직접 해석하지 않는다.
- 대표행동 1개와 나머지 최대 4개를 동일한 결정적 정렬 결과에서 고른다.
- 권한 밖 후보·집계·최근 항목은 빈 자리나 개수로도 노출하지 않는다.
- stale·일부 도메인 실패·완전한 빈 상태를 서로 다른 화면 상태로 표현한다.

#### 파일 계약

- 이 SPEC의 정본은 `docs/design/round-21/05-daily-action-taxonomy.md` 단일 파일이다.
- T09는 내용을 `INDEX.md`에서 연결할 수 있지만 T05는 `INDEX.md`를 수정하지 않는다.
- 오늘 홈 디자인·구현 산출물은 별도 WORK-ID와 별도 file/worktree lease를 받아야 한다.
- 이 SPEC을 근거로 기존 migration·권한 파일·T04 HTML을 직접 수정하지 않는다.

#### 데이터 계약

- 각 도메인은 §8 공통 read model을 완성해 전달한다.
- 홈은 원천별 누락 필드를 보충하거나 비즈니스 상태를 추론하지 않는다.
- `source_version`, `source_updated_at`, `dedupe_key`, `completion_source`가 없는 후보는 production 입력으로 인정하지 않는다.
- 민감 payload는 기본 후보와 분리하고 capability 검증 후 결합한다.

#### 상태 계약

후보 상태는 최소 다음 의미를 구분한다.

```text
eligible      자격·권한·날짜 조건을 만족한 후보
visible       dedupe·aggregation·ranking 후 홈에 선정됨
completed     원천 도메인의 명시적 완료 조건 충족
superseded    날짜·담당·source version 변경으로 새 후보가 대체
stale         원래 행동을 반복하지 않고 유효성 확인이 필요
canceled      원천 요청·업무가 취소됨
ineligible    권한·tenant·원천 조건을 더 이상 만족하지 않음
invalid       필수값·version·날짜·무결성 계약 불충족
```

`completed`, `superseded`, `canceled`, `ineligible`, `invalid`는 홈 후보에서 제외한다. `stale`은 별도 rank class로 남을 수 있다.

## 9. Filter·ranking 파이프라인

순서는 계약이며 구현 편의를 위해 바꾸지 않는다.

### 9.1 계산 시점 고정

요청 시작 시 서버가 하나의 `as_of_utc`를 고정한다. 모든 도메인 후보와 정렬이 같은 값을 사용한다.

### 9.2 후보 자격 필터

- 지원 action type인지 확인
- 활성·미완료 원천인지 확인
- 필수 식별자·수신자·source version·날짜 확인
- 승격 조건 확인
- 완료·취소·superseded 후보 제거
- 현재 없는 데이터에서 추론한 후보 제거

### 9.3 Tenant·capability 필터

- 요청자의 현재 Workspace와 `org_id` 일치
- 현재 사용자 RLS로 원천 재조회 가능
- `required_capability` 충족
- 수신자 또는 허용된 팀·Workspace 결정권자
- 민감 payload는 별도 capability를 통과한 뒤 결합

실패 후보는 개수와 집계에서도 완전히 제거한다.

### 9.4 Stale 전환

- 연락·기한: 14일 초과 시 “아직 유효한지 확인해 주세요”로 전환
- 승인·입금: 7일 초과 시 동일한 확인 표현으로 전환
- source version 변경: stale 처리하지 않고 기존 후보 폐기 후 재생성
- 원천 시각 불명: 사용자 행동 생성 금지

### 9.5 정확 dedupe

중복 단위는 다음과 같다.

```text
org_id + recipient_user_id + dedupe_key
```

동일 키가 여러 개면 높은 `source_version`, 그다음 늦은 `source_updated_at`을 사용한다. 같은 version인데 내용이 다르면 무결성 오류로 제외한다.

### 9.6 Subject collision

동일한 `subject_key`에 행동이 여러 개면 ranking이 가장 높은 하나만 홈 후보로 남긴다.

예: 같은 settlement의 stale D+180과 오늘 D+365가 겹치면 fresh D+365만 표시한다.

### 9.7 Aggregation

- `assign_owner`: 2건 이상이면 `org+recipient+manageable_scope` 단위로 반드시 집계
- `decide`: explicit approval 구조가 생긴 뒤 같은 종류·capability에서 3건 이상일 때만 집계 가능
- `reconcile_payment`: 기본적으로 집계하지 않음
- `follow_up`, `work_due`: 고객 약속과 기한 맥락을 보존하기 위해 집계 금지

### 9.8 결정적 정렬

다음 tuple을 오름차순으로 사용한다.

```text
rank_class
effective_at
scope_rank
source_type
source_id
dedupe_key
```

DB 반환 순서·병렬 응답 순서·금액·직급·활동량은 결과에 영향을 주지 않는다.

### 9.9 최종 선정

- 첫 번째 후보가 대표행동
- 전체 최대 5개
- 동일 action type 최대 3개
- 첫 순회에서 type cap 적용
- 5개 미만이면 건너뛴 후보를 원래 순서로 채움
- 숨은 개수는 현재 사용자가 열람 가능한 후보만 계산

## 10. 정렬표

### 10.1 Rank class

| class | 조건 | 순서 |
|---:|---|---:|
| 10 | 내 `follow_up`, fresh, overdue | 1 |
| 20 | 내 `work_due`, fresh, overdue | 2 |
| 30 | 내 `follow_up`, fresh, today | 3 |
| 40 | 내 `work_due`, fresh, today | 4 |
| 50 | 내가 지정 approver인 `decide`, pending | 5 |
| 60 | 내가 확인해야 하는 `reconcile_payment` | 6 |
| 70 | 대표·팀장의 `assign_owner` aggregate | 7 |
| 80 | stale로 전환된 내 행동 | 8 |
| 90 | stale 팀·Workspace 결정 | 9 |
| 제외 | future·완료·취소·권한 없음·원천 불충분 | 미표시 |

### 10.2 Scope rank

| 대상 | scope rank |
|---|---:|
| 현재 사용자의 직접 실무 | 0 |
| 현재 사용자에게 지정된 결정 | 1 |
| 팀 결정 | 2 |
| Workspace 결정 | 3 |

### 10.3 동률

1. `effective_at`이 빠른 항목
2. `scope_rank`가 작은 항목
3. `source_type` 사전순
4. `source_id` 사전순
5. `dedupe_key` 사전순

## 11. Dedupe key 예시

```text
deal:{deal_id}:next-contact:{date}
task:{task_id}:due:{date}
settlement:{id}:d180:{date}
settlement:{id}:d365:{date}
approval:{id}:decision
payment:{id}:reconcile:{date}
```

일정이 변경되면 기존 키는 `superseded`되고 새 날짜 키가 생성된다. 완료된 키를 새 일정에서 재사용하지 않는다.

## 12. KST·자정 계약

- timestamp 저장은 UTC, 날짜 계산은 `Asia/Seoul`
- 날짜 전용 필드는 KST 달력 날짜로 해석
- 오늘은 `[00:00:00 KST, 다음 날 00:00:00 KST)`
- 날짜 행동은 해당 날짜 00:00 KST부터 today
- 다음 날 00:00 KST부터 overdue
- 내일 이후는 강조 행동에서 제외하고 접힌 예정 영역에서만 사용 가능
- 23:59:59에 시작한 요청은 해당 `as_of` 결과를 유지
- 00:00 이후 새 요청·재포커스·새로고침에서 재계산
- 클라이언트가 자체 시각으로 overdue 상태를 바꾸지 않음

## 13. 권한 계약

1. 전역 후보를 만든 뒤 화면에서 숨기는 방식은 금지한다.
2. 원천을 읽을 때부터 tenant·RLS·담당범위를 적용한다.
3. 후보 선택 직전에 capability를 재검증한다.
4. 권한 회수 시 후보·집계 수·최근 항목에서 즉시 제거한다.
5. deep link에서도 원천 RLS를 다시 적용한다.
6. 정산 금액·승인 사유·첨부는 별도 capability를 통과해야 한다.
7. 대표의 Workspace 결정은 통합 1건으로 제한한다.
8. 플랫폼 관리자 여부를 Workspace 행동 우선순위로 사용하지 않는다.

## 14. Stale-data 계약

각 후보는 다음을 가져야 한다.

- `source_updated_at`
- `effective_date`
- `generated_at`
- source version 또는 동등한 변경 식별자
- 마지막 관련 활동 시각
- 완료 판정 원천

오래됐다는 이유만으로 빨간 실패로 표시하지 않는다. stale은 원래 행동을 반복 명령하는 대신 데이터가 아직 유효한지 확인하는 행동이다.

예:

- “고객에게 연락해 주세요” → “연락 계획이 아직 유효한지 확인해 주세요”
- “입금이 늦었어요” 금지 → “입금 상태를 확인해 주세요”

## 15. 실패·복구 계약

### 15.1 도메인 응답 실패

특정 도메인이 응답하지 않아도 다른 후보로 홈을 구성한다. 다만 “오늘 할 일이 없어요”라고 단정하지 않는다.

권장 문구:

> 일부 업무를 불러오지 못했어요. 새로고침해 주세요.

### 15.2 원천 갱신 경쟁

후보 생성 때 읽은 version과 최종 선정 직전 version이 다르면 한 번 재계산한다. 다시 바뀌면 이번 응답에서는 제외한다.

### 15.3 권한 회수

다음 요청에서 후보와 집계 수를 모두 제거한다. 캐시와 최근 항목도 권한 version으로 무효화한다.

### 15.4 날짜 변경

오늘이던 행동의 날짜가 미래로 바뀌면 홈에서 제거한다. 완료가 아니라 superseded다.

### 15.5 완료 후 재개

원천이 다시 열리면 새 source version과 새 dedupe key로 후보를 생성한다. 과거 완료 후보를 되살리지 않는다.

### 15.6 원천이 없는 기능

입금예정·승인·기한·다음 연락 원천이 없으면 빈 후보가 정상이다. 임시 문자열·상태 라벨·null 값으로 대체하지 않는다.

## 16. 오늘 홈 디자인 입력

### 16.1 정보 구조

1. 상단: 현재 회사·내 역할을 짧게 확인
2. 대표행동 1개: 이유·기한·CTA를 한 문장으로 표시
3. 나머지 행동 최대 4개
4. 통합 검색 진입
5. 최근 본 항목 최대 5개
6. 일부 도메인 실패·stale은 행동과 구분된 보조 상태로 표시

### 16.2 표시 금지

- 직원별 활동량·완료량·지연 순위
- 매출액을 이용한 긴급도 강조
- 권한 밖 항목의 개수
- Platform Admin·고급 ACL 공식
- 데이터 근거 없이 “미입금”, “저성과”, “업무 지연”으로 단정하는 문구

### 16.3 모바일 최소 행동

- 고객 찾기
- 메모 남기기
- 단계·상태 변경
- 다음 연락일 지정

삭제·정산 수정·권한변경·대량작업은 모바일 빠른 행동에서 제외한다.

## 17. T09 D+180/365 후보 생성 계약

T09는 ranking을 수행하지 않고 settlement 재접촉 후보만 공통 read model로 생성한다.

### 17.1 생성 조건

- `fee_paid_at`이 존재해 계산일이 생성됨
- `d180` 또는 `d365 <= kst_date`
- 연결된 `deal_id`가 존재
- 현재 사용자가 연결된 딜을 볼 권한이 있음
- 딜 담당자가 존재
- 동일 settlement·주기·날짜 후보가 완료되지 않음

### 17.2 출력

```text
action_type=follow_up
subject_key=settlement:{id}
source_type=settlement
source_id={id}
effective_date={d180|d365}
dedupe_key=settlement:{id}:{d180|d365}:{date}
recipient_user_id={linked_deal.assigned_to}
required_capability={정산을 노출하지 않는 최소 딜 열람 권한}
destination={linked deal detail}
```

금액은 ranking 후보에 포함하지 않는다. 홈이 도메인 의미를 추측하지 않도록 행동 문구와 completion source를 T09가 제공해야 한다.

### 17.3 금지

- 금액으로 priority 계산
- `paid_at=null`을 미입금으로 해석
- D+180/365를 입금예정으로 표현
- 진행상태 `승인`을 승인요청으로 표현
- 담당자가 없을 때 대표에게 개별 follow-up 생성
- 권한 밖 후보를 생성한 뒤 홈에서 숨기도록 위임

담당자가 없으면 T09 `follow_up`을 만들지 않고 홈의 미배정 resolver가 처리한다.

## 18. 수용조건

### AC-01 사원 권한

입력:

- 어제 예정된 본인 고객 연락
- 오늘 기한인 본인 업무
- 권한 없는 팀 미배정 3건

기대:

1. 고객 연락이 대표행동
2. 오늘 기한 업무가 두 번째
3. 미배정 수와 항목은 모두 미노출

### AC-02 실무하는 대표

입력:

- 대표 본인의 오늘 고객 연락
- Workspace 미배정 4건

기대:

1. 대표 본인 고객 연락이 대표행동
2. “담당자가 없는 업무가 4건 있어요” 집계 1건

### AC-03 동일 settlement 충돌

입력:

- D+180: 20일 경과, stale
- D+365: 오늘

기대:

- 동일 subject collision 후 fresh D+365만 표시

### AC-04 source version 변경

입력:

- v1 기한=오늘
- v2 기한=내일

기대:

- v2만 채택
- 오늘 홈에서 제거
- 완료 수에는 포함하지 않음

### AC-05 권한 회수

첫 요청에서 후보가 보인 뒤 capability가 회수됨.

기대:

- 다음 요청에서 후보와 집계 수 모두 0
- 상세 URL 접근도 거부

### AC-06 KST 자정

- 23:59:59 KST 요청: 내일 연락 미표시
- 00:00:00 KST 이후 새 요청: today `follow_up`

한 요청 안에서 중간 전환하지 않는다.

### AC-07 완전 동률

두 `follow_up`의 날짜·시각이 같아도 `source_type → source_id → dedupe_key`로 결과가 항상 동일하다.

### AC-08 없는 원천

진행상태의 승인 라벨과 `fee_paid_at=null`만 존재할 때 `decide`와 `reconcile_payment`는 0건이다.

### AC-09 도메인 실패

정산 후보 생성기가 실패해도 CRM 후보는 표시한다. 단, “할 일이 없다”는 완료형 빈 상태를 표시하지 않는다.

### AC-10 감시 배제

동일 후보 집합에서 직원 활동량·직급·매출액만 바꿔도 정렬 결과는 변하지 않는다.

## 19. 성공지표와 안전지표

### 제품 성공지표

- 홈 진입 후 첫 유효 행동까지 30초 이내
- 홈에서 시작된 행동의 원천 상태 완료율
- 고객 검색 후 상세 진입까지 걸린 시간
- 다음 연락일이 없는 연락 완료 비율 감소
- 미배정 업무의 평균 배정 시간

### 안전지표

- 권한 밖 후보·집계·최근 항목 노출 0건
- source version 경합으로 잘못 남은 후보 0건
- 동일 dedupe key 중복 표시 0건
- stale 원천을 실패·저성과로 단정한 문구 0건
- 직원별 활동량·성과가 ranking에 미친 영향 0건

## 20. 다음 소비자와 후속 WORK-ID

| 다음 소비자 | 후속 WORK-ID | 입력 | 산출물 |
|---|---|---|---|
| T09 | `DAILY-ACTION-T09-GENERATOR-01` | §17 | D+180/365 후보 생성 계약·writer 배정 입력 |
| 오늘 홈 디자인 writer | `DAILY-HOME-VISUAL-01` | §2, §5, §10, §16 | 한글 UI 4안·모바일·빈/오류/stale 시퀀스 |
| 홈 데이터 계약 owner | `TODAY-HOME-DATA-CONTRACT-01` | §6~§15, §17 | 원천·read model·version·completion 계약 확정 |
| 홈 read-model 구현 writer | `DAILY-ACTION-READMODEL-01` | `TODAY-HOME-DATA-CONTRACT-01` 결과 | 결정적 filter/ranking 구현 |
| Authz/schema owner | `DAILY-ACTION-SOURCE-GATES-01` | §3.3, §6.2 | source version·기한·연락·승인·입금 계약 결정 |
| T10 | `DAILY-ACTION-VERIFY-01` | §12~§19 | 자정·권한회수·dedupe·감시배제 독립 검수 |

### 20.1 즉시 다음 WORK-ID

`TODAY-HOME-DATA-CONTRACT-01`

이 작업이 먼저 source version, completion reference, canonical 원천, 파생/저장 read model 경계를 확정해야 한다. 그 결과 없이 UI writer가 임시 데이터를 제품 계약으로 굳히거나 DEV가 스키마를 추측해 구현하면 안 된다.

## 21. 구현 착수 순서

1. T09가 이 SPEC의 실재와 내용·다음 소비자를 허브 INDEX에 연결한다.
2. MWC가 DECISION_GATE별 owner와 writer를 배정한다.
3. Authz/schema owner가 현재 없는 원천을 명시적으로 확정한다.
4. T09는 D+180/365 후보 생성 범위만 구현 계약으로 넘긴다.
5. 홈 writer는 공통 read model과 결정적 ranking만 구현한다.
6. T04 디자인 writer는 사용자 선택용 오늘 홈 4안을 만든다.
7. T10이 RLS·권한 회수·KST 자정·stale·dedupe·감시 배제를 독립 검수한다.
8. 사용자 시각 승인 전 제품 코드 merge·배포를 진행하지 않는다.

## 22. 현재 검토·구현·검수 상태

| 게이트 | 상태 | 다음 행동 |
|---|---|---|
| 사용자 검토 | `PENDING` | 오늘 홈의 우선 행동·stale 기준·역할별 노출 원칙 확인 |
| 데이터 계약 | `READY_FOR_DISPATCH` | `TODAY-HOME-DATA-CONTRACT-01` owner·lease 배정 |
| DEV 구현 | `NOT_STARTED / BLOCKED_BY_DECISION_GATE` | 데이터 계약과 별도 worktree/file lease 후 착수 |
| 오늘 홈 디자인 | `NOT_STARTED` | 데이터 계약을 입력으로 별도 VISUAL 작업 배정 |
| T10 독립 검수 | `NOT_STARTED` | 구현·시각 산출물 뒤 AC-01~AC-10 검수 |

이 SPEC 파일 생성은 설계 산출물 완료이며 제품 구현 완료가 아니다. T09가 파일 실재·필수 내용·다음 소비자를 확인하고 후속 WORK-ID를 실제 배정해야 다음 상태로 이동한다.

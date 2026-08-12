# BBE-146 hosted 적용 사전점검

이 문서는 belie 승인 자료다. `060_board_foundation_reconcile.sql`은 저장소에서만 준비하며 hosted에는 적용하지 않는다. 060은 PR #166의 059 점유를 반영한 임시 번호이며, 머지 직전 `origin/main` 최신+1로 다시 확정한다.

## 적용 전 필수 판정

- [ ] 복구 가능한 일일 백업 또는 PITR이 실제 활성화되어 있고 복원 절차, 보존 기간, 담당자를 확인한다.
- [ ] Supabase 프로젝트 이름, 리전, project ref를 두 사람이 대조한다. ref나 연결 문자열 값은 문서와 로그에 남기지 않는다.
- [ ] 같은 연결에서 migration ledger와 아래 객체 preflight를 다시 읽는다. 고객 행 값은 조회하지 않는다.
- [ ] `field_type`이 기존 13종과 `status`만 있는 known partial drift인지 확인한다.
- [ ] `field_source`, `board_columns.source/right_pinned/move_rule_jsonb/is_readonly` 및 055 객체의 존재 여부를 기록한다.
- [ ] `boards.detail_layout_jsonb`, `board_groups.detail_layout_jsonb`, 두 CHECK 제약, `is_valid_detail_layout(jsonb)`의 존재 여부를 기록한다.
- [ ] 기존 `boards.detail_layout_jsonb`가 있다면 NULL 행이 0건이며 기본값을 `[]`로 보정할 수 있는지 확인한다. 값 자체는 갱신하지 않는다.
- [ ] 기존 두 layout 컬럼의 non-NULL 값이 모두 배열이고 각 원소가 string `key`와 `source=column|detail`을 갖는지 판정한다. 불일치가 있으면 적용하지 않는다.
- [ ] `member_role.team_lead`, `member_scope.department` 존재 여부를 확인한다.
- [ ] PR #166과 `origin/main`의 migration 번호 충돌을 해소하고 migration/rollback을 동일한 최신+1 번호로 재키잉한다.
- [ ] 057·058(outbox·발송)이 이번 적용 목록에 포함되지 않았음을 확인한다.

## 점검 창과 실행

- [ ] 저이용 보수 창, 실행자, DC-01 1단 검수자, NC-01 2단 검수자, 중단 기준을 사전에 기록한다.
- [ ] 적용 직전 장기 트랜잭션과 DDL lock 대기를 확인한다.
- [ ] 안전한 비고객 fixture 보드에서 17종 enum, board 컬럼 4개, layout 컬럼 2개 및 NULL/`[]` 구분 readback을 계획한다.
- [ ] 적용 중 오류가 나면 후속 fixture 실행을 멈추고 연결, 오류, 객체 건수만 보존한다. 고객 데이터 내용은 출력하지 않는다.

## 적용 후 readback

- [ ] `board_columns`에 `source`, `right_pinned`, `move_rule_jsonb`, `is_readonly`가 각각 한 개 존재하고 기존 `sort_order`는 변경되지 않았다.
- [ ] `field_type`이 정확히 17종이며 `multiselect`와 `url`도 유지된다.
- [ ] `field_source`가 `auto/in/act/msg/lk/calc` 6종이다.
- [ ] `perm_baseline()`이 24행이며 055 테이블과 함수가 존재한다.
- [ ] `boards.detail_layout_jsonb`는 NOT NULL, DEFAULT `[]`; `board_groups.detail_layout_jsonb`는 nullable이다.
- [ ] 유효한 `[{"key":"owner","source":"column"}]`은 저장되고, 객체 root 및 허용 밖 source는 CHECK로 거부된다.
- [ ] fixture에서 group NULL은 보드 기본 상속으로 판정되고 `[]`은 의도적 빈 배치로 구분된다.
- [ ] 같은 migration을 다시 실행해 오류와 중복 객체가 없다.

## rollback 판정

rollback SQL은 함수/제약 → 테이블·컬럼 → 타입의 의존 순서를 따른다. 선존 컬럼과 값을 파괴할 수 없으므로 두 layout 컬럼은 rollback에서도 보존하며, CHECK와 validator만 제거한다. layout 컬럼 제거가 필요하면 preflight로 생성 주체와 값 부재를 증명한 별도 파괴적 migration 및 belie 승인이 필요하다.

PostgreSQL enum label은 안전한 `DROP VALUE`가 없으므로 `status/people/money/calc`, `team_lead`, `department`는 rollback에서도 보존한다. 완전 제거는 별도 타입 재구축 migration과 데이터 변환 검수가 필요하다.

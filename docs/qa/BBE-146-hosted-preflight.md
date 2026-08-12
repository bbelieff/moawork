# BBE-146 hosted 적용 사전점검

이 문서는 승인 자료다. `059_board_foundation_reconcile.sql`은 저장소에서만 준비하며 hosted에는 적용하지 않는다. 번호 059는 임시이고 머지 직전 `origin/main` 최신+1로 재확정한다.

## 적용 전 필수 판정

- [ ] 복구 가능한 논리 백업 또는 PITR가 실제로 활성화되어 있고 복원 절차·보존기간·담당자를 확인했다.
- [ ] Supabase 프로젝트 이름·리전·project ref를 두 사람이 대조했다. ref나 연결 문자열 값은 이 문서나 로그에 복사하지 않는다.
- [ ] migration ledger와 객체 preflight를 같은 연결에서 다시 읽었다.
- [ ] `field_type`은 기존 13종과 `status`만 있는 partial drift인지 확인했다. 고객 행 값은 조회하지 않는다.
- [ ] `field_source`, `board_columns.source/right_pinned/move_rule_jsonb/is_readonly`, 055의 두 테이블과 함수가 없는지 확인했다.
- [ ] `member_role.team_lead`, `member_scope.department`의 존재 여부를 확인했다.
- [ ] PR #166과 `origin/main`의 migration 번호 충돌을 해소하고 이 파일과 rollback 파일을 동일한 최신+1 번호로 재번호화했다.
- [ ] 057·058(outbox·발송)은 동결 상태이며 이번 적용 목록에 포함되지 않았음을 확인했다.

## 점검 창과 실행

- [ ] 유지보수 창, 실행자, DC-01 검수자, NC-01 2단 검수자, 중단 기준을 사전에 기록했다.
- [ ] 적용 직전 장기 트랜잭션과 DDL lock 대기를 확인했다.
- [ ] 안전한 비고객 fixture 조직/보드에서 컬럼 4개와 17종 enum readback을 수행할 계획이 있다.
- [ ] 적용 후 앱 쓰기 전에 schema cache 갱신 필요 여부와 Data API 노출 설정을 확인한다.

## 적용 후 readback

- [ ] `board_columns`에 `source`, `right_pinned`, `move_rule_jsonb`, `is_readonly`가 각각 1개 존재한다.
- [ ] `field_type`이 정확히 17종이며 `multiselect`와 `url`도 유지된다.
- [ ] `field_source`가 `auto/in/act/msg/lk/calc` 6종이다.
- [ ] `perm_baseline()`이 24행을 반환하고 055의 두 테이블·7개 함수가 존재한다.
- [ ] fixture에서 기본값 `source='in'`, `right_pinned=false`, `is_readonly=false`, `move_rule_jsonb is null`을 확인한다.
- [ ] 같은 migration을 재실행해 오류와 중복 객체가 없음을 확인한다.

## 중단·rollback

오류가 나면 후속 앱·fixture 쓰기를 중단하고 연결·오류·객체 건수만 보존한다. 고객 데이터 내용은 출력하지 않는다. preflight에서 이번 migration이 새로 만든 객체임을 확인한 경우에만 같은 번호의 rollback SQL을 실행한다.

rollback은 함수·권한 테이블·board_columns의 새 컬럼·field_source를 제거한다. PostgreSQL enum label은 안전한 `DROP VALUE`가 없으므로 `status/people/money/calc`, `team_lead`, `department`는 남는다. 완전 제거가 필요하면 별도 타입 재구축 migration과 데이터 변환 검수가 필요하다.

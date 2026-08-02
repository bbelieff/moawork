-- =====================================================================
-- 008_perf_snapshot_rollup.sql — 월 마감 성과 스냅샷 롤업 지원 인덱스.
--
-- 근거: docs/design/T07-perf-design.md §1.3(리더보드 정렬 인덱스) · §2.4(멱등 재계산).
-- 성격: additive **인덱스 전용**. 001~007 무수정, 컬럼 추가 없음, 데이터 변경 없음.
--
-- 활동량 영속화(activity_score/activity_cnt 컬럼 추가, T07 §1.3 제안)는 이 파일에
-- 넣지 않는다 — §6 결정사항 1번이며 belie 승인 대상이다. 현재 활동량은 API 실시간
-- 집계로 제공한다.
-- =====================================================================

-- 리더보드·스냅샷 조회는 항상 (조직, 기간) 으로 좁힌다.
create index if not exists perf_snap_org_period
  on performance_snapshots (org_id, period);

-- ---------------------------------------------------------------------
-- 미배정('조직 공통') 버킷의 중복 방지.
--
-- 001 의 `unique (org_id, user_id, period)` 만으로는 부족하다 — PostgreSQL 의 UNIQUE
-- 는 NULL 을 서로 다른 값으로 취급하므로, 담당자 없는 정산을 모으는 `user_id IS NULL`
-- 행은 재계산할 때마다 **중복 삽입**된다. 월 마감 배치는 매달(그리고 재시도마다) 도는
-- 멱등 작업이라 이 구멍이 그대로 누적 오염이 된다.
--
-- 부분 유니크 인덱스로 (org_id, period) 당 미배정 행을 정확히 1개로 강제한다.
-- 앱 쪽 키 규약은 app/src/lib/perf/store.ts 의 snapshotKey() 가 같은 의미로 맞춘다.
--
-- ⚠ 이미 중복 행이 있으면 이 인덱스 생성이 실패한다. 그때는 임의 삭제하지 말고
--   (어느 행이 정본인지 알 수 없다) 해당 org+period 를 재계산해 교체한 뒤 재적용한다.
-- ---------------------------------------------------------------------
create unique index if not exists perf_snap_org_period_unassigned
  on performance_snapshots (org_id, period)
  where user_id is null;

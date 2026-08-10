# Data Model SSOT

업무 스키마 v1은 미정이다. 마스터기획서 PART G는 후보 모델이며 실제 migration 정본이 아니다.

- DB 정본으로 시작한다.
- 멀티테넌트 업무 테이블은 `org_id`와 RLS 격리를 전제로 한다.
- 삭제·집계·감사 정책은 스키마 확정 전 ADR로 결정한다.
- 실제 Supabase 자격증명은 저장소에 기록하지 않는다.
- `O11`, `O17`, 업무 키·RLS·soft delete 규칙은 결정 대기다.

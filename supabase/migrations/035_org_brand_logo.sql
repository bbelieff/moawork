-- BBE-116: 회사별 로고. 값이 없으면 앱이 회사 이름으로 대체 표시한다.
-- RLS는 기존 orgs_select(001)가 row 단위라 컬럼 추가만으로는 정책 변경이 필요 없다.

alter table public.orgs add column logo_url text;

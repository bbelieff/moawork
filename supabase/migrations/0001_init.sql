-- 0001_init.sql — moawork 초기 스키마
-- 통합관리시스템 기반 마이그레이션. 도메인 스키마(먼데이 보드 복제 테이블 등)는
-- 후속 마이그레이션에서 추가한다. 이 파일은 골격 + 스키마 버전 메타만 담는다.

create extension if not exists "pgcrypto";

-- 마이그레이션/헬스 체크용 메타 테이블
create table if not exists public.app_meta (
  key        text primary key,
  value      text        not null,
  updated_at timestamptz not null default now()
);

insert into public.app_meta (key, value)
values ('schema_version', '0001')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

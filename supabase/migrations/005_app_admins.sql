-- =====================================================================
-- 005_app_admins.sql — 플랫폼 관리자 예약(allowlist). belie 지시 2026-07-21.
-- 목적: 구글 OAuth가 아직 없어 로그인으로 매칭 불가 → 이메일을 미리 예약해 둔다.
--       나중에 T03가 구글 로그인 처리 시 app_admin_role(email)이 non-null이면
--       해당 사용자를 owner + 플랫폼 관리자로 자동 부여한다(코드측 배선).
-- 성격: additive, 001~004 무수정. 비밀값 없음.
-- =====================================================================

create table if not exists app_admins (
  email       text primary key,
  role        text not null default 'owner',
  is_platform boolean not null default true,   -- 전 조직 관리(플랫폼) 여부
  note        text,
  created_at  timestamptz not null default now()
);

-- RLS: 직접 조회 차단(관리자 이메일 목록 노출 방지). 조회는 아래 SECURITY DEFINER 함수로만.
alter table app_admins enable row level security;

create or replace function public.app_admin_role(p_email text)
  returns text language sql stable security definer set search_path = public as $$
  select role from app_admins where email = lower(p_email);
$$;

-- belie 예약(멱등)
insert into app_admins(email, role, is_platform, note)
values ('beliefkimkim@gmail.com', 'owner', true, 'belie 플랫폼 관리자(창업자)')
on conflict (email) do update
  set role = excluded.role, is_platform = excluded.is_platform, note = excluded.note;

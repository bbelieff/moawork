-- moa-migration-guard: logical_key=098_bbe199_org_logo predecessor=095_bbe172_new_lead_contact_transition digest=04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '098_bbe199_org_logo',
  p_file_name => '098_bbe199_org_logo.sql',
  p_file_digest => '04b21bb5bf897849a4b00d0d8aa2c280a6ae1c69c325610f2e1cf8a35ff034e8',
  p_expected_predecessor => '095_bbe172_new_lead_contact_transition',
  p_executor => 'DC-15',
  p_thread_id => '22103fbd-0deb-43e6-8948-7adda95b6063',
  p_foundation => false
);

-- BBE-199 · 회사 로고.
--
-- 왜 컬럼이 아니라 RPC 로만 쓰는가:
-- 006_public_workspace_entry.sql:1085-1094 가 orgs 의 update 정책을 없애고
-- authenticated 에게서 update 권한을 회수했다. 즉 클라이언트는 orgs 를 직접 쓸 수 없다.
-- 로고를 위해 그 잠금을 다시 열면 name·plan_tier·slug 까지 열린다 —
-- RLS 는 컬럼 단위로 좁힐 수 없기 때문이다.
-- 그래서 «로고 두 칸만» 통과시키는 security definer RPC 두 개를 유일한 문으로 둔다.
--
-- 왜 logo_url 이 아니라 logo_path 인가:
-- 수용 기준이 «타 조직 로고 읽기 0» 이다. 공개 버킷 + 공개 URL 로는 읽기를 막을 수 없다
-- (경로를 아는 사람은 누구나 읽는다). 비공개 버킷 + 경로 저장 + 서버측 signed URL 로 간다.

-- =====================================================================
-- 1. orgs — additive · nullable · 기존 row UPDATE 0
-- =====================================================================

alter table public.orgs
  add column if not exists logo_path       text,
  add column if not exists logo_mime       text,
  add column if not exists logo_bytes      integer,
  add column if not exists logo_updated_at timestamptz,
  add column if not exists logo_updated_by uuid;

-- 형식·용량을 «데이터베이스가» 강제한다. 화면 제한과 서버 검증을 둘 다 지나쳐도 여기서 막힌다.
alter table public.orgs drop constraint if exists orgs_logo_mime_allowed;
alter table public.orgs add constraint orgs_logo_mime_allowed
  check (logo_mime is null or logo_mime in ('image/png', 'image/jpeg', 'image/svg+xml'));

alter table public.orgs drop constraint if exists orgs_logo_bytes_limit;
alter table public.orgs add constraint orgs_logo_bytes_limit
  check (logo_bytes is null or (logo_bytes > 0 and logo_bytes <= 1048576));

-- 조직 필터 제약은 §3 의 org_logo_object_org() 를 쓰므로 함수를 만든 «뒤» 에 건다.
-- (접두사만 보는 like 로는 <org>/../<남의org>/x 같은 경로 탈출을 못 거른다.
--  RPC 와 «같은 판정» 이어야 3겹이 실제로 3겹이다.)

-- 반쯤 설정된 상태를 만들지 않는다 — 셋 다 있거나 셋 다 없다.
alter table public.orgs drop constraint if exists orgs_logo_complete;
alter table public.orgs add constraint orgs_logo_complete
  check (
    (logo_path is null and logo_mime is null and logo_bytes is null)
    or (logo_path is not null and logo_mime is not null and logo_bytes is not null)
  );

-- =====================================================================
-- 2. 변경 감사 — 누가 · 언제 · 무엇을
-- =====================================================================

create table if not exists public.org_logo_audit (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  actor_id   uuid,
  action     text not null check (action in ('set', 'clear')),
  logo_path  text,
  logo_mime  text,
  logo_bytes integer,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists org_logo_audit_org_created_idx
  on public.org_logo_audit (org_id, created_at desc);

alter table public.org_logo_audit owner to postgres;
alter table public.org_logo_audit enable row level security;
revoke all on table public.org_logo_audit from public, anon, authenticated, service_role;
grant select on table public.org_logo_audit to authenticated;

drop policy if exists org_logo_audit_select on public.org_logo_audit;
create policy org_logo_audit_select on public.org_logo_audit
  for select to authenticated
  using (public.org_role(org_id) in ('owner', 'admin'));

-- =====================================================================
-- 3. 경로에서 조직을 읽는 함수 — Storage 정책과 RPC 가 공유하는 «조직 필터»
-- =====================================================================
--
-- 오브젝트 이름의 첫 폴더가 org_id 다.  <org_id>/<파일명>
-- uuid 모양이 아니면 null 을 돌려준다 — 정책에서 null 은 «통과 안 함» 이다.
-- 이것을 제거하면 남의 조직 폴더를 지목할 수 있게 된다.
--
-- ★ 「폴더 하나 + 파일명 하나」만 허용한다. 슬래시가 더 있으면 매치되지 않으므로
--   <org>/../<남의org>/x · <org>/a/../../<남의org>/x 같은 경로 탈출이 전부 걸러진다.
--   파일명이 '.' 이나 '..' 인 것도 막는다 — 영숫자를 최소 한 글자 요구한다.
--   이 함수 하나가 RPC · Storage 정책 · orgs CHECK 세 곳의 «같은» 판정이 된다.

create or replace function public.org_logo_object_org(p_name text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case
    when p_name ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/[A-Za-z0-9._-]*[A-Za-z0-9][A-Za-z0-9._-]*$'
      and length(p_name) <= 200
      then split_part(p_name, '/', 1)::uuid
    else null
  end;
$function$;

alter function public.org_logo_object_org(text) owner to postgres;
revoke all on function public.org_logo_object_org(text) from public, anon, authenticated, service_role;
grant execute on function public.org_logo_object_org(text) to authenticated;

-- ★ 조직 필터 3겹째. RPC(2겹)와 «문자 그대로 같은 판정» 을 쓴다.
--   전에는 `logo_path like id::text || '/%'` 였는데 접두사만 고정해서
--   <org>/../<남의org>/logo.png 가 통과했다. 두 겹의 강도가 달랐다.
--   같은 함수를 쓰면 한쪽만 약해질 수가 없다.
--   ★★ `= id` 가 아니라 `is not distinct from id` 인 이유 (여기서 한 번 틀렸다):
--      경로 탈출이면 org_logo_object_org() 는 null 을 돌려준다. 그런데 `null = id` 는
--      false 가 아니라 **null** 이고, CHECK 는 결과가 null 이면 «통과» 시킨다.
--      즉 `= id` 로 쓰면 이 3겹은 «있지만 아무것도 막지 않는» 장식이 된다.
--      is not distinct from 은 null 을 false 로 접어서 실제로 막는다.
alter table public.orgs drop constraint if exists orgs_logo_path_org_scoped;
alter table public.orgs add constraint orgs_logo_path_org_scoped
  check (logo_path is null or public.org_logo_object_org(logo_path) is not distinct from id);

-- =====================================================================
-- 4. 유일한 쓰기 문 — set_org_logo / clear_org_logo
-- =====================================================================

create or replace function public.set_org_logo(
  p_org_id uuid,
  p_path   text,
  p_mime   text,
  p_bytes  integer
)
returns table(logo_path text, logo_mime text, logo_bytes integer, logo_updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_role  public.member_role;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'org logo denied';
  end if;

  -- ★ 권한 판정. owner/admin 만 통과한다.
  v_role := public.org_role(p_org_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'org logo denied';
  end if;

  -- ★ 형식 검증. 각각 다른 errcode/message 로 구분한다.
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/svg+xml') then
    raise exception using errcode = '22023', message = 'org logo format rejected';
  end if;

  -- ★ 용량 검증.
  if p_bytes is null or p_bytes <= 0 or p_bytes > 1048576 then
    raise exception using errcode = '22023', message = 'org logo size rejected';
  end if;

  -- ★ 조직 필터. 경로가 자기 조직 폴더가 아니면 거부한다.
  if public.org_logo_object_org(p_path) is distinct from p_org_id then
    raise exception using errcode = '22023', message = 'org logo path rejected';
  end if;

  update public.orgs o
     set logo_path       = p_path,
         logo_mime       = p_mime,
         logo_bytes      = p_bytes,
         logo_updated_at = clock_timestamp(),
         logo_updated_by = v_actor
   where o.id = p_org_id;

  insert into public.org_logo_audit (org_id, actor_id, action, logo_path, logo_mime, logo_bytes)
  values (p_org_id, v_actor, 'set', p_path, p_mime, p_bytes);

  return query
    select o.logo_path, o.logo_mime, o.logo_bytes, o.logo_updated_at
      from public.orgs o
     where o.id = p_org_id;
end;
$function$;

create or replace function public.clear_org_logo(p_org_id uuid)
returns table(logo_path text, logo_mime text, logo_bytes integer, logo_updated_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid();
  v_role  public.member_role;
  v_prior text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'org logo denied';
  end if;

  -- ★ 권한 판정. owner/admin 만 통과한다.
  v_role := public.org_role(p_org_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'org logo denied';
  end if;

  select o.logo_path into v_prior from public.orgs o where o.id = p_org_id;

  update public.orgs o
     set logo_path       = null,
         logo_mime       = null,
         logo_bytes      = null,
         logo_updated_at = clock_timestamp(),
         logo_updated_by = v_actor
   where o.id = p_org_id;

  insert into public.org_logo_audit (org_id, actor_id, action, logo_path, logo_mime, logo_bytes)
  values (p_org_id, v_actor, 'clear', v_prior, null, null);

  return query
    select o.logo_path, o.logo_mime, o.logo_bytes, o.logo_updated_at
      from public.orgs o
     where o.id = p_org_id;
end;
$function$;

alter function public.set_org_logo(uuid, text, text, integer) owner to postgres;
revoke all on function public.set_org_logo(uuid, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.set_org_logo(uuid, text, text, integer) to authenticated;

alter function public.clear_org_logo(uuid) owner to postgres;
revoke all on function public.clear_org_logo(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.clear_org_logo(uuid) to authenticated;

-- =====================================================================
-- 5. Storage 버킷과 정책
-- =====================================================================
--
-- storage 스키마가 없는 환경(PGlite 단위 테스트 등)에서는 건너뛴다.
-- ★ 조용히 건너뛰지 않는다 — raise warning 으로 반드시 소리를 낸다.
-- 운영(Supabase hosted)에는 storage 스키마가 항상 있으므로 이 경고는 뜰 수 없다.
-- 만약 운영 적용 로그에 이 경고가 보이면 그건 «정책 없이 버킷만 생겼다» 는 뜻이므로
-- 적용을 실패로 취급해야 한다. 적용 후 확인은 아래 org_logo_storage_installed() 로 한다.

do $storage$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise warning 'org logo storage policies skipped: storage schema absent (test environment only; verify with public.org_logo_storage_installed())';
    return;
  end if;

  -- 용량·형식을 Storage 서버가 강제한다. 앱을 우회해 직접 올려도 여기서 막힌다.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'org-logos',
    'org-logos',
    false,
    1048576,
    array['image/png', 'image/jpeg', 'image/svg+xml']
  )
  on conflict (id) do update
    set public             = false,
        file_size_limit    = 1048576,
        allowed_mime_types = array['image/png', 'image/jpeg', 'image/svg+xml'];

  execute 'drop policy if exists org_logos_read on storage.objects';
  execute $policy$
    create policy org_logos_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'org-logos'
        and public.org_logo_object_org(name) is not null
        and public.is_org_member(public.org_logo_object_org(name))
      )
  $policy$;

  execute 'drop policy if exists org_logos_insert on storage.objects';
  execute $policy$
    create policy org_logos_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'org-logos'
        and public.org_logo_object_org(name) is not null
        and public.org_role(public.org_logo_object_org(name)) in ('owner', 'admin')
      )
  $policy$;

  execute 'drop policy if exists org_logos_update on storage.objects';
  execute $policy$
    create policy org_logos_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'org-logos'
        and public.org_logo_object_org(name) is not null
        and public.org_role(public.org_logo_object_org(name)) in ('owner', 'admin')
      )
      with check (
        bucket_id = 'org-logos'
        and public.org_logo_object_org(name) is not null
        and public.org_role(public.org_logo_object_org(name)) in ('owner', 'admin')
      )
  $policy$;

  execute 'drop policy if exists org_logos_delete on storage.objects';
  execute $policy$
    create policy org_logos_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'org-logos'
        and public.org_logo_object_org(name) is not null
        and public.org_role(public.org_logo_object_org(name)) in ('owner', 'admin')
      )
  $policy$;
end
$storage$;

-- =====================================================================
-- 6. 적용 확인 — 「버킷만 생기고 정책은 없다」를 잡는다
-- =====================================================================
--
-- 운영 적용 뒤 이것이 true 여야 한다. false 면 §5 의 건너뛰기가 일어난 것이다.

-- 본문이 storage 를 «동적으로» 참조한다. storage 스키마가 없는 환경에서도
-- 함수 «생성» 은 성공해야 하기 때문이다 (일반 SQL 본문은 생성 시점에 검증된다).

create or replace function public.org_logo_storage_installed()
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $function$
declare
  v_bucket_ok  boolean;
  v_policy_num bigint;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return false;
  end if;

  execute $q$select exists (select 1 from storage.buckets b where b.id = 'org-logos' and b.public = false)$q$
    into v_bucket_ok;

  -- ★ 이름만 세지 않는다. 이름이 org_logos_insert 인데 for select 로 만들어져 있으면
  --   개수만 세는 검사는 통과한다. 명령(cmd)까지 맞춰 본다.
  select count(*) into v_policy_num
    from pg_policies p
   where p.schemaname = 'storage'
     and p.tablename = 'objects'
     and (p.policyname, p.cmd) in (
       ('org_logos_read', 'SELECT'),
       ('org_logos_insert', 'INSERT'),
       ('org_logos_update', 'UPDATE'),
       ('org_logos_delete', 'DELETE')
     );

  -- RLS 가 꺼져 있으면 정책은 장식이다. 그것도 확인한다.
  if not coalesce((select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass), false) then
    return false;
  end if;

  return v_bucket_ok and v_policy_num = 4;
end;
$function$;

alter function public.org_logo_storage_installed() owner to postgres;
revoke all on function public.org_logo_storage_installed()
  from public, anon, authenticated, service_role;

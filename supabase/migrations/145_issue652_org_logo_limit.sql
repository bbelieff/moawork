-- moa-migration-guard: logical_key=145_issue652_org_logo_limit predecessor=144_issue672_detail_event_remove digest=4e4ed730630324607fedb3560d241d6300b6acd826598699f8b6a199acb488c7 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '145_issue652_org_logo_limit',
  p_file_name => '145_issue652_org_logo_limit.sql',
  p_file_digest => '4e4ed730630324607fedb3560d241d6300b6acd826598699f8b6a199acb488c7',
  p_expected_predecessor => '144_issue672_detail_event_remove',
  p_executor => 'DC',
  p_thread_id => '9f4c1e02-7a3b-4d18-b6c5-2e8a1d09f7b4',
  p_foundation => false
);

-- 회사 로고 용량 상한을 «넓힌다» (#652).
--
-- ## 왜
--
-- 총괄 지시 — 「아무리 로고라고 해도 용량제한은 너무 빡빡하다. 용량제한은 조금 더
-- 여유있게 해주고 자동압축을 해서 권장에 맞춰주는 기능을 넣어줘」
--
-- 지금 1 MiB 인데, 로고가 «한 번도» 올라간 적이 없다(실측: 5개 회사 전부 logo_path null).
-- 원인 셋 중 하나가 이 상한이었다 — Next 서버 액션 본문 상한도 마침 1 MB 라
-- 조금이라도 큰 파일은 **우리 코드가 실행되기 전에** 잘려서 안내조차 못 떴다.
--
-- ## 이제 앱이 줄여서 보낸다
--
-- 화면이 올리기 전에 긴 변 512px · 약 320KB 로 줄인다(app/src/lib/org-logo/compress.ts).
-- 그래서 실제로 저장되는 파일은 작다. 이 상한은 «압축이 안 통하는 경우» 를 위한 여유다 —
-- SVG 는 벡터라 안 줄이고, 브라우저가 캔버스를 못 쓰면 원본이 그대로 온다.
--
-- ## 넓히기만 한다
--
-- ★ 기존 로고를 건드리지 않는다. 지금 저장된 로고가 0건이라 옮길 것도 없다.
-- ★ 상한을 «올리기만» 한다. 좁히면 이미 올라간 것이 규칙을 어기게 된다.

update storage.buckets
   set file_size_limit = 4194304          -- 4 MiB
 where id = 'org-logos'
   and coalesce(file_size_limit, 0) < 4194304;

-- RPC 도 같은 값이어야 한다. 한쪽만 올리면 «버킷은 받았는데 기록이 거부되는» 상태가 된다.
create or replace function public.set_org_logo(p_org_id uuid, p_path text, p_mime text, p_bytes integer)
returns table(logo_path text, logo_mime text, logo_bytes integer, logo_updated_at timestamptz)
language plpgsql security definer set search_path to 'public', 'pg_temp'
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
  -- ★ 용량 검증. 1 MiB → 4 MiB 로 «넓혔다»(#652). 이 줄만 바뀌었다.
  if p_bytes is null or p_bytes <= 0 or p_bytes > 4194304 then
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

-- ## 적용 뒤 사실 확인
--
-- 「올렸는데 여전히 안 되는」 상태로 넘어가지 않게, 둘이 «같은 값» 인지 여기서 잡는다.

do $$
declare
  v_bucket bigint;
  v_def text;
begin
  select file_size_limit into v_bucket from storage.buckets where id = 'org-logos';
  if v_bucket is null or v_bucket < 4194304 then
    raise exception '버킷 상한이 안 올라갔습니다: %', coalesce(v_bucket::text, 'null') using errcode = '22023';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'set_org_logo';
  if v_def is null or v_def not like '%4194304%' then
    raise exception 'RPC 상한이 버킷과 다릅니다' using errcode = '22023';
  end if;

  -- 넓히기만 했는지 — 권한 판정이 그대로 남아 있어야 한다.
  if v_def not like '%owner%' or v_def not like '%admin%' or v_def not like '%42501%' then
    raise exception '권한 판정이 사라졌습니다' using errcode = '42501';
  end if;
end $$;

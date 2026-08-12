-- 060_deal_collab_notify.sql — 딜 협업 알림 (BBE-16)
--
-- 001~059 무수정, additive. `019_notifications.sql`(notifications 표·RLS)이 이미 존재한다는
-- 전제 위에서, "담당자 배정"·"댓글 멘션"·"보완요청(되돌려보내기)" 세 발행 지점만 추가한다.
--
-- 019 의 원칙을 그대로 따른다:
--   * notifications 는 client insert 정책이 없다(위조·남발 방지) → 발행은
--     SECURITY DEFINER 트리거/함수로만 한다.
--   * 알림 문구에 고객 원문(댓글 본문 등)을 넣지 않는다 — 딥링크로 유도한다.

-- =====================================================================
-- 1. 담당자 배정 — deals.assigned_to 변경 시 새 담당자에게 알림
-- =====================================================================
create or replace function public.notify_deal_assigned()
  returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- 배정 해제(null) 또는 실제 변경이 없으면 조용히 종료.
  if new.assigned_to is null or new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;
  -- 자기 자신에게 재배정(본인이 스스로 맡음)은 알리지 않는다.
  if new.assigned_to = auth.uid() then
    return new;
  end if;

  -- 새 담당자가 그 딜의 «조직 멤버» 인지 확인한다.
  -- deals.assigned_to 는 users(id) 참조일 뿐 조직 제약이 없어서, 타 조직 user_id 가
  -- 들어오면 그 사람 앞으로 고아 notifications 행이 생긴다(019 의 select 정책이
  -- 읽기는 막으므로 유출은 없지만 행은 남는다). 아래 두 함수(mention_org_members ·
  -- request_deal_followup)는 이미 같은 검증을 하고 있다 — 여기만 빠져 있었다.
  if not exists (
    select 1 from org_members m
     where m.org_id = new.org_id and m.user_id = new.assigned_to
  ) then
    return new;
  end if;

  insert into notifications (org_id, user_id, type, title, body, target_type, target_id, actor_id, is_action)
  values (
    new.org_id,
    new.assigned_to,
    'assigned',
    '딜이 배정되었습니다',
    '담당자로 지정된 딜이 있습니다.',
    'deal',
    new.id,
    auth.uid(),
    true
  );

  return new;
end $$;

drop trigger if exists trg_notify_deal_assigned on public.deals;
create trigger trg_notify_deal_assigned
  after update of assigned_to on public.deals
  for each row execute function public.notify_deal_assigned();

-- =====================================================================
-- 2. 댓글 멘션 — 앱이 명시 호출하는 RPC(댓글은 deals.custom jsonb 라 트리거 대상이 아님)
-- =====================================================================
-- 호출자(auth.uid())가 해당 조직 멤버인지, 대상 user_id 들도 같은 조직 멤버인지
-- 함수 내부에서 재검증한다 — 클라이언트가 준 목록을 신뢰하지 않는다.
create or replace function public.mention_org_members(
  p_org_id uuid,
  p_deal_id uuid,
  p_user_ids uuid[]
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target uuid;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  -- 대상 딜이 실제로 그 조직 소속인지 확인(다른 조직 딜에 알림을 못 걸게).
  if not exists (select 1 from deals d where d.id = p_deal_id and d.org_id = p_org_id) then
    raise exception 'deal not found in organization' using errcode = '42501';
  end if;

  foreach v_target in array coalesce(p_user_ids, array[]::uuid[])
  loop
    -- 대상이 같은 조직 멤버가 아니면 건너뛴다(위조 방지 — 있는 사람만 부를 수 있다).
    if not exists (
      select 1 from org_members m where m.org_id = p_org_id and m.user_id = v_target
    ) then
      continue;
    end if;
    -- 자기 자신을 멘션한 경우는 알리지 않는다.
    if v_target = auth.uid() then
      continue;
    end if;

    insert into notifications (org_id, user_id, type, title, body, target_type, target_id, actor_id, is_action)
    values (
      p_org_id, v_target, 'mention',
      '댓글에서 언급되었습니다', null,
      'deal', p_deal_id, auth.uid(), true
    );
  end loop;
end $$;

revoke all on function public.mention_org_members(uuid, uuid, uuid[]) from public;
grant execute on function public.mention_org_members(uuid, uuid, uuid[]) to authenticated;

-- =====================================================================
-- 3. 보완요청("되돌려보내기") — 담당자에게 "나에게 요청됨" 알림
-- =====================================================================
create or replace function public.request_deal_followup(
  p_org_id uuid,
  p_deal_id uuid
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_assignee uuid;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  select assigned_to into v_assignee
    from deals where id = p_deal_id and org_id = p_org_id;

  if v_assignee is null or v_assignee = auth.uid() then
    return; -- 담당자 없음 또는 본인이 스스로 요청 — 알림 생략.
  end if;

  insert into notifications (org_id, user_id, type, title, body, target_type, target_id, actor_id, is_action)
  values (
    p_org_id, v_assignee, 'requested',
    '보완 요청이 도착했습니다', '담당 딜에 보완이 필요합니다. 댓글에서 사유를 확인하세요.',
    'deal', p_deal_id, auth.uid(), true
  );
end $$;

revoke all on function public.request_deal_followup(uuid, uuid) from public;
grant execute on function public.request_deal_followup(uuid, uuid) to authenticated;

-- =====================================================================
-- 4. 스키마 버전 메타
-- =====================================================================
insert into public.app_meta (key, value)
values ('schema_version', '060')
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

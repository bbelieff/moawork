-- moa-migration-guard: logical_key=170_member_account_profiles_batch predecessor=169_board_trash_lifecycle digest=df72a4bba1a5a46b3a247901603fdcfff5b0fb4bed1185791ce6292ffc2a3621 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '170_member_account_profiles_batch',
  p_file_name => '170_member_account_profiles_batch.sql',
  p_file_digest => 'df72a4bba1a5a46b3a247901603fdcfff5b0fb4bed1185791ce6292ffc2a3621',
  p_expected_predecessor => '169_board_trash_lifecycle',
  p_executor => 'DC',
  p_thread_id => '9ffa2331-f8b8-46fc-9b09-6375b2e85f6c',
  p_foundation => false
);

-- Issue 857 — 회원 표시 정보(이름·직함·팀)를 한 번에 읽는다.
--
--   앱은 탭 화면·기본 탭 점검·진입 복구마다 회원 수만큼 get_member_account_profile(011)을 불렀다
--   (회원 목록 → 사람마다 한 번 = 왕복 두 물결, 회원이 많으면 호출도 그만큼). 같은 규칙을 한 번에:
--     · 부르는 사람은 이 회사의 활성 멤버여야 한다(is_org_member — 015 정의: 활성 멤버십·활성 회사).
--     · 돌려주는 사람은 이 회사의 활성 멤버만, 회사도 활성일 때만(011 의 'member unavailable' 조건).
--     · 돌려주는 모양은 011 과 같다: {id, name, title, team_key}.
--   읽기 전용이다(stable). 표에 직접 권한을 주지 않고 이 함수로만 연다(011 과 같은 방식).

create or replace function public.list_member_account_profiles(p_org_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_org_member(p_org_id) then
    raise exception 'active membership required' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(
             jsonb_build_object('id', u.id, 'name', u.name, 'title', p.title, 'team_key', p.team_key)
             order by m.created_at, u.id)
      from public.org_members m
      join public.orgs o on o.id = m.org_id and o.status = 'active'
      join public.users u on u.id = m.user_id
      left join public.member_account_profiles p on p.org_id = m.org_id and p.user_id = m.user_id
     where m.org_id = p_org_id and m.status = 'active'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_member_account_profiles(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_member_account_profiles(uuid) to authenticated;

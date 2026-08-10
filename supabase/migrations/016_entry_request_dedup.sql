-- =====================================================================
-- 014_entry_request_dedup.sql — 진입 요청 중복 차단 (C0-2)
--
-- 증상: 회사 만들기 요청 후 **뒤로가기**로 같은 화면에 돌아가 다시 제출하면
--       pending 상태의 'create' 요청이 여러 건 쌓인다. 승인 큐에 같은 사람의
--       같은 요청이 중복 노출되고, 오너가 어느 것을 승인해야 할지 알 수 없다.
--
-- 원인: 006 이 'join' 은 부분 유니크 인덱스로 막았지만
--       (workspace_entry_one_pending_join_idx: requester_user_id + target_org_id),
--       'create' 는 **일반 인덱스**(workspace_entry_pending_create_idx)만 있어
--       중복이 그대로 들어간다.
--
-- 조치: 'create' 도 같은 방식으로 막는다 — **사용자당 pending create 1건**.
--       target_org_id 가 없는 요청이므로 requester_user_id 단독 부분 유니크다.
--
-- 성격: additive(인덱스 1개 추가). 001~013 무수정. RLS 정책·is_org_member() 무수정.
--
-- ⚠ 적용 전 정리 필요: 이미 중복 pending create 가 쌓여 있으면 인덱스 생성이 실패한다.
--    아래 정리 구문이 **가장 최근 1건만 남기고** 나머지를 취소 처리한다(삭제 아님 —
--    이력은 보존하고 status 만 내린다).
-- =====================================================================

-- 1) 기존 중복 정리 — 사용자별 최신 pending create 1건만 남기고 나머지는 취소.
--    (삭제하지 않는다. 사용자가 "내 요청이 사라졌다"고 느끼지 않도록 이력을 남긴다.)
with ranked as (
  select
    id,
    row_number() over (
      partition by requester_user_id
      order by created_at desc, id desc
    ) as rn
  from public.workspace_entry_requests
  where kind = 'create' and status = 'pending'
)
update public.workspace_entry_requests r
   set status = 'cancelled',
       resolved_at = now()
  from ranked
 where r.id = ranked.id
   and ranked.rn > 1;

-- 2) 사용자당 pending create 1건 강제.
create unique index if not exists workspace_entry_one_pending_create_idx
  on public.workspace_entry_requests (requester_user_id)
  where kind = 'create' and status = 'pending';

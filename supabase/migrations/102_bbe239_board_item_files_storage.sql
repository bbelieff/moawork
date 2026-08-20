-- moa-migration-guard: logical_key=102_bbe239_board_item_files_storage predecessor=101_bbe238_notice_board_unlock digest=555518005c270ce5ea9141fb13e1ded35f641144ac41863448fda32ad3811c38 foundation=false

select public.begin_guarded_migration(
  p_logical_key => '102_bbe239_board_item_files_storage',
  p_file_name => '102_bbe239_board_item_files_storage.sql',
  p_file_digest => '555518005c270ce5ea9141fb13e1ded35f641144ac41863448fda32ad3811c38',
  p_expected_predecessor => '101_bbe238_notice_board_unlock',
  p_executor => 'DC-00',
  p_thread_id => '2bc3b632-23c9-44af-82b2-45d6096fbbf3',
  p_foundation => false
);

-- BBE-239 · 보드 아이템 첨부파일을 Postgres jsonb(base64) 대신 Supabase Storage 로.
--
-- 왜: 공지사항의 `official_pdf` 컬럼이 base64 로 인코딩한 파일을 item_values.value_jsonb 에
-- 직접 저장하고 있었다(`app/src/lib/notices/official-file.ts`) — 무료 요금제 Postgres DB
-- 용량(500MB, 프로젝트 전체 테이블 공유)을 공문 PDF·스캔 이미지가 잠식한다.
-- Storage 는 별도 쿼터(1GB)라 여기로 옮긴다. 경로 규약은 `services/files.ts` 의
-- `buildStoragePath`(딜 전용)와 대칭이지만 보드 아이템은 딜에 안 묶이므로 별도 규약:
--   {orgId}/{boardId}/{itemId}/{fileId}__{filename}
-- storage.foldername(name)[1] 이 orgId 라서 RLS 는 org 격리를 그 세그먼트만으로 건다.
--
-- 기존 base64 첨부는 이 마이그레이션이 건드리지 않는다 — 백필은 별도 판단(BBE-239 본문).

insert into storage.buckets (id, name, public)
  values ('board-item-files', 'board-item-files', false)
  on conflict (id) do nothing;

drop policy if exists board_item_files_select on storage.objects;
create policy board_item_files_select on storage.objects for select
  using (bucket_id = 'board-item-files' and public.is_org_member((storage.foldername(name))[1]::uuid));

drop policy if exists board_item_files_insert on storage.objects;
create policy board_item_files_insert on storage.objects for insert
  with check (bucket_id = 'board-item-files' and public.is_org_member((storage.foldername(name))[1]::uuid));

drop policy if exists board_item_files_delete on storage.objects;
create policy board_item_files_delete on storage.objects for delete
  using (bucket_id = 'board-item-files' and public.is_org_member((storage.foldername(name))[1]::uuid));

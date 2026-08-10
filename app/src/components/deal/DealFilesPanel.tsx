"use client";

/**
 * 첨부 패널 (T02) — T04 의 `FilesTab` 을 서버 액션에 연결하는 얇은 어댑터.
 *
 * FilesTab 자체는 T04 소유라 손대지 않는다. 여기서는 업로드/삭제 핸들러만
 * 서버 액션으로 이어준다.
 */

import type { DealFileRef } from "@/lib/services/files";
import { FilesTab } from "./FilesTab";
import { removeFileAction, uploadFileAction } from "@/app/(app)/deals/[dealId]/actions";

export function DealFilesPanel({
  dealId,
  files,
  canEdit,
}: {
  dealId: string;
  files: DealFileRef[];
  canEdit: boolean;
}) {
  return (
    <FilesTab
      files={files}
      disabled={!canEdit}
      onUpload={(input) => uploadFileAction(dealId, input)}
      onRemove={(fileId) => removeFileAction(dealId, fileId)}
    />
  );
}

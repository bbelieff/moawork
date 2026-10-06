"use client";

import { renameGroupTitleAction } from "@/app/(app)/boards/title-actions";
import { BoardInlineTitleEditor } from "./BoardInlineTitleEditor";

/**
 * `display` 는 표시 전용(예: 앞머리 이모지 걷기 — #839). 편집칸은 저장된 원문을 그대로 보여
 * 주므로, 이름을 고쳐 저장해도 걷어 낸 글자가 몰래 저장되지 않는다.
 */
export function GroupNameEditor({ boardId, groupId, name, display }: { boardId: string; groupId: string; name: string; display?: (saved: string) => string }) {
  return <BoardInlineTitleEditor name={name} label="그룹 이름" display={display} onSave={(value)=>renameGroupTitleAction(boardId,groupId,value)} className="text-sm font-semibold"/>;
}

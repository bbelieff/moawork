"use client";

import { renameGroupTitleAction } from "@/app/(app)/boards/title-actions";
import { BoardInlineTitleEditor } from "./BoardInlineTitleEditor";

export function GroupNameEditor({ boardId, groupId, name }: { boardId: string; groupId: string; name: string }) {
  return <BoardInlineTitleEditor name={name} label="그룹 이름" onSave={(value)=>renameGroupTitleAction(boardId,groupId,value)} className="text-sm font-semibold"/>;
}

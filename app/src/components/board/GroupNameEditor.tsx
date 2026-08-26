"use client";

import { startTransition, useState } from "react";
import { renameGroupAction } from "@/app/(app)/boards/actions";

export function GroupNameEditor({ boardId, groupId, name }: { boardId: string; groupId: string; name: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  if (!editing) return (
    <button type="button" aria-label={`${name} 이름 변경`} title="그룹 이름 변경"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); setEditing(true); }}
      className="rounded px-1 py-0.5 text-[0.65rem] text-mw-sub hover:bg-mw-card hover:text-mw-fg">✎</button>
  );
  return (
    <form onClick={(event) => event.stopPropagation()} onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setPending(true);
      startTransition(async () => { await renameGroupAction(data); setPending(false); setEditing(false); });
    }} className="flex items-center gap-1">
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId} />
      <input name="name" defaultValue={name} autoFocus maxLength={100} required
        aria-label="새 그룹 이름" className="h-7 w-44 rounded border border-mw-line bg-mw-card px-2 text-xs text-mw-fg outline-none focus:border-mw-record" />
      <button disabled={pending} className="h-7 rounded bg-mw-primary px-2 text-[0.65rem] font-semibold text-mw-on-accent">저장</button>
      <button type="button" onClick={() => setEditing(false)} className="h-7 rounded border border-mw-line px-2 text-[0.65rem] text-mw-sub">취소</button>
    </form>
  );
}

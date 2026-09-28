"use client";

import { useActionState, useRef, useState } from "react";
import {
  saveOtherInfoAction,
} from "@/app/(app)/boards/other-info-actions";
import {
  INITIAL_OTHER_INFO_SAVE_STATE,
  type OtherInfoSaveState,
} from "@/app/(app)/boards/other-info-action-state";
import {
  emptyOtherInfoValue,
  projectOtherInfoValue,
  type OtherInfoLegacyInput,
  type OtherInfoValue,
} from "@/lib/boards/structured-field";
import { BoardModalLayer } from "./BoardDialogPortal";
import { OtherInfoCell } from "./OtherInfoCell";
import { OtherInfoEditor } from "./OtherInfoEditor";

export function OtherInfoBoardCell({
  boardId,
  itemId,
  fieldKey,
  value,
  legacy,
  readOnly,
  error,
  saveAction = saveOtherInfoAction,
}: {
  boardId: string;
  itemId: string;
  fieldKey: string;
  value: unknown;
  legacy?: OtherInfoLegacyInput;
  readOnly: boolean;
  error?: string | null;
  saveAction?: (previous: OtherInfoSaveState, formData: FormData) => Promise<OtherInfoSaveState>;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [draft, setDraft] = useState<OtherInfoValue>(() => projectOtherInfoValue(value, legacy).value);
  const [state, action, pending] = useActionState(async (previous: OtherInfoSaveState, formData: FormData) => {
    const next = await saveAction(previous, formData);
    if (next.ok === true && next.requestId && next.requestId === formData.get("requestId")) setOpen(false);
    return next;
  }, INITIAL_OTHER_INFO_SAVE_STATE);

  const openEditor = () => {
    setDraft(projectOtherInfoValue(value, legacy).value);
    setRequestId(crypto.randomUUID());
    setOpen(true);
  };
  const closeEditor = () => {
    if (!pending) setOpen(false);
  };
  const activeError = state.ok === false && state.requestId === requestId
    ? state.message
    : error;

  return (
    <div className="min-w-0">
      <OtherInfoCell
        value={value}
        legacy={legacy}
        readOnly={readOnly}
        error={activeError}
        buttonRef={triggerRef}
        onOpen={readOnly ? undefined : openEditor}
      />
      {open ? (
        <BoardModalLayer
          label="기타정보 편집"
          dismissible={!pending}
          onClose={closeEditor}
          returnFocusRef={triggerRef}
        >
          <form
            ref={formRef}
            action={action}
            className="flex max-h-[min(44rem,calc(100dvh-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-mw-line bg-mw-card shadow-lg"
          >
            <input type="hidden" name="boardId" value={boardId} />
            <input type="hidden" name="itemId" value={itemId} />
            <input type="hidden" name="fieldKey" value={fieldKey} />
            <input type="hidden" name="requestId" value={requestId} />
            <input type="hidden" name="value" value={JSON.stringify(draft)} />
            <header className="flex items-start gap-3 border-b border-mw-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-bold text-mw-fg">기타정보</h2>
                <p className="mt-1 text-xs leading-5 text-mw-sub">체크를 풀어도 입력한 내용은 남습니다. «전체 초기화»를 눌렀을 때만 다섯 내용을 비웁니다.</p>
              </div>
              <button type="button" disabled={pending} onClick={closeEditor} aria-label="기타정보 닫기" className="min-h-9 min-w-9 rounded-lg text-mw-sub hover:bg-mw-bg disabled:opacity-50">✕</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <OtherInfoEditor
                value={draft}
                disabled={pending}
                error={activeError}
                onChange={setDraft}
                onCommit={() => formRef.current?.requestSubmit()}
                onCancel={closeEditor}
              />
            </div>
            <footer className="flex items-center gap-2 border-t border-mw-line px-5 py-3">
              <button type="button" disabled={pending} onClick={() => setDraft(emptyOtherInfoValue())} className="min-h-10 rounded-lg px-3 text-xs text-mw-error hover:bg-mw-bg disabled:opacity-50">전체 초기화</button>
              <button type="button" disabled={pending} onClick={closeEditor} className="ml-auto min-h-10 rounded-lg border border-mw-line px-4 text-xs font-semibold text-mw-body disabled:opacity-50">취소</button>
              <button type="submit" disabled={pending} className="min-h-10 rounded-lg bg-mw-record px-5 text-xs font-semibold text-mw-on-accent disabled:cursor-wait disabled:opacity-60">{pending ? "저장 중…" : "저장"}</button>
            </footer>
          </form>
        </BoardModalLayer>
      ) : null}
    </div>
  );
}

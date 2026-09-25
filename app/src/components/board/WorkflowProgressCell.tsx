"use client";

import Link from "next/link";
import { useId, useRef, useState, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { setCellAction } from "@/app/(app)/boards/actions";
import {
  workflowProgressSpec,
  type WorkflowProgressKind,
} from "@/lib/workflow/progress";
import { BOARD_TABLE_CONTROL } from "./table-style";

const TRANSFER = "__workflow_transfer__";

export function WorkflowProgressCell({
  boardId,
  row,
  column,
  kind,
  readOnly,
  error,
  transitionAction,
  cellAction,
}: Readonly<{
  boardId: string;
  row: ItemWithValues;
  column: BoardColumn;
  kind: WorkflowProgressKind;
  readOnly: boolean;
  error?: string | null;
  transitionAction?: ReactNode;
  cellAction?: (formData: FormData) => Promise<void>;
}>) {
  const spec = workflowProgressSpec(kind);
  const current = typeof row.values[spec.stageColumnKey] === "string"
    ? String(row.values[spec.stageColumnKey])
    : "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const descriptionId = useId();

  return (
    <div className="min-w-40">
      <form action={cellAction ?? setCellAction}>
        <input type="hidden" name="boardId" value={boardId} />
        <input type="hidden" name="itemId" value={row.id} />
        <input type="hidden" name="columnKey" value={spec.stageColumnKey} />
        <select
          name="value"
          key={`${row.id}:${current}`}
          defaultValue={current}
          disabled={readOnly}
          aria-label="진행현황"
          aria-describedby={descriptionId}
          className={`${BOARD_TABLE_CONTROL} font-semibold focus:ring-2 focus:ring-mw-primary/20 disabled:cursor-not-allowed disabled:opacity-70`}
          onChange={(event) => {
            if (event.currentTarget.value === TRANSFER) {
              event.preventDefault();
              event.currentTarget.value = current;
              setDialogOpen(true);
              dialog.current?.showModal();
              return;
            }
            event.currentTarget.form?.requestSubmit();
          }}
        >
          <option value="">미선택</option>
          <optgroup label="보드 안 단계">
            {(column.options_jsonb?.options ?? []).map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </optgroup>
          <optgroup label="다음 업무로 이동">
            <option value={TRANSFER}>→ {spec.transitionLabel}</option>
          </optgroup>
        </select>
      </form>
      <span id={descriptionId} className="sr-only">
        보드 안 단계는 즉시 저장되고, 다음 업무로 이동은 확인 후 실행됩니다.
      </span>
      {error ? <p role="alert" className="mt-1 text-[0.65rem] text-mw-error">{error}</p> : null}

      <dialog
        ref={dialog}
        aria-labelledby={`${descriptionId}-title`}
        className="fixed inset-0 m-auto max-h-[calc(100vh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto whitespace-normal rounded-md border border-mw-line bg-mw-card p-0 text-mw-fg shadow-lg backdrop:bg-slate-950/50 backdrop:backdrop-blur-[1px]"
        onClose={() => setDialogOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-mw-line px-5 py-4">
          <div>
            <p className="text-xs font-semibold text-mw-record">다음 업무로 이동</p>
            <h2 id={`${descriptionId}-title`} className="mt-1 text-lg font-bold tracking-tight">
              {row.title} → {spec.targetLabel}
            </h2>
          </div>
          <button type="button" aria-label="닫기" onClick={() => dialog.current?.close()} className="h-8 w-8 rounded-full border border-mw-line text-mw-sub hover:bg-mw-bg">×</button>
        </div>
        <div className="px-5 py-4">
          <p className="rounded-md bg-mw-tint-blue px-3 py-2 text-sm leading-6 text-mw-body">
            보드 안 단계 변경과 달리 이 선택은 실제 업무 탭을 넘깁니다.
            {spec.guardLabel ? ` «${spec.guardLabel}» 조건을 확인한 뒤 이동합니다.` : " 이동 전 마지막으로 확인해 주세요."}
          </p>
          {kind === "new-lead" ? (
            <form action={cellAction ?? setCellAction} className="mt-4 flex justify-end gap-2">
              <input type="hidden" name="boardId" value={boardId} />
              <input type="hidden" name="itemId" value={row.id} />
              <input type="hidden" name="columnKey" value={spec.stageColumnKey} />
              <input type="hidden" name="value" value={spec.transitionValue ?? ""} />
              <button type="button" onClick={() => dialog.current?.close()} className="h-10 rounded-lg border border-mw-line px-4 text-sm font-semibold text-mw-body">취소</button>
              <button type="submit" data-mw-cta="primary" className="h-10 rounded-lg bg-mw-primary px-4 text-sm font-semibold text-mw-on-accent">{spec.transitionLabel}</button>
            </form>
          ) : kind === "contact" ? (
            dialogOpen
              ? transitionAction ?? <p role="alert" className="mt-4 text-sm text-mw-error">이동 정보를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.</p>
              : null
          ) : (
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => dialog.current?.close()} className="h-10 rounded-lg border border-mw-line px-4 text-sm font-semibold text-mw-body">취소</button>
              <Link href={spec.targetHref} data-mw-cta="primary" className="inline-flex h-10 items-center rounded-lg bg-mw-primary px-4 text-sm font-semibold text-mw-on-accent">{spec.transitionLabel}</Link>
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}

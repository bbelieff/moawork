"use client";

import Link from "next/link";
import { newLeadStageLabel } from "@/lib/new-lead/stage-presentation";
import { useId, useRef, useState, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { setCellAction } from "@/app/(app)/boards/actions";
import {
  workflowProgressSpec,
  type WorkflowProgressKind,
  type WorkflowStageMoveTargets,
} from "@/lib/workflow/progress";
import { BOARD_TABLE_CONTROL } from "./table-style";
import { NewLeadPipelineRepair } from "./NewLeadPipelineRepair";
import { StagePicker } from "./StagePicker";

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
  bulkIntercept,
  moveTargets,
}: Readonly<{
  boardId: string;
  row: ItemWithValues;
  column: BoardColumn;
  kind: WorkflowProgressKind;
  readOnly: boolean;
  error?: string | null;
  transitionAction?: ReactNode;
  cellAction?: (formData: FormData) => Promise<void>;
  /**
   * 여러 행이 선택된 상태의 낱개 진행 변경을 일괄 흐름으로 넘긴다.
   * true 를 돌려주면 낱개 저장·전이 대화를 건너뛰고 표시값으로 되돌린다.
   */
  bulkIntercept?: (nextValue: string) => boolean;
  /**
   * 2026-10-06 (#839) — 이 보드에서 «행을 옮기는» 선택지 → 목표 그룹. 원본 단계 컬럼의
   * 이동 규칙에서 만든 표시 전용 정보다. 없으면 한 묶음(보드 안 단계)으로 보여 준다.
   */
  moveTargets?: WorkflowStageMoveTargets | null;
}>) {
  const spec = workflowProgressSpec(kind);
  const current = typeof row.values[spec.stageColumnKey] === "string"
    ? String(row.values[spec.stageColumnKey])
    : "";
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const repairAvailable = Boolean(error?.includes("현재 단계에서는 이 관문을 넘을 수 없습니다"));
  // ★ 2026-10-06 (#839) — 칸에는 색 칩 하나(StagePicker)만 둔다. 검색은 팝오버 «안» 에 있다.
  //   만들기 입구는 여전히 없다(StagePicker 에 만들기 경로가 없다 — 단계값은 전이·이동규칙과
  //   묶여 있어 새 값을 넣으면 «골랐는데 카드가 안 움직이는» 상태가 된다).
  //   제출·전이 대화·일괄 가로채기 계약은 그대로다: hidden value 에 고른 id 를 직접 쓰고
  //   form.requestSubmit() — 팝오버는 body 로 포털되므로 폼 밖이다(LabelCombobox 와 같은 방식).
  const stageOptions = column.options_jsonb?.options ?? [];
  // 낙관적 표시 — 저장값이 바뀌거나(이동·재조회) 새 오류가 오면 버리고 저장값을 다시 보여 준다.
  const [optimistic, setOptimistic] = useState<{ base: string; value: string; error: string | null } | null>(null);
  if (optimistic && (optimistic.base !== current || optimistic.error !== (error ?? null))) setOptimistic(null);
  const shown = optimistic && optimistic.base === current && optimistic.error === (error ?? null)
    ? optimistic.value
    : current;
  const fallbackLabel = kind === "new-lead" ? newLeadStageLabel(shown) : shown;

  function selectStage(next: string) {
    if (bulkIntercept?.(next)) return;
    if (next === TRANSFER) {
      setDialogOpen(true);
      dialog.current?.showModal();
      return;
    }
    const input = valueInput.current;
    if (!input?.form || next === shown) return;
    input.value = next;
    setOptimistic({ base: current, value: next, error: error ?? null });
    input.form.requestSubmit();
  }

  return (
    <div className="min-w-40">
      <form action={cellAction ?? setCellAction}>
        <input type="hidden" name="boardId" value={boardId} />
        <input type="hidden" name="itemId" value={row.id} />
        <input type="hidden" name="columnKey" value={spec.stageColumnKey} />
        <input ref={valueInput} key={`value:${row.id}:${current}`} type="hidden" name="value" defaultValue={current} />
        <StagePicker
          key={`picker:${row.id}:${current}`}
          boardId={boardId}
          itemId={row.id}
          options={stageOptions}
          value={shown}
          fallbackLabel={fallbackLabel}
          moveTargets={moveTargets}
          currentGroupId={row.group_id}
          transitionLabel={spec.transitionLabel}
          disabled={readOnly}
          describedBy={descriptionId}
          searchClassName={BOARD_TABLE_CONTROL}
          onSelect={selectStage}
          onTransfer={() => selectStage(TRANSFER)}
        />
      </form>
      <span id={descriptionId} className="sr-only">
        보드 안 단계는 즉시 저장되고, 다음 업무로 이동은 확인 후 실행됩니다.
      </span>
      {!dialogOpen && error ? <p role="alert" className="mt-1 text-[0.65rem] text-mw-error">{error}</p> : null}
      {!dialogOpen && !readOnly && kind === "new-lead" && repairAvailable ? (
        <button type="button" className="mt-1 rounded border border-mw-line px-2 py-1 text-xs" onClick={() => {
          setDialogOpen(true);
          dialog.current?.showModal();
        }}>단계 구성 확인</button>
      ) : null}

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
          {error ? <p role="alert" className="mt-3 text-sm text-mw-error">{error}</p> : null}
          {!readOnly && kind === "new-lead" ? (
            <NewLeadPipelineRepair key={row.id} itemId={row.id} available={repairAvailable} />
          ) : null}
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

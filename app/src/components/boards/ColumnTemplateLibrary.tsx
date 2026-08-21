"use client";

import { startTransition, useActionState, useMemo, useState } from "react";
import type { BoardColumn } from "@/lib/boards/types";
import { previewColumnTemplate } from "@/lib/presets/column-template";
import { loadColumnTemplatesAction, mutateColumnTemplateAction } from "@/app/(app)/boards/column-template-actions";
import { INITIAL_COLUMN_TEMPLATE_STATE } from "@/app/(app)/boards/column-template-state";
import { newColumnTemplateRequestId } from "./column-template-request";

export function ColumnTemplateLibrary({ boardId, columns }: { boardId: string; columns: BoardColumn[] }) {
  const [state, action, pending] = useActionState(mutateColumnTemplateAction, INITIAL_COLUMN_TEMPLATE_STATE);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [library, setLibrary] = useState(state.templates);
  const [sourceColumnId, setSourceColumnId] = useState(columns[0]?.id ?? "");
  const [templateId, setTemplateId] = useState("");
  const [targetColumnId, setTargetColumnId] = useState("");
  const templates = state.templates.length > 0 || state.message ? state.templates : library;
  const selected = templates.find((template) => template.id === templateId);
  const target = columns.find((column) => column.id === targetColumnId);
  const preview = useMemo(() => selected ? previewColumnTemplate(selected, target) : null, [selected, target]);

  return (
    <details
      className="rounded border border-zinc-200 dark:border-zinc-800"
      onToggle={(event) => {
        if (!event.currentTarget.open || loaded || loading) return;
        setLoading(true);
        startTransition(async () => {
          const result = await loadColumnTemplatesAction(boardId);
          setLibrary(result.templates);
          setLoaded(true);
          setLoading(false);
        });
      }}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">컬럼 템플릿</summary>
      <div className="flex flex-col gap-4 border-t border-zinc-200 p-3 text-sm dark:border-zinc-800">
        {loading ? <p role="status">템플릿을 불러오는 중…</p> : null}

        <form action={action} onSubmit={assignRequestId} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input type="hidden" name="operation" value="save" />
          <input type="hidden" name="boardId" value={boardId} />
          <input type="hidden" name="requestId" />
          <select name="columnId" value={sourceColumnId} onChange={(event) => setSourceColumnId(event.target.value)} required className="rounded border px-2 py-1 dark:bg-zinc-900">
            {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
          </select>
          <input name="name" required placeholder="템플릿 이름" className="rounded border px-2 py-1 dark:bg-zinc-900" />
          <div className="flex gap-2">
            <select name="scope" defaultValue="private" className="rounded border px-2 py-1 dark:bg-zinc-900">
              <option value="private">나만 보기</option><option value="org">회사 공개</option>
            </select>
            <button disabled={pending || !sourceColumnId} className="rounded bg-mw-primary px-3 py-1 text-white disabled:opacity-50">저장</button>
          </div>
        </form>

        {loaded && templates.length === 0 ? <p className="text-mw-sub">저장된 컬럼 템플릿이 없습니다.</p> : null}
        {templates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className="rounded border px-2 py-1 dark:bg-zinc-900">
              <option value="">템플릿 선택</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version} · {template.scope === "org" ? "회사" : "비공개"}</option>)}
            </select>
            {selected ? (
              <>
                <label className="flex items-center gap-2">적용 대상
                  <select value={targetColumnId} onChange={(event) => setTargetColumnId(event.target.value)} className="rounded border px-2 py-1 dark:bg-zinc-900">
                    <option value="">새 컬럼</option>
                    {columns.map((column) => <option key={column.id} value={column.id}>{column.label} ({column.type})</option>)}
                  </select>
                </label>
                {preview ? <p className="rounded bg-mw-bg p-2 text-mw-sub">미리보기: {preview.mode === "create" ? "새 컬럼 1개 추가" : `${preview.changes.length}개 설정 변경`}{"typeMismatch" in preview && preview.typeMismatch ? " · 타입이 달라 적용 불가" : ""} · 입력값 변경 0</p> : null}
                <div className="flex flex-wrap gap-2">
                  <OperationForm action={action} boardId={boardId} operation="apply" templateId={selected.id} targetColumnId={targetColumnId}><button disabled={pending || Boolean(preview && "typeMismatch" in preview && preview.typeMismatch)} className="rounded bg-mw-primary px-3 py-1 text-white disabled:opacity-50">적용</button></OperationForm>
                  <OperationForm action={action} boardId={boardId} operation="update" templateId={selected.id} columnId={sourceColumnId}><input name="name" defaultValue={selected.name} className="w-32 rounded border px-2 py-1 dark:bg-zinc-900" /><button disabled={pending} className="rounded border px-3 py-1">새 버전 저장</button></OperationForm>
                  {templates.filter((template) => template.templateKey === selected.templateKey).map((version) => <OperationForm key={version.id} action={action} boardId={boardId} operation="rollback" templateId={version.id}><button disabled={pending || version.version === Math.max(...templates.filter((item) => item.templateKey === selected.templateKey).map((item) => item.version))} className="rounded border px-3 py-1 disabled:opacity-50">v{version.version}로 원복</button></OperationForm>)}
                  <OperationForm action={action} boardId={boardId} operation="delete" templateId={selected.id}><button disabled={pending} className="rounded border border-red-300 px-3 py-1 text-red-600">전체 버전 삭제</button></OperationForm>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
        {state.message ? <p role={state.ok ? "status" : "alert"} className={state.ok ? "text-mw-sub" : "text-red-600"}>{state.message}</p> : null}
      </div>
    </details>
  );
}

export function assignRequestId(event: React.FormEvent<HTMLFormElement>) {
  assignFreshRequestId(event.currentTarget);
}

export function assignFreshRequestId(form: HTMLFormElement) {
  const input = form.elements.namedItem("requestId");
  if (input instanceof HTMLInputElement) input.value = newColumnTemplateRequestId();
}

function OperationForm({ action, boardId, operation, templateId, targetColumnId, columnId, children }: {
  action: (payload: FormData) => void; boardId: string; operation: string; templateId: string;
  targetColumnId?: string; columnId?: string; children: React.ReactNode;
}) {
  return <form action={action} onSubmit={assignRequestId} className="flex gap-1"><input type="hidden" name="boardId" value={boardId} /><input type="hidden" name="operation" value={operation} /><input type="hidden" name="templateId" value={templateId} /><input type="hidden" name="requestId" />{targetColumnId !== undefined ? <input type="hidden" name="targetColumnId" value={targetColumnId} /> : null}{columnId ? <input type="hidden" name="columnId" value={columnId} /> : null}{children}</form>;
}

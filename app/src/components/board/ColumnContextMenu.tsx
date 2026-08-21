"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { BoardColumn } from "@/lib/boards/types";
import { FIELD_TYPES } from "@/lib/types";
import { fieldTypeLabel } from "@/lib/field/type-labels";
import { runColumnCommandAction } from "@/app/(app)/boards/column-command-actions";
import { INITIAL_COLUMN_COMMAND_STATE } from "@/app/(app)/boards/column-command-state";

export type ColumnMenuSlots = {
  settings?: ReactNode;
  templates?: ReactNode;
};

export function ColumnContextMenu({ boardId, column, slots = {}, children, onArchived }: {
  boardId: string;
  column: BoardColumn;
  slots?: ColumnMenuSlots;
  children?: ReactNode;
  onArchived?: (columnId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"duplicate" | "add" | "type" | "expand" | "rename" | null>(null);
  const [state, action] = useActionState(runColumnCommandAction, INITIAL_COLUMN_COMMAND_STATE);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (state.archivedColumnId) onArchived?.(state.archivedColumnId);
  }, [onArchived, state.archivedColumnId]);

  useEffect(() => {
    if (!panel) return;
    dialogRef.current?.querySelector<HTMLElement>("input,select,button")?.focus();
  }, [panel]);

  const close = () => { setOpen(false); setPanel(null); triggerRef.current?.focus(); };
  const requestId = () => crypto.randomUUID();
  const submit = (operation: string, extra?: Record<string, string>) => {
    const data = new FormData();
    data.set("boardId", boardId); data.set("columnId", column.id); data.set("operation", operation); data.set("requestId", requestId());
    for (const [key, value] of Object.entries(extra ?? {})) data.set(key, value);
    action(data);
    setOpen(false); setPanel(null);
  };
  const menuKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return <div ref={rootRef} className="relative flex min-w-0 flex-1 items-center gap-1" onKeyDown={menuKey} onContextMenu={(event) => { event.preventDefault(); setOpen(true); }}>
    {children}
    <button ref={triggerRef} type="button" aria-label={`${column.label} 컬럼 메뉴`} aria-haspopup="menu" aria-expanded={open}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
      onKeyDown={(event) => { if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") { event.preventDefault(); setOpen(true); } }}
      className="ml-auto rounded px-1 text-mw-sub hover:bg-mw-bg focus:outline-none focus:ring-2 focus:ring-mw-primary">⋯</button>
    {open ? <div role="menu" aria-label={`${column.label} 구조 변경`} className="absolute right-0 z-50 mt-1 w-52 rounded border border-mw-line bg-mw-card p-1 text-left shadow-lg">
      <MenuItem onClick={() => setPanel("duplicate")}>컬럼 복제</MenuItem>
      <MenuItem onClick={() => setPanel("add")}>오른쪽에 컬럼 추가</MenuItem>
      <MenuItem onClick={() => setPanel("type")}>컬럼 유형 변경</MenuItem>
      <MenuItem onClick={() => setPanel("expand")}>컬럼 확장</MenuItem>
      <MenuItem onClick={() => setPanel("rename")}>이름 바꾸기</MenuItem>
      <MenuItem danger onClick={() => { if (window.confirm(`«${column.label}» 컬럼을 휴지통으로 옮길까요? 값은 보존됩니다.`)) submit("archive"); }}>삭제</MenuItem>
    </div> : null}
    {panel ? <div role="dialog" aria-modal="true" aria-label={`${column.label} 컬럼 변경`} className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30" onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
      <div ref={dialogRef} tabIndex={-1} className="w-full max-w-md rounded bg-mw-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h2 className="mb-3 text-base font-semibold">{column.label}</h2>
        {panel === "duplicate" ? <SimpleForm submit={(data) => submit("duplicate", { copyValues: data.copyValues ?? "false" })} fields={<label className="flex items-start gap-2 text-sm"><input type="checkbox" name="copyValues" value="true" /><span>행 값도 복제<br /><span className="text-mw-sub">기본은 구조·설정만 복제하며 기존 행 값은 비어 있습니다.</span></span></label>} /> : null}
        {panel === "add" ? <SimpleForm submit={(data) => submit("create_at", data)} fields={<><input name="label" required placeholder="새 컬럼 이름" className="rounded border p-2" /><select name="type" defaultValue="text" className="rounded border p-2">{FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}</select></>} /> : null}
        {panel === "rename" ? <SimpleForm submit={(data) => submit("rename", data)} fields={<input name="label" required defaultValue={column.label} className="rounded border p-2" />} /> : null}
        {panel === "type" ? <SimpleForm submit={(data) => submit("type_commit", { targetType: data.targetType })} fields={<><p className="text-sm text-mw-sub">현재 값을 먼저 검사하며 변환 불가 값이 있으면 아무것도 바꾸지 않습니다.</p><select name="targetType" defaultValue={column.type} className="rounded border p-2">{FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabel(type)}</option>)}</select></>} /> : null}
        {panel === "expand" ? <div className="grid gap-2 text-sm"><p><b>유형</b> {fieldTypeLabel(column.type)}</p><p><b>키</b> {column.key}</p><p><b>출처</b> {column.source}</p><div data-column-settings-slot>{slots.settings}</div><div data-column-template-slot>{slots.templates}</div></div> : null}
        <button type="button" onClick={close} className="mt-4 rounded border px-3 py-1.5">닫기</button>
      </div>
    </div> : null}
    {state.message ? <div role={state.ok ? "status" : "alert"} className={`fixed bottom-5 right-5 z-[70] rounded px-4 py-3 shadow ${state.ok ? "bg-mw-card" : "bg-red-50 text-red-700"}`}>
      {state.message}
    </div> : null}
  </div>;
}

function MenuItem({ children, onClick, danger = false }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button role="menuitem" type="button" onClick={onClick} className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-mw-bg focus:bg-mw-bg focus:outline-none ${danger ? "text-red-600" : ""}`}>{children}</button>;
}

function SimpleForm({ fields, submit }: { fields: ReactNode; submit: (values: Record<string, string>) => void }) {
  return <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); submit(Object.fromEntries([...data].map(([key, value]) => [key, String(value)]))); }}>{fields}<button className="rounded bg-mw-primary px-3 py-2 text-white">적용</button></form>;
}

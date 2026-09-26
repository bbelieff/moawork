"use client";
import { presentNewLeadColumns } from "@/lib/default-tabs/new-lead";

import { useRef, useState, type ReactNode } from "react";
import type { BoardColumn, ItemWithValues } from "@/lib/boards/types";
import { formatCell } from "@/lib/boards/cells";
import { isSourceEditable } from "@/lib/field/source";
import { pickBulkStatusColumn } from "@/app/(app)/boards/bulk-action-gates";
import { BulkActionBar, type BulkDialogState } from "@/components/board/BulkActionBar";
import { BULK_BLOCKED_COLUMN_KEYS, BULK_BLOCKED_VALUES, bulkRangeIds, selectionToCsv, toggleGroupSelection } from "@/components/board/bulk-selection";
import type { ResultNotice } from "@/lib/ui/result-notice";
import { workflowKindForSource } from "@/lib/workflow/progress";

const FIELD_TYPES = new Set(["text", "number", "money", "date", "datetime", "email", "url", "phone", "select", "status", "person"]);

/** Saved flat views use the same permissioned actions and visible-row selection as boards. */
export function SavedTableSelection({ boardId, boardSource = null, rows, columns, physicalColumns = columns, members, groups, canEdit, canMove, canDelete, canExport, children }: {
  boardId: string;
  boardSource?: string | null;
  rows: readonly ItemWithValues[];
  columns: readonly BoardColumn[];
  physicalColumns?: readonly BoardColumn[];
  members: readonly { id: string; label: string }[];
  groups: readonly { id: string; name: string }[];
  canEdit: boolean;
  canMove: boolean;
  canDelete: boolean;
  canExport: boolean;
  children: (selection: { header: ReactNode; cell: (row: ItemWithValues) => ReactNode }) => ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<BulkDialogState | null>(null);
  const [notice, setNotice] = useState<ResultNotice | null>(null);
  const anchor = useRef<string | null>(null);
  const workflowKind = workflowKindForSource(boardSource);
  const ids = rows.map((row) => row.id);
  const targets = rows.filter((row) => selected.has(row.id));
  const all = rows.length > 0 && targets.length === rows.length;
  const editable = columns.filter((column) => FIELD_TYPES.has(column.type) && isSourceEditable(column.source)
    && !column.is_readonly && !BULK_BLOCKED_COLUMN_KEYS.has(column.key)
    && !["workflow_progress", "consultation_progress"].includes(column.key));
  const fieldColumns = editable.map((column) => ({
    key: column.key, label: column.label, type: column.type,
    options: column.options_jsonb?.options?.filter((option) => !BULK_BLOCKED_VALUES.has(option.id)).map(({ id, label }) => ({ id, label })),
  }));
  const labels = new Map(members.map((member) => [member.id, member.label]));
  const csv = selectionToCsv(["이름", ...columns.map((column) => column.label)], targets.map((row) => [row.title, ...columns.map((column) => {
    const value = row.values[column.key] ?? null;
    if (column.type === "person" && typeof value === "string") return labels.get(value) ?? value;
    if (column.type === "people" && Array.isArray(value)) return value.map((id) => labels.get(String(id)) ?? String(id)).join(", ");
    return formatCell(column.type, value, column.options_jsonb?.options);
  })]));
  const checkbox = (row: ItemWithValues) => <input type="checkbox" aria-label={`${row.title} 선택`}
    checked={selected.has(row.id)} onChange={() => {}}
    onClick={(event) => {
      const range = event.shiftKey ? bulkRangeIds(ids, anchor.current, row.id) : [row.id];
      setSelected((current) => toggleGroupSelection(current, range.length ? range : [row.id], !current.has(row.id)));
      anchor.current = row.id;
      setNotice(null);
    }} />;
  return <>
    {selected.size > 0 || dialog ? <BulkActionBar
      boardId={boardId} workflowKind={workflowKind} totalSelected={selected.size}
      targets={targets.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at }))}
      targetValues={Object.fromEntries(targets.map((row) => [row.id, row.values]))}
      canEdit={canEdit} canMove={canMove} canDelete={canDelete} canExport={canExport}
      statusColumn={pickBulkStatusColumn(workflowKind === "new-lead" ? presentNewLeadColumns(physicalColumns) : physicalColumns, workflowKind)} fieldColumns={fieldColumns}
      dateColumns={editable.filter((column) => column.type === "date" || column.type === "datetime").map((column) => ({ key: column.key, label: column.label, includeTime: column.type === "datetime" }))}
      members={[...members]} groups={[...groups]} linkCandidates={rows.map(({ id, title }) => ({ id, title }))}
      exportCsv={csv} exportFilename={`board-${boardId}-selection.csv`}
      dialog={dialog} notice={notice}
      onOpenDialog={(op, preset) => { setDialog({ op, preset }); setNotice(null); }}
      onCloseDialog={() => setDialog(null)}
      onClear={() => { setSelected(new Set()); setDialog(null); anchor.current = null; }}
      onApplied={(done) => setSelected((current) => new Set([...current].filter((id) => !done.includes(id))))}
      onNotice={(message, ok = true) => setNotice({ message, ok })}
    /> : notice ? <p role={notice.ok ? "status" : "alert"} className="text-xs text-mw-sub">{notice.message}</p> : null}
    {children({ header: <input type="checkbox" aria-label="표의 전체 행 선택" checked={all}
      ref={(node) => { if (node) node.indeterminate = targets.length > 0 && !all; }}
      onChange={(event) => setSelected((current) => toggleGroupSelection(current, ids, event.target.checked))} />, cell: checkbox })}
  </>;
}

"use client";

import { useEffect, useState } from "react";
import type { BoardColumn, CellValue, ItemWithValues } from "@/lib/boards/types";
import type { DetailLayoutEntry } from "@/lib/boards/detail-layout";
import { moveDetailEntry, unplacedDetailKeys } from "@/lib/boards/detail-layout";
import { formatCell } from "@/lib/boards/cells";
import { isSourceEditable } from "@/lib/field/source";
import {
  addDetailFieldAction,
  addUnplacedDetailEntryAction,
  promoteDetailFieldAction,
  resetGroupDetailLayoutAction,
  saveDetailLayoutAction,
  setCellAction,
  setDetailValueAction,
} from "@/app/(app)/boards/actions";
import { updateNewLeadMetaAction } from "@/app/(app)/boards/new-lead-actions";

function inputType(type: string | undefined): string {
  if (type === "number" || type === "money") return "number";
  if (type === "date") return "date";
  if (type === "datetime") return "datetime-local";
  if (type === "email") return "email";
  if (type === "url") return "url";
  if (type === "phone") return "tel";
  return "text";
}

function inputValue(value: CellValue | undefined): string | number {
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? value : String(value);
}

function SaveLayoutForm({
  boardId,
  groupId,
  layout,
  label,
  disabled,
}: {
  boardId: string;
  groupId: string | null;
  layout: DetailLayoutEntry[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <form action={saveDetailLayoutAction}>
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="groupId" value={groupId ?? ""} />
      <input type="hidden" name="layout" value={JSON.stringify(layout)} />
      <button type="submit" disabled={disabled} className="min-h-9 rounded-lg border border-mw-line px-2 text-xs text-mw-body disabled:opacity-40">
        {label}
      </button>
    </form>
  );
}

export function ItemDetailPanel({
  boardId,
  row,
  columns,
  boardLayout,
  layout,
  inherited,
  canEditItems,
  canManageColumns,
  defaultOpen = false,
  canonicalNewLead = false,
}: {
  boardId: string;
  row: ItemWithValues;
  columns: BoardColumn[];
  boardLayout: DetailLayoutEntry[];
  layout: DetailLayoutEntry[];
  inherited: boolean;
  canEditItems: boolean;
  canManageColumns: boolean;
  defaultOpen?: boolean;
  canonicalNewLead?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const unplaced = unplacedDetailKeys(row.values, layout);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-8 shrink-0 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record hover:bg-mw-tint-blue"
        aria-label={`${row.title} 상세 열기`}
      >
        열기 ↗
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={`${row.title} 상세`} className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <section className="h-full w-full max-w-xl overflow-y-auto bg-mw-card p-4 shadow-2xl sm:p-6">
            <header className="flex items-start justify-between gap-4 border-b border-mw-line pb-4">
              <div>
                <p className="text-xs font-semibold text-mw-record">상세 필드</p>
                <h2 className="mt-1 text-xl font-bold text-mw-fg">{row.title}</h2>
                <p className="mt-1 text-xs text-mw-sub">{inherited ? "보드 기본 배치를 상속 중" : "이 아이템만의 배치를 사용 중"}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="상세 닫기" className="min-h-11 min-w-11 rounded-full border border-mw-line text-mw-body">×</button>
            </header>

            <div className="grid gap-3 py-5">
              {canonicalNewLead && row.deal_id ? <form action={updateNewLeadMetaAction} className="grid gap-2 rounded-xl border border-mw-line p-3">
                <input type="hidden" name="boardId" value={boardId} /><input type="hidden" name="itemId" value={row.id} />
                <input type="hidden" name="dealId" value={row.deal_id} /><input type="hidden" name="field" value="address_detail" />
                <label className="grid gap-1 text-xs font-semibold text-mw-body">상세 주소
                  <input name="value" defaultValue={typeof row.values.address_detail === "string" ? row.values.address_detail : ""} placeholder="미정" className="min-h-11 rounded-lg border border-mw-line px-3 text-sm text-mw-fg" />
                </label><button type="submit" className="min-h-9 justify-self-end rounded-lg border border-mw-line px-3 text-xs">상세 주소 저장</button>
              </form> : null}
              {layout.length === 0 && <p className="rounded-xl border border-dashed border-mw-line p-4 text-sm text-mw-sub">배치된 상세 필드가 없습니다. 값이 있다면 아래 미배치 영역에서 다시 올릴 수 있습니다.</p>}
              {layout.map((entry) => {
                const column = columnsByKey.get(entry.key);
                const label = entry.label ?? column?.label ?? entry.key;
                const type = entry.type ?? column?.type ?? "text";
                const value = row.values[entry.key];
                const editableColumn = entry.source === "column" && column && isSourceEditable(column.source) && !column.is_readonly;
                const editable = canEditItems && (entry.source === "detail" || editableColumn);
                const action = entry.source === "detail" ? setDetailValueAction : setCellAction;
                return (
                  <div key={entry.key} className="rounded-xl border border-mw-line p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <label htmlFor={`${row.id}-${entry.key}`} className="text-xs font-semibold text-mw-body">{label}</label>
                      <span className="rounded-full bg-mw-bg px-2 py-0.5 text-[11px] text-mw-sub">{entry.source === "detail" ? "상세 전용" : "표 컬럼"}</span>
                    </div>
                    {editable ? (
                      <form action={action} className="flex gap-2">
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="itemId" value={row.id} />
                        {entry.source === "detail"
                          ? <input type="hidden" name="fieldKey" value={entry.key} />
                          : <input type="hidden" name="columnKey" value={entry.key} />}
                        <input id={`${row.id}-${entry.key}`} name="value" type={inputType(type)} defaultValue={inputValue(value)} className="min-h-11 min-w-0 flex-1 rounded-lg border border-mw-line bg-mw-card px-3 text-sm text-mw-fg" />
                        <button type="submit" className="min-h-11 rounded-lg bg-mw-primary px-3 text-xs font-bold text-mw-on-accent">저장</button>
                      </form>
                    ) : (
                      <p className="min-h-11 rounded-lg bg-mw-bg px-3 py-3 text-sm text-mw-body">{column ? formatCell(column.type, value ?? null, column.options_jsonb?.options ?? []) || "—" : inputValue(value) || "—"}</p>
                    )}
                    {entry.source === "detail" && canManageColumns && (
                      <form action={promoteDetailFieldAction} className="mt-2">
                        <input type="hidden" name="boardId" value={boardId} />
                        <input type="hidden" name="fieldKey" value={entry.key} />
                        <button type="submit" className="text-xs font-semibold text-mw-record">⋯ 표에도 보이기</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>

            <details className="border-t border-mw-line py-4" open={unplaced.length > 0}>
              <summary className="cursor-pointer text-sm font-semibold text-mw-body">이 화면에 배치되지 않은 항목 {unplaced.length}개 ▾</summary>
              <div className="mt-3 grid gap-2">
                {unplaced.length === 0 && <p className="text-xs text-mw-sub">모든 값이 현재 배치에 있습니다.</p>}
                {unplaced.map((key) => (
                  <div key={key} className="flex items-center justify-between gap-3 rounded-lg bg-mw-bg p-3">
                    <div className="min-w-0"><b className="block truncate text-xs text-mw-body">{columnsByKey.get(key)?.label ?? key}</b><span className="block truncate text-xs text-mw-sub">{String(row.values[key] ?? "")}</span></div>
                    {canManageColumns && <form action={addUnplacedDetailEntryAction}>
                      <input type="hidden" name="boardId" value={boardId} />
                      <input type="hidden" name="groupId" value={row.group_id ?? ""} />
                      <input type="hidden" name="fieldKey" value={key} />
                      <button type="submit" className="min-h-9 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record">배치에 추가</button>
                    </form>}
                  </div>
                ))}
              </div>
            </details>

            {canManageColumns && (
              <details className="border-t border-mw-line py-4">
                <summary className="cursor-pointer text-sm font-semibold text-mw-body">이 아이템의 상세 배치 편집</summary>
                <div className="mt-3 grid gap-2">
                  {inherited ? (
                    <SaveLayoutForm boardId={boardId} groupId={row.group_id} layout={layout} label="현재 기본에서 분기해 편집" disabled={!row.group_id} />
                  ) : row.group_id ? (
                    <form action={resetGroupDetailLayoutAction}>
                      <input type="hidden" name="boardId" value={boardId} />
                      <input type="hidden" name="groupId" value={row.group_id} />
                      <button type="submit" className="min-h-9 rounded-lg border border-mw-line px-2 text-xs font-semibold text-mw-record">기본으로 되돌리기</button>
                    </form>
                  ) : null}
                  {layout.map((entry, index) => (
                    <div key={entry.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-mw-bg p-2">
                      <span className="mr-auto text-xs text-mw-body">{entry.label ?? columnsByKey.get(entry.key)?.label ?? entry.key}</span>
                      <SaveLayoutForm boardId={boardId} groupId={row.group_id} layout={moveDetailEntry(layout, entry.key, -1)} label="↑" disabled={index === 0 || !row.group_id} />
                      <SaveLayoutForm boardId={boardId} groupId={row.group_id} layout={moveDetailEntry(layout, entry.key, 1)} label="↓" disabled={index === layout.length - 1 || !row.group_id} />
                      <SaveLayoutForm boardId={boardId} groupId={row.group_id} layout={layout.filter((candidate) => candidate.key !== entry.key)} label="배치에서 빼기" disabled={!row.group_id} />
                    </div>
                  ))}
                  {columns.filter((column) => !layout.some((entry) => entry.key === column.key)).length > 0 && (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-mw-line p-3">
                      <span className="w-full text-xs font-semibold text-mw-sub">표 컬럼을 이 아이템 배치에 추가</span>
                      {columns.filter((column) => !layout.some((entry) => entry.key === column.key)).map((column) => (
                        <SaveLayoutForm
                          key={column.key}
                          boardId={boardId}
                          groupId={row.group_id}
                          layout={[...layout, { key: column.key, source: "column", label: column.label, type: column.type }]}
                          label={`+ ${column.label}`}
                          disabled={!row.group_id}
                        />
                      ))}
                    </div>
                  )}
                  <form action={addDetailFieldAction} className="grid gap-2 rounded-xl border border-dashed border-mw-line p-3 sm:grid-cols-[1fr_9rem_auto]">
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="groupId" value={row.group_id ?? ""} />
                    <input name="label" required placeholder="상세 전용 필드 이름" className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-3 text-sm" />
                    <select name="type" className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-sm"><option value="text">텍스트</option><option value="number">숫자</option><option value="date">날짜</option><option value="phone">전화</option><option value="email">이메일</option><option value="url">링크</option></select>
                    <button type="submit" className="min-h-11 rounded-lg bg-mw-primary px-3 text-xs font-bold text-mw-on-accent">추가</button>
                  </form>
                </div>
              </details>
            )}

            {canManageColumns && (
              <details className="border-t border-mw-line py-4">
                <summary className="cursor-pointer text-sm font-semibold text-mw-body">보드 기본 상세 배치</summary>
                <div className="mt-3 grid gap-2">
                  {boardLayout.map((entry, index) => (
                    <div key={entry.key} className="flex items-center gap-2 rounded-lg bg-mw-bg p-2">
                      <span className="mr-auto text-xs text-mw-body">{entry.label ?? columnsByKey.get(entry.key)?.label ?? entry.key}</span>
                      <SaveLayoutForm boardId={boardId} groupId={null} layout={moveDetailEntry(boardLayout, entry.key, -1)} label="↑" disabled={index === 0} />
                      <SaveLayoutForm boardId={boardId} groupId={null} layout={moveDetailEntry(boardLayout, entry.key, 1)} label="↓" disabled={index === boardLayout.length - 1} />
                      <SaveLayoutForm boardId={boardId} groupId={null} layout={boardLayout.filter((candidate) => candidate.key !== entry.key)} label="빼기" />
                    </div>
                  ))}
                  {columns.filter((column) => !boardLayout.some((entry) => entry.key === column.key)).length > 0 && (
                    <div className="flex flex-wrap gap-2 rounded-xl border border-dashed border-mw-line p-3">
                      <span className="w-full text-xs font-semibold text-mw-sub">표 컬럼을 보드 기본 배치에 추가</span>
                      {columns.filter((column) => !boardLayout.some((entry) => entry.key === column.key)).map((column) => (
                        <SaveLayoutForm
                          key={column.key}
                          boardId={boardId}
                          groupId={null}
                          layout={[...boardLayout, { key: column.key, source: "column", label: column.label, type: column.type }]}
                          label={`+ ${column.label}`}
                        />
                      ))}
                    </div>
                  )}
                  <form action={addDetailFieldAction} className="grid gap-2 rounded-xl border border-dashed border-mw-line p-3 sm:grid-cols-[1fr_9rem_auto]">
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="groupId" value="" />
                    <input name="label" required placeholder="보드 기본 상세 필드" className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-3 text-sm" />
                    <select name="type" className="min-h-11 rounded-lg border border-mw-line bg-mw-card px-2 text-sm"><option value="text">텍스트</option><option value="number">숫자</option><option value="date">날짜</option></select>
                    <button type="submit" className="min-h-11 rounded-lg bg-mw-primary px-3 text-xs font-bold text-mw-on-accent">기본에 추가</button>
                  </form>
                </div>
              </details>
            )}
          </section>
        </div>
      )}
    </>
  );
}
